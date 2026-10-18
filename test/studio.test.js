import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { apisFromConfig, createServer } from "../src/server.js";
import { StudioStore, parseStaff } from "../src/studio/store.js";
import { customerMission, matches } from "../src/studio/model.js";
import * as MT from "../src/core/index.js";

// A stand-in for Google, as in auth.test.js.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const WEB_ID = "web-client.apps.googleusercontent.com";
let now = Date.parse("2026-10-18T02:00:00Z");
const fakeFetch = async () => ({ ok: true, status: 200, headers: new Map([["cache-control", "max-age=3600"]]), json: async () => ({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k", alg: "RS256" }] }) });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(sub, email, name) {
  const t = Math.floor(now / 1000);
  const head = b64({ alg: "RS256", kid: "k", typ: "JWT" });
  const body = b64({ iss: "https://accounts.google.com", aud: WEB_ID, sub, email, email_verified: true, name, iat: t, exp: t + 3600 });
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;
}

const trip = () => MT.cleanMission({
  name: "Kyoto in autumn", emoji: "🍁", tz: "Asia/Tokyo",
  blocks: [
    { id: "b1", date: "2026-11-03", s: "09:00", e: "11:00", cat: "do", title: "Fushimi Inari early" },
    { id: "b2", date: "2026-11-03", s: "12:00", e: "13:00", cat: "fuel", title: "Lunch: Nishiki Market" },
    { id: "b3", date: "2026-11-03", s: "12:00", e: "13:00", cat: "do", title: "Museum instead", branch: "Rain" },
  ],
});

test("STUDIO_STAFF parsing", () => {
  assert.deepEqual(parseStaff("admin:Boss@Studio.com, planner:p@studio.com x@y.co bad:z@q.com nope"), { "boss@studio.com": "admin", "p@studio.com": "planner", "x@y.co": "planner" });
});

test("case store: pipeline, history, conflicts, itineraries, customer progress", async () => {
  const s = new StudioStore(mkdtempSync(join(tmpdir(), "mt-studio-")), { seedStaff: { "boss@studio.com": "admin" }, now: () => now });
  await assert.rejects(s.create({ customer: {} }, "boss@studio.com"), /name or email/);
  const c = await s.create({ customer: { name: "Aiko Tan", email: "Aiko@Example.com" }, trip: { start: "2026-11-02", end: "2026-11-06", destinations: "Kyoto, Osaka", travellers: 2, budget: { amount: 4000, currency: "usd" } }, priority: "high" }, "boss@studio.com");
  assert.equal(c.ref, "C-0001");
  assert.equal(c.customer.email, "aiko@example.com");
  assert.deepEqual(c.trip.destinations, ["Kyoto", "Osaka"]);
  assert.equal(c.trip.budget.currency, "USD");
  assert.equal(c.status, "new");

  await assert.rejects(s.update(c.id, { assignee: "stranger@x.com" }, "boss@studio.com"), /isn't on the staff list/);
  await s.setStaff("plan@studio.com", "planner", "boss@studio.com");
  const r1 = await s.update(c.id, { status: "planning", assignee: "plan@studio.com" }, "boss@studio.com", 1);
  assert.equal(r1.case.revision, 2);
  assert.deepEqual(r1.case.history.map((h) => h.text).slice(1), ["New inquiry → Planning", "Assigned to plan@studio.com"]);
  await assert.rejects(s.update(c.id, { priority: "low" }, "plan@studio.com", 1), (e) => e.status === 409 && e.extra.case.revision === 2);
  await assert.rejects(s.update(c.id, { status: "nope" }, "plan@studio.com"), /status must be/);
  assert.equal((await s.get(c.id)).revision, 2, "a refused change leaves nothing behind");

  const added = await s.putItinerary(c.id, null, trip(), "plan@studio.com");
  const mid = added.missionId;
  assert.match(mid, /^st-/);
  assert.equal(await s.forCustomer("aiko@example.com").then((x) => x.length), 0, "not shared yet");
  const shared = await s.share(c.id, mid, true, "plan@studio.com");
  assert.equal(shared.case.status, "proposal_sent", "the first share moves the case on");
  assert.equal((await s.forCustomer("AIKO@example.com")).length, 1);

  now += 60000;
  const after1 = await s.recordProgress("aiko@example.com", mid, { blocks: { b1: { status: "done", at: now }, nope: { status: "done", at: now } }, memos: { "2026-11-03": "Gorgeous" } });
  assert.equal(after1.blocks.find((b) => b.id === "b1").status, "done");
  assert.equal(after1.memos["2026-11-03"], "Gorgeous");
  now += 60000;
  await s.recordProgress("aiko@example.com", mid, { blocks: { b2: { status: "skipped", at: now }, b1: { status: "", at: now - 120000 } } });
  const progressLines = (await s.get(c.id)).history.filter((h) => h.type === "progress");
  assert.equal(progressLines.length, 1, "taps close together make one history line");
  assert.match(progressLines[0].text, /Fushimi Inari early: done.*Lunch: Nishiki Market: skipped/);
  assert.equal(customerMission((await s.get(c.id)).itineraries[0]).blocks[0].status, "done", "an older mark doesn't undo a newer one");
  await assert.rejects(s.recordProgress("someone@else.com", mid, { blocks: {} }), /No such trip/);

  // the studio edits the shared trip: marks stay on blocks that still exist
  const edited = trip();
  edited.blocks = edited.blocks.filter((b) => b.id !== "b2").map((b) => (b.id === "b1" ? { ...b, e: "11:30", status: "skipped" } : b));
  await s.putItinerary(c.id, mid, edited, "plan@studio.com");
  const it = (await s.get(c.id)).itineraries[0];
  assert.deepEqual(Object.keys(it.progress.blocks), ["b1"]);
  assert.equal(it.mission.blocks[0].status, "", "staff can't set the customer's marks");
  assert.equal(customerMission(it).blocks[0].e, "11:30");

  const list = await s.list({ q: "kyoto aiko", open: true });
  assert.equal(list.cases.length, 1);
  assert.equal(list.counts.proposal_sent, 1);
  assert.deepEqual(list.cases[0].progress, { done: 1, total: 1 });
  assert.equal((await s.list({ assignee: "none" })).cases.length, 0);
  assert.equal(matches(await s.get(c.id), { q: "paris" }), false);

  await s.update(c.id, { status: "cancelled" }, "boss@studio.com");
  assert.equal((await s.forCustomer("aiko@example.com")).length, 0, "cancelled cases leave the customer's app");

  // persisted
  const again = new StudioStore(s.dir.replace(/\/studio$/, ""), { now: () => now });
  assert.equal((await again.get(c.id)).ref, "C-0001");
  assert.equal(await again.roleOf("plan@studio.com"), "planner");
  await assert.rejects(s.removeStaff("boss@studio.com", "x"), /STUDIO_STAFF/);
});

// ---------- over HTTP: staff, a customer, and someone else ----------
let server, base;
before(async () => {
  const config = { enabled: true, webClientId: WEB_ID, clientIds: [WEB_ID], secret: "s".repeat(40), stateDir: mkdtempSync(join(tmpdir(), "mt-studio-http-")), staff: "admin:boss@studio.com", studioName: "Ikigai Travel" };
  server = createServer({ apis: apisFromConfig(config, { fetch: fakeFetch, now: () => now }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function call(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = request(base + path, { method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const signIn = async (sub, email, name) => (await call("POST", "/api/v1/auth/google", { body: { idToken: idToken(sub, email, name) } })).body.token;

test("HTTP: staff run a case, the customer gets the trip and sends progress back", async () => {
  const boss = await signIn("1", "boss@studio.com", "Boss");
  const planner = await signIn("2", "plan@studio.com", "Pat Planner");
  const customer = await signIn("3", "aiko@example.com", "Aiko");

  assert.equal((await call("GET", "/api/v1/studio/me.json")).status, 401);
  const notStaff = await call("GET", "/api/v1/studio/cases.json", { token: planner });
  assert.equal(notStaff.status, 403);
  assert.equal(notStaff.body.error.code, "not_staff");

  const me = await call("GET", "/api/v1/studio/me.json", { token: boss });
  assert.equal(me.body.role, "admin");
  assert.equal(me.body.pipeline.length, 7);

  const staff = await call("PUT", "/api/v1/studio/staff/plan%40studio.com", { token: boss, body: { role: "planner" } });
  assert.deepEqual(staff.body.staff.map((x) => [x.email, x.role, x.name]), [["boss@studio.com", "admin", "Boss"], ["plan@studio.com", "planner", "Pat Planner"]]);
  assert.equal((await call("PUT", "/api/v1/studio/staff/x%40y.com", { token: planner, body: { role: "admin" } })).status, 403, "planners can't change staff");

  const made = await call("POST", "/api/v1/studio/cases", { token: planner, body: { customer: { name: "Aiko Tan", email: "aiko@example.com" }, trip: { destinations: ["Kyoto"] }, assignee: "plan@studio.com", note: "Loves temples, hates crowds" } });
  assert.equal(made.status, 201);
  const id = made.body.case.id;
  assert.equal(made.body.case.customerAccount.signedIn, true);
  assert.equal(made.body.case.notes[0].text, "Loves temples, hates crowds");

  const it = await call("POST", `/api/v1/studio/cases/${id}/itineraries`, { token: planner, body: { mission: trip() } });
  assert.equal(it.status, 201);
  const mid = it.body.missionId;
  assert.equal((await call("GET", "/api/v1/me/studio.json", { token: customer })).body.trips.length, 0);

  const shared = await call("POST", `/api/v1/studio/cases/${id}/itineraries/${mid}/share`, { token: planner, body: { shared: true } });
  assert.equal(shared.body.case.status, "proposal_sent");

  const mine = await call("GET", "/api/v1/me/studio.json", { token: customer });
  assert.equal(mine.body.studio.name, "Ikigai Travel");
  assert.equal(mine.body.trips.length, 1);
  assert.deepEqual(mine.body.trips[0].planner, { email: "plan@studio.com", name: "Pat Planner" });
  assert.equal(mine.body.trips[0].mission.id, mid);
  assert.equal((await call("GET", "/api/v1/me/studio.json", { token: boss })).body.trips.length, 0, "other people see nothing");

  now += 1000;
  const p = await call("PUT", `/api/v1/me/studio/trips/${mid}/progress`, { token: customer, body: { blocks: { b1: { status: "done", at: now } } } });
  assert.equal(p.status, 200);
  assert.equal(p.body.mission.blocks[0].status, "done");
  assert.equal((await call("PUT", `/api/v1/me/studio/trips/${mid}/progress`, { token: boss, body: { blocks: {} } })).status, 404);

  const seen = await call("GET", `/api/v1/studio/cases/${id}.json`, { token: planner });
  assert.equal(seen.body.case.itineraries[0].live.blocks[0].status, "done");
  assert.equal(seen.body.case.history.at(-1).by, "customer");

  const stale = await call("PATCH", `/api/v1/studio/cases/${id}`, { token: boss, body: { baseRevision: 1, status: "confirmed" } });
  assert.equal(stale.status, 409);
  const fresh = await call("PATCH", `/api/v1/studio/cases/${id}`, { token: boss, body: { baseRevision: stale.body.case.revision, status: "confirmed" } });
  assert.equal(fresh.body.case.status, "confirmed");

  const list = await call("GET", "/api/v1/studio/cases.json?open=1&assignee=plan@studio.com", { token: planner });
  assert.equal(list.body.cases[0].status, "confirmed");
  assert.equal(list.body.counts.confirmed, 1);

  assert.equal((await call("DELETE", `/api/v1/studio/cases/${id}`, { token: planner })).status, 403);
  assert.equal((await call("PATCH", `/api/v1/studio/cases/c_nope`, { token: planner, body: {} })).status, 404);
  assert.equal((await call("GET", `/api/v1/studio/cases/${id}/notes`, { token: planner })).status, 405);
  assert.equal((await call("DELETE", `/api/v1/studio/cases/${id}`, { token: boss })).status, 204);
  assert.equal((await call("GET", "/api/v1/me/studio.json", { token: customer })).body.trips.length, 0);
});
