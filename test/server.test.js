import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { request } from "node:http";
import { createServer } from "../src/server.js";

let server, base;
before(async () => {
  server = createServer({ now: () => Date.parse("2026-10-01T22:20:00Z") });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** Raw request, so we see the bytes and headers exactly as sent. */
function raw(path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}
const json = (r) => JSON.parse(r.body.toString());

test("JSON with CORS and caching headers", async () => {
  const r = await raw("/api/v1/missions.json");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /application\/json/);
  assert.equal(r.headers["access-control-allow-origin"], "*");
  assert.equal(r.headers["cache-control"], "public, max-age=60");
  assert.ok(r.headers.etag);
  assert.equal(json(r).missions[0].id, "example-japan-trip");
});

test("the live endpoint uses the server clock and is never cached", async () => {
  const r = await raw("/api/v1/missions/example-japan-trip/live.json");
  assert.equal(r.headers["cache-control"], "no-cache");
  assert.equal(json(r).current.title, "Lost at a junction");
});

test("ETag gives 304", async () => {
  const first = await raw("/api/v1/templates.json");
  const again = await raw("/api/v1/templates.json", { headers: { "If-None-Match": first.headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
});

test("gzip for large responses", async () => {
  const r = await raw("/api/v1/missions/example-japan-trip/timeline.json", { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(r.headers["content-encoding"], "gzip");
  assert.equal(JSON.parse(gunzipSync(r.body)).days.length, 10);
});

test("errors, methods and preflight", async () => {
  const missing = await raw("/api/v1/missions/nope.json");
  assert.equal(missing.status, 404);
  assert.equal(json(missing).error.code, "mission_not_found");
  const post = await raw("/api/v1/missions.json", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD, OPTIONS");
  const pre = await raw("/api/v1/missions.json", { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers["access-control-allow-methods"], "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
});

test("HEAD has headers but no body", async () => {
  const r = await raw("/api/v1/missions.json", { method: "HEAD" });
  assert.equal(r.status, 200);
  assert.ok(Number(r.headers["content-length"]) > 0);
  assert.equal(r.body.length, 0);
});

test("the legacy iOS feed URL still works", async () => {
  const r = await raw("/ios/latest.json");
  assert.equal(r.status, 200);
  assert.ok(json(r).version);
});

test("serves the web app and the shared core", async () => {
  const page = await raw("/");
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /<script type="module" src="js\/app.js">/);
  const core = await raw("/core/index.js");
  assert.match(core.headers["content-type"], /javascript/);
  assert.equal((await raw("/js/api.js")).status, 200);
});

test("can't escape the static folders", async () => {
  for (const p of ["/core/..%2f..%2fpackage.json", "/core/%2e%2e/api/repository.js", "/..%2fpackage.json"]) {
    const r = await raw(p);
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.doesNotMatch(r.body.toString(), /"name": "mission-timeline"|class Repository/);
  }
});
