import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { apisFromConfig, createServer } from "../src/server.js";
import { brief, caseFromIntake, draftItinerary, ideas, nightsOf, parseIntake, planNights } from "../src/studio/intake.js";
import { ROUTES } from "../src/studio/routes.js";
import * as MT from "../src/core/index.js";

const NOW = Date.parse("2026-10-19T02:00:00Z");

/** Answers the way the travel-survey form records them. */
const answers = (over = {}) => ({
  theme: "Relaxing and recharging",
  must_see: "I'd rather avoid famous tourist spots and focus on more local places",
  city_rural: 2, why_mystery: "A stress-free trip without hours of planning and booking", visits: "Twice", party_size: 2,
  activity_interest: {
    "Gentle walks and time in nature": 5, "Beaches and coastal areas": 2, "Hot springs and wellness time": 5, "Mountains": 4,
    "Historical sights": 3, "Hands-on cultural experiences and workshops": 3, "Local traditional events": 3,
    "Photogenic, visually charming places": 4, "Artistic and creative attractions (museums, exhibitions)": 2,
    "Active or intense experiences (full-day hiking, biking, snow activities)": 2,
  },
  pace: 2, moving: "Longer stays in fewer places", mornings: 2, evenings: 2, locals: 4, structure: "Plenty of free time and flexibility",
  offline: "Yes", conditions: ["Can't swim"], avoid_activities: ["Riding a bike"], onsen_ok: "Yes", tattoos: "Medium (palm-sized)", tattoo_cover: "No",
  prefectures: ["Tokyo", "Kyoto", "Osaka"], avoid_places: "",
  food_interest: { "Casual food experiences (street food, local diners)": 5, "Hands-on food experiences (cooking class, tea ceremony)": 3, "Fine dining": 3, "Drinking — sake, whisky, bars": 2 },
  dietary: "No shellfish (allergy)", dislikes: "natto",
  stay_priorities: ["Warm hospitality", "Cleanliness", "Meal quality", "Room view", "Building and room appearance"],
  stay_style: "Traditional Japanese (ryokan, tatami)", sleeping: "Own beds for each person", shared_bath: "No", room_needs: "",
  budget_priorities: ["Nicer accommodation", "Quality of meals", "More pre-booked experiences", "Fastest transportation"],
  flights_booked: "Yes", start_datetime: "2026-11-10T14:00", start_city: "Tokyo", end_city: { choice: "Other", other: "Fukuoka" },
  length: "10 nights / 11 days", flexibility: "± 1 day", days_tokyo: "1", days_kyoto: "0",
  celebration: "Honeymoon or anniversary", celebration_date: "2026-11-14", celebration_details: "10th anniversary",
  budget_pp: 6000, name: "Aiko Tanaka", age: "30–39", gender: "Female", country: "Australia", email: "Aiko@Example.com",
  whatsapp: "+61 400 000 000", final_notes: "We'd love one really special ryokan.", heard_about: "Instagram",
  marketing_optin: false, privacy_agree: true,
  ...over,
});

const record = (a) => ({
  survey: "Japan Ikigai Trip — mystery trip questionnaire", submitted_at: "2026-10-19T01:59:00Z", respondent: a.name, email: a.email,
  sections: {
    basics: { title: "Your trip", answers: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { question: `Q ${k}`, answer: v, display: Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v) }])) },
  },
});

