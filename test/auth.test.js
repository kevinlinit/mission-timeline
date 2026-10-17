import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { GoogleTokenError, googleKeys, verifyGoogleIdToken } from "../src/auth/google.js";
import { createSessions } from "../src/auth/session.js";
import { AccountStore } from "../src/auth/accounts.js";
import { accountApiFromConfig, createServer } from "../src/server.js";
import * as MT from "../src/core/index.js";

// ---------- a stand-in for Google: our own RSA key, served as a JWKS ----------
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key-1";
const WEB_ID = "web-client.apps.googleusercontent.com";
const IOS_ID = "ios-client.apps.googleusercontent.com";
const NOW = Date.parse("2026-10-17T06:00:00Z");
let jwksFetches = 0;
const fakeFetch = async () => {
  jwksFetches++;
  return { ok: true, status: 200, headers: new Map([["cache-control", "public, max-age=3600"]]), json: async () => ({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] }) };
};
fakeFetch.toString = () => "fakeFetch";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(claims = {}, { kid = KID, key = privateKey } = {}) {
  const t = Math.floor(NOW / 1000);
  const head = b64({ alg: "RS256", kid, typ: "JWT" });
  const body = b64({ iss: "https://accounts.google.com", aud: WEB_ID, sub: "1234567890", email: "kevin@example.com", email_verified: true, name: "Kevin", picture: "https://example.com/k.png", iat: t, exp: t + 3600, ...claims });
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}
const keyFor = googleKeys({ fetch: fakeFetch, now: () => NOW });
const verify = (token) => verifyGoogleIdToken(token, { clientIds: [WEB_ID, IOS_ID], keyFor, now: () => NOW });

test("a valid Google ID token gives the person", async () => {
  assert.deepEqual(await verify(idToken()), { sub: "1234567890", email: "kevin@example.com", name: "Kevin", picture: "https://example.com/k.png" });
  assert.equal((await verify(idToken({ aud: IOS_ID }))).sub, "1234567890", "the iOS client ID is accepted too");
});

