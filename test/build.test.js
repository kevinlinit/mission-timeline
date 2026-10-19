import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../scripts/build.js";
import { Repository } from "../src/api/repository.js";
import { handle } from "../src/api/router.js";

test("the static export has the landing page, the core and every static route", async () => {
  const out = mkdtempSync(join(tmpdir(), "mt-dist-"));
  const { files } = await build({ out });
  for (const f of ["index.html", "core/index.js", "core/time.js", ".nojekyll", "ios/latest.json"]) {
    assert.ok(existsSync(join(out, f)), f);
  }
  assert.ok(files.includes("api/v1.json"));
  assert.ok(files.includes("api/v1/missions/example-japan-trip/timeline.json"));
  assert.ok(!files.some((f) => f.includes("/live")), "live needs the server");

  // Each file is exactly what the server answers.
  const repo = Repository.fromDir(new URL("../data", import.meta.url).pathname);
  for (const f of files.filter((x) => x.startsWith("api/"))) {
    const path = "/" + f.replace(/\.json$/, "");
    assert.deepEqual(JSON.parse(readFileSync(join(out, f), "utf8")), handle(repo, { path }).body, f);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(out, "ios/latest.json"), "utf8")), repo.updateFeed());
});