test("parseIntake: answers and sections, privacy and email required", () => {
  const p = parseIntake(record(answers()));
  assert.equal(p.answers.party_size, 2);
  assert.equal(p.sections[0].items.find((i) => i.id === "pace").display, "2");
  assert.throws(() => parseIntake(record(answers({ privacy_agree: false }))), /privacy/);
  assert.throws(() => parseIntake(record(answers({ email: "nope" }))), /email/);
  assert.throws(() => parseIntake({ hello: 1 }), /isn't a questionnaire/);
});

test("the case: customer, trip and priority from the answers", () => {
  const c = caseFromIntake(answers(), NOW);
  assert.deepEqual(c.customer, { name: "Aiko Tanaka", email: "Aiko@Example.com", phone: "+61 400 000 000" });
  assert.equal(c.trip.start, "2026-11-10");
  assert.equal(c.trip.end, "2026-11-20");
  assert.deepEqual(c.trip.destinations, ["Tokyo", "Fukuoka"]);
  assert.deepEqual(c.trip.budget, { amount: 12000, currency: "USD" });
  assert.equal(c.trip.source, "Questionnaire · Instagram");
  assert.ok(c.trip.tags.includes("relaxing") && c.trip.tags.includes("honeymoon/anniversary"));
  assert.match(c.trip.request, /Mystery trip for 2, 10 nights, from Tokyo to Fukuoka/);
  assert.equal(c.priority, "high", "starts within a month");
  assert.equal(caseFromIntake(answers({ start_datetime: "2027-03-01T09:00" }), NOW).priority, "normal");
  assert.equal(nightsOf({ length: { choice: "Custom", other: "two weeks" } }), 14);
  assert.equal(nightsOf({ length: { choice: "Custom", other: "5 days" } }), 4);
});

test("the brief: shape, style and the flags that change bookings", () => {
  const b = brief(answers(), NOW);
  assert.match(b.headline, /2 travellers · 10 nights · from Tue 10 Nov 14:00 · Tokyo → Fukuoka · \$6,000 pp/);
  const flags = b.flags.map((f) => `${f.level}: ${f.text}`);
  assert.ok(flags.includes("warn: Can't swim"));
  assert.ok(flags.some((f) => /warn: Tattoo \(medium.*won't cover/.test(f)));
  assert.ok(flags.some((f) => /warn: Dietary: No shellfish/.test(f)));
  assert.ok(flags.some((f) => /warn: Starts in 22 days/.test(f)));
  assert.ok(flags.includes("info: Private bathroom needed"));
  assert.ok(flags.some((f) => /Celebrating: Honeymoon or anniversary on Sat 14 Nov \(10th anniversary\)/.test(f)));
  const low = brief(answers({ budget_pp: 3000 }), NOW).flags.map((f) => f.text);
  assert.ok(low.some((t) => /under our starting price for 10 nights \(about \$5,800\)/.test(t)));
  const loves = b.sections.find((s) => s.title === "Loves").items[0].value;
  assert.match(loves, /Gentle walks ★/);
  assert.match(loves, /Hot springs ★/);
});

test("ideas: a relaxed onsen-and-nature couple who know Kyoto get Kyushu, not the classic route", () => {
  const list = ideas(answers());
  assert.equal(list.length, 3);
  assert.equal(list[0].id, "kyushu-onsen", JSON.stringify(list.map((x) => [x.id, x.match])));
  assert.ok(!list.some((x) => x.id === "golden-route"));
  assert.ok(list[0].why.some((w) => /hot springs/.test(w)));
  assert.ok(list[0].cautions.some((c) => /private baths/.test(c)), "won't cover a tattoo");
  // Every plan adds up to the nights they asked for.
  for (const x of list) assert.equal(x.plan.reduce((n, s) => n + s.nights, 0), 10, x.id);
  // A first-timer who wants the big sights and cities gets the classic route.
  const first = ideas(answers({ visits: "Never", must_see: "I'd like to include a few well-known and crowded “must-see” spots if they're worth it", city_rural: 5, prefectures: ["None of them (first time!)"], theme: "Action-packed", days_kyoto: "3" }));
  assert.equal(first[0].id, "golden-route");
  // Fears move routes down: no boats for someone who can't swim and gets seasick.
  const islands = ROUTES.find((r) => r.id === "okinawa-islands");
  const beach = { ...answers().activity_interest, "Beaches and coastal areas": 5 };
  const fearful = ideas(answers({ activity_interest: beach, conditions: ["Can't swim", "Get seasick easily"] }), { count: 20 });
  const keen = ideas(answers({ activity_interest: beach, conditions: ["None"] }), { count: 20 });
  assert.ok(fearful.find((x) => x.id === islands.id).match < keen.find((x) => x.id === islands.id).match);
  assert.ok(fearful.find((x) => x.id === islands.id).cautions.some((c) => /boats/.test(c)));
});

test("planNights: start city days, route stops, the finish", () => {
  const route = ROUTES.find((r) => r.id === "kyushu-onsen");
  const plan = planNights(route, answers());
  assert.equal(plan[0].place, "Tokyo");
  assert.equal(plan.at(-1).place, "Fukuoka", "the route runs towards where they finish");
  assert.equal(plan[0].nights, 1);
  assert.ok(plan.slice(1).every((s) => s.nights >= 2), "longer stays: two nights or more each");
  assert.equal(plan.reduce((n, s) => n + s.nights, 0), 10);
  const kyoto = planNights(route, answers({ days_kyoto: "2", end_city: "Osaka" }));
  assert.deepEqual(kyoto.slice(-2).map((s) => [s.place, s.nights]), [["Kyoto", 2], ["Osaka", 1]]);
});

test("draftItinerary: a day per night, their pace and mornings, meals with the dietary note, the anniversary", () => {
  const a = answers();
  const idea = ideas(a)[0];
  const m = draftItinerary(idea, a, "Aiko Tanaka");
  assert.equal(m.name, "Kyushu: volcanoes and hot springs for Aiko");
  assert.equal(m.tz, "Asia/Tokyo");
  const days = [...new Set(m.blocks.map((b) => b.date))];
  assert.equal(days[0], "2026-11-10");
  assert.equal(days.at(-1), "2026-11-20");
  assert.equal(m.blocks.find((b) => b.date === "2026-11-10").s, "14:00", "starts when they're ready");
  assert.ok(m.blocks.filter((b) => b.date === "2026-11-12" && b.cat === "do" && !b.branch).every((b) => b.s >= "10:00"), "slow mornings");
  assert.ok(m.blocks.filter((b) => b.cat === "fuel").every((b) => /No shellfish/.test(b.note)));
  assert.ok(m.blocks.some((b) => b.date === "2026-11-14" && /Celebration dinner/.test(b.title)));
  assert.ok(m.blocks.some((b) => b.branch === "If it rains"));
  assert.ok(m.blocks.at(-1).dl, "ends with a hard deadline");
  assert.deepEqual(MT.cleanMission(m), m, "a valid mission");
});

// ---------- over HTTP: the form posts, staff see it ----------
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const WEB_ID = "web.apps.googleusercontent.com";
const fakeFetch = async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k" }] }) });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(sub, email) {
  const t = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", kid: "k" }), body = b64({ iss: "https://accounts.google.com", aud: WEB_ID, sub, email, email_verified: true, name: "Boss", iat: t, exp: t + 3600 });
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;
}
let server, base;
before(async () => {
  const config = { enabled: true, webClientId: WEB_ID, clientIds: [WEB_ID], secret: "s".repeat(40), stateDir: mkdtempSync(join(tmpdir(), "mt-intake-")), staff: "admin:boss@studio.com", studioName: "Ikigai Travel" };
  server = createServer({ apis: apisFromConfig(config, { fetch: fakeFetch }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
function call(method, path, { body, token, type = "application/json", ip } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": type };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ip) headers["X-Forwarded-For"] = ip;
    const req = request(base + path, { method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test("HTTP: the questionnaire opens a case; staff get the brief, ideas and a draft", async () => {
  // The form posts as text/plain (no CORS preflight from GitHub Pages).
  const sent = await call("POST", "/api/v1/intake", { body: record(answers()), type: "text/plain;charset=utf-8", ip: "203.0.113.5" });
  assert.equal(sent.status, 201);
  assert.deepEqual([sent.body.ok, sent.body.ref, sent.body.updated], [true, "C-0001", false]);
  assert.equal(sent.headers["access-control-allow-origin"], "*");
  // Sending again (they went back and changed an answer) updates the same case.
  const again = await call("POST", "/api/v1/intake", { body: record(answers({ party_size: 3 })), ip: "203.0.113.5" });
  assert.deepEqual([again.status, again.body.ref, again.body.updated], [200, "C-0001", true]);
  // Bots fill the hidden field and are quietly ignored; bad records are refused.
  assert.equal((await call("POST", "/api/v1/intake", { body: { ...record(answers()), website: "spam.example" }, ip: "198.51.100.1" })).body.ref, undefined);
  assert.equal((await call("POST", "/api/v1/intake", { body: record(answers({ privacy_agree: false })), ip: "198.51.100.2" })).status, 400);

  const token = (await call("POST", "/api/v1/auth/google", { body: { idToken: idToken("1", "boss@studio.com") } })).body.token;
  const list = await call("GET", "/api/v1/studio/cases.json?q=questionnaire", { token });
  assert.equal(list.body.cases.length, 1);
  assert.equal(list.body.cases[0].questionnaire, true);
  const id = list.body.cases[0].id;
  const c = (await call("GET", `/api/v1/studio/cases/${id}.json`, { token })).body.case;
  assert.equal(c.trip.travellers, 3, "the update came through");
  assert.equal(c.customer.email, "aiko@example.com");
  assert.equal(c.priority, "high");
  assert.equal(c.intake, undefined, "raw answers stay on the server");
  assert.equal(c.questionnaire.ideas[0].id, "kyushu-onsen");
  assert.ok(c.questionnaire.brief.flags.length > 3);
  assert.equal(c.history.at(-1).text, "Sent an updated questionnaire");

  const d = await call("POST", `/api/v1/studio/cases/${id}/ideas/kyushu-onsen/draft`, { token });
  assert.equal(d.status, 201);
  assert.equal(d.body.case.itineraries.length, 1);
  assert.match(d.body.missionId, /^st-/);
  assert.equal((await call("POST", `/api/v1/studio/cases/${id}/ideas/nope/draft`, { token })).status, 404);

  // A flood from one address is cut off.
  let last;
  for (let i = 0; i < 9; i++) last = await call("POST", "/api/v1/intake", { body: record(answers({ email: `x${i}@example.com` })), ip: "192.0.2.9" });
  assert.equal(last.status, 429);
});