test("bad Google tokens are refused", async () => {
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const t = Math.floor(NOW / 1000);
  const cases = [
    ["not a jwt", /isn't a Google sign-in token/],
    [idToken({}, { key: other }), /signature/],
    [idToken({ aud: "someone-else" }), /different app/],
    [idToken({ iss: "https://evil.example" }), /isn't from Google/],
    [idToken({ exp: t - 3600 }), /expired/],
    [idToken({ email_verified: false }), /Verify your Google email/],
    [idToken({}, { kid: "unknown" }), /unknown key/],
  ];
  for (const [token, re] of cases) await assert.rejects(verify(token), (e) => e instanceof GoogleTokenError && re.test(e.message), String(re));
});

test("Google's keys are cached", async () => {
  const before = jwksFetches;
  await verify(idToken()); await verify(idToken());
  assert.equal(jwksFetches, before, "no refetch within max-age");
});

test("session tokens: issue, read, tamper, expire", () => {
  let now = NOW;
  const s = createSessions("x".repeat(32), { now: () => now, ttlMs: 1000 });
  const { token } = s.issue("g_1", 3);
  assert.deepEqual({ uid: s.read(token).uid, ver: s.read(token).ver }, { uid: "g_1", ver: 3 });
  assert.equal(s.read(token.slice(0, -2) + "xx"), null, "tampered signature");
  const [p, , sig] = token.split(".");
  assert.equal(s.read(`${p}.${b64({ uid: "g_2", ver: 3, exp: now + 1e9 })}.${sig}`), null, "swapped payload");
  assert.equal(createSessions("y".repeat(32)).read(token), null, "other secret");
  now += 2000;
  assert.equal(s.read(token), null, "expired");
  assert.throws(() => createSessions("short"), /at least 32/);
});

test("mergeMissions: newest edit wins, deletions stick", () => {
  const m = (id, updatedAt, name = id) => MT.cleanMission({ id, name, createdAt: 1, updatedAt });
  const local = { missions: [m("a", 10, "a local"), m("b", 5), m("c", 5)], tombstones: { d: 20 } };
  const remote = { missions: [m("a", 12, "a remote"), m("b", 7, "b remote"), m("d", 15), m("e", 3)], tombstones: { c: 6 } };
  const r = MT.mergeMissions(local, remote);
  assert.deepEqual(r.missions.map((x) => x.name), ["a remote", "b remote", "e"]);
  assert.deepEqual(r.tombstones, { c: 6, d: 20 });
  // an edit after a deletion brings it back
  assert.deepEqual(MT.mergeMissions({ missions: [m("c", 9)] }, { tombstones: { c: 6 } }).missions.map((x) => x.id), ["c"]);
  assert.deepEqual(MT.pruneTombstones({ old: NOW - 200 * 86400000, recent: NOW - 1000 }, NOW), { recent: NOW - 1000 });
});

test("account store: revisions guard against lost updates", async () => {
  const store = new AccountStore(mkdtempSync(join(tmpdir(), "mt-acc-")), { now: () => NOW });
  const a = await store.upsertGoogle({ sub: "42", email: "a@b.c", name: "A", picture: "" });
  assert.equal(a.id, "g_42");
  assert.equal((await store.missions(a.id)).revision, 0);
  const first = await store.saveMissions(a.id, { baseRevision: 0, missions: [{ id: "x", name: "X" }], tombstones: {} });
  assert.equal(first.ok, true);
  assert.equal(first.state.revision, 1);
  const stale = await store.saveMissions(a.id, { baseRevision: 0, missions: [], tombstones: {} });
  assert.equal(stale.ok, false, "a second device with an old revision is refused");
  assert.equal(stale.state.missions[0].name, "X");
  // two saves at once from the same revision: exactly one wins
  const both = await Promise.all([1, 1].map((rev) => store.saveMissions(a.id, { baseRevision: rev, missions: [], tombstones: {} })));
  assert.deepEqual(both.map((x) => x.ok).sort(), [false, true]);
});

// ---------- the whole flow over HTTP ----------
let server, base;
before(async () => {
  const config = { enabled: true, webClientId: WEB_ID, iosClientId: IOS_ID, clientIds: [WEB_ID, IOS_ID], secret: "s".repeat(40), stateDir: mkdtempSync(join(tmpdir(), "mt-state-")) };
  server = createServer({ accountApi: accountApiFromConfig(config, { fetch: fakeFetch, now: () => NOW }) });
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
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
  });
}

test("HTTP: sign in, sync missions from two devices, sign out everywhere", async () => {
  assert.deepEqual((await call("GET", "/api/v1/auth/config.json")).body, { enabled: true, google: { webClientId: WEB_ID, iosClientId: IOS_ID } });
  assert.equal((await call("GET", "/api/v1/me.json")).status, 401);

  const bad = await call("POST", "/api/v1/auth/google", { body: { idToken: idToken({ aud: "nope" }) } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, "bad_google_token");

  const web = await call("POST", "/api/v1/auth/google", { body: { idToken: idToken() } });
  assert.equal(web.status, 200);
  assert.equal(web.body.account.email, "kevin@example.com");
  const phone = await call("POST", "/api/v1/auth/google", { body: { idToken: idToken({ aud: IOS_ID }) } });
  assert.equal(phone.body.account.id, web.body.account.id, "same Google account, same account on both");

  assert.equal((await call("GET", "/api/v1/me.json", { token: web.body.token })).body.name, "Kevin");
  const empty = await call("GET", "/api/v1/me/missions.json", { token: web.body.token });
  assert.deepEqual([empty.body.revision, empty.body.missions], [0, []]);

  // the web saves first
  const saved = await call("PUT", "/api/v1/me/missions", { token: web.body.token, body: { baseRevision: 0, missions: [{ id: "trip", name: "Trip", updatedAt: 10 }], tombstones: {} } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  // the phone, still on revision 0, gets a conflict with the current state, merges, and saves
  const conflict = await call("PUT", "/api/v1/me/missions", { token: phone.body.token, body: { baseRevision: 0, missions: [{ id: "run", name: "Run", updatedAt: 11 }], tombstones: {} } });
  assert.equal(conflict.status, 409);
  const merged = MT.mergeMissions({ missions: [MT.cleanMission({ id: "run", name: "Run", updatedAt: 11 })] }, conflict.body.state);
  const second = await call("PUT", "/api/v1/me/missions", { token: phone.body.token, body: { baseRevision: conflict.body.state.revision, ...merged } });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.missions.map((m) => m.id).sort(), ["run", "trip"]);

  // bad bodies
  assert.equal((await call("PUT", "/api/v1/me/missions", { token: web.body.token, body: "{nope" })).status, 400);
  assert.equal((await call("PUT", "/api/v1/me/missions", { token: web.body.token, body: { missions: [] } })).status, 400);
  assert.equal((await call("DELETE", "/api/v1/me/missions", { token: web.body.token })).status, 405);
  assert.equal((await call("GET", "/api/v1/me.json", { token: web.body.token + "x" })).status, 401);

  // sign out everywhere: both tokens stop working
  assert.equal((await call("POST", "/api/v1/auth/signout", { token: web.body.token })).status, 204);
  assert.equal((await call("GET", "/api/v1/me.json", { token: web.body.token })).status, 401);
  assert.equal((await call("GET", "/api/v1/me.json", { token: phone.body.token })).status, 401);
});

test("HTTP: with sign-in off, the API says so", async () => {
  const off = createServer({ accountApi: accountApiFromConfig({ enabled: false }) });
  await new Promise((r) => off.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${off.address().port}`;
  const get = (p, method = "GET") => new Promise((res) => request(b + p, { method }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res({ status: r.statusCode, body: JSON.parse(d) })); }).end());
  assert.deepEqual((await get("/api/v1/auth/config.json")).body, { enabled: false, google: null });
  const r = await get("/api/v1/auth/google", "POST");
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "auth_not_configured");
  off.close();
});
