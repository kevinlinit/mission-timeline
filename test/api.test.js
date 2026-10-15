import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Repository, DataError } from "../src/api/repository.js";
import { handle, staticPaths } from "../src/api/router.js";

const repo = Repository.fromDir(new URL("../data", import.meta.url).pathname);
const get = (path, query = "", now) => handle(repo, { path, query: new URLSearchParams(query) }, now);

test("the published data loads: the example trip and the iOS feed", () => {
  assert.equal(repo.missions().length, 1);
  assert.equal(repo.mission("example-japan-trip").tz, "Asia/Tokyo");
  assert.match(repo.updateFeed().version, /^\d+\.\d+\.\d+$/);
  assert.match(repo.revision, /^[0-9a-f]{12}$/);
});

test("index lists every endpoint", () => {
  const r = get("/api/v1.json");
  assert.equal(r.status, 200);
  assert.equal(r.body.format, "mission-timeline/v1");
  assert.ok(r.body.endpoints.some((e) => e.path === "/api/v1/missions/:id/live.json" && !e.static));
  assert.deepEqual(get("/api/v1").body, r.body, "with or without .json");
});

test("missions list is summaries", () => {
  const { body } = get("/api/v1/missions.json");
  const s = body.missions[0];
  assert.equal(s.id, "example-japan-trip");
  assert.equal(s.start, "2026-09-26T19:40");
  assert.equal(s.blocks, 151);
  assert.deepEqual(s.tally, { done: 141, changed: 6, skipped: 0, unmarked: 4 });
  assert.equal(s.blocksList, undefined);
});

test("a mission comes back in the v1 format, with or without .json", () => {
  const a = get("/api/v1/missions/example-japan-trip.json");
  const b = get("/api/v1/missions/example-japan-trip");
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, b.body);
  assert.equal(a.body.blocks.length, 151);
  assert.equal(Object.keys(a.body.memos).length, 10);
});

test("timeline is grouped by day", () => {
  const { body } = get("/api/v1/missions/example-japan-trip/timeline.json");
  assert.equal(body.days.length, 10);
  assert.equal(body.days[0].label, "Sat 26 Sep");
  assert.equal(body.days[0].items[0].block.title, "Immigration and customs, FUK");
  assert.ok(body.days.flatMap((d) => d.items).some((i) => i.type === "deadline"));
});

test("live: in the fog on 剣山, Japan time", () => {
  const { status, body } = get("/api/v1/missions/example-japan-trip/live.json", "at=2026-10-02T07:20:00%2B09:00");
  assert.equal(status, 200);
  assert.equal(body.tz, "Asia/Tokyo");
  assert.equal(body.wallClock, "2026-10-02T07:20:00");
  assert.equal(body.phase, "during");
  assert.equal(body.current.title, "Lost at a junction");
  assert.equal(body.current.endsInMs, 43 * 60000);
  assert.equal(body.next.title, "剣山 → 次郎笈 ridge in the fog");
});

test("live: the same instant in another time zone, and before/after", () => {
  // 07:20 in Tokyo is 23:20 the day before in London: still Thursday night's sleep.
  const london = get("/api/v1/missions/example-japan-trip/live.json", "at=2026-10-01T22:20:00Z&tz=Europe/London").body;
  assert.equal(london.wallClock, "2026-10-01T23:20:00");
  assert.equal(london.phase, "during");
  assert.notEqual(london.current?.title, "Lost at a junction");

  const before = get("/api/v1/missions/example-japan-trip/live.json", "at=2026-09-20T00:00:00Z").body;
  assert.equal(before.phase, "before");
  assert.equal(before.first.title, "Immigration and customs, FUK");

  const after = get("/api/v1/missions/example-japan-trip/live.json", "", Date.parse("2026-10-15T00:00:00Z")).body;
  assert.equal(after.phase, "after");
  assert.equal(after.tally.done, 141);
});

test("templates: list, and built for a date and zone", () => {
  assert.deepEqual(get("/api/v1/templates.json").body.templates.map((t) => t.id), ["interview", "workout", "date"]);
  const r = get("/api/v1/templates/workout.json", "from=2026-10-15&tz=Asia/Hong_Kong");
  assert.equal(r.status, 200);
  assert.equal(r.body.tz, "Asia/Hong_Kong");
  assert.equal(r.body.blocks[0].date, "2026-10-19");
});

test("ios/latest is the update feed", () => {
  const { body } = get("/api/v1/ios/latest.json");
  assert.deepEqual(Object.keys(body), ["version", "notes", "url"]);
});

test("errors are JSON with a code", () => {
  const cases = [
    ["/api/v1/nope", "", 404, "not_found"],
    ["/api/v1/missions/nope.json", "", 404, "mission_not_found"],
    ["/api/v1/templates/nope.json", "", 404, "template_not_found"],
    ["/api/v1/missions/example-japan-trip/live.json", "at=yesterday", 400, "bad_at"],
    ["/api/v1/missions/example-japan-trip/live.json", "tz=Mars/Olympus", 400, "bad_tz"],
    ["/api/v1/templates/date.json", "from=15/10/2026", 400, "bad_from"],
  ];
  for (const [path, query, status, code] of cases) {
    const r = get(path, query);
    assert.equal(r.status, status, path);
    assert.equal(r.body.error.code, code, path);
  }
  const post = handle(repo, { method: "POST", path: "/api/v1/missions" });
  assert.equal(post.status, 405);
  assert.equal(post.allow, "GET, HEAD, OPTIONS");
  assert.equal(handle(repo, { method: "OPTIONS", path: "/api/v1/missions" }).status, 204);
});

test("static paths cover everything that doesn't depend on the clock", () => {
  assert.deepEqual(staticPaths(repo), [
    "/api/v1",
    "/api/v1/missions",
    "/api/v1/missions/example-japan-trip",
    "/api/v1/missions/example-japan-trip/timeline",
    "/api/v1/export",
    "/api/v1/templates",
    "/api/v1/ios/latest",
  ]);
});

test("bad data fails at load time with a clear message", () => {
  const dir = mkdtempSync(join(tmpdir(), "mt-data-"));
  mkdirSync(join(dir, "missions"));
  writeFileSync(join(dir, "missions", "a.json"), JSON.stringify({ id: "same", name: "A" }));
  writeFileSync(join(dir, "missions", "b.json"), JSON.stringify({ id: "same", name: "B" }));
  assert.throws(() => Repository.fromDir(dir), DataError);

  writeFileSync(join(dir, "missions", "b.json"), JSON.stringify({ id: "Bad Id", name: "B" }));
  assert.throws(() => Repository.fromDir(dir), /lowercase/);

  writeFileSync(join(dir, "missions", "b.json"), "{ nope");
  assert.throws(() => Repository.fromDir(dir), /isn't valid JSON/);
});

test("a data folder can hold an export file with several missions", () => {
  const dir = mkdtempSync(join(tmpdir(), "mt-data-"));
  mkdirSync(join(dir, "missions"));
  writeFileSync(join(dir, "missions", "all.json"), JSON.stringify({ format: "mission-timeline/v1", missions: [{ id: "one" }, { id: "two" }] }));
  const r = Repository.fromDir(dir);
  assert.deepEqual(r.missions().map((m) => m.id), ["one", "two"]);
  assert.equal(r.updateFeed(), null);
  assert.equal(handle(r, { path: "/api/v1/ios/latest.json" }).status, 404);
});
