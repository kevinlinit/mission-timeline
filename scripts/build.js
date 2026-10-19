/**
 * Static export: everything GitHub Pages (or any static host) needs, in dist/.
 *
 *   dist/index.html                a landing page pointing to the apps
 *   dist/core/                     the shared core
 *   dist/api/v1.json, api/v1/...   every static API route, as .json files
 *   dist/ios/latest.json           the iOS update feed at the URL the app already uses
 *
 * Routes that depend on the current time (live state, building a template) need the Node server.
 *
 *   npm run build [-- --out other-dir]
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Repository } from "../src/api/repository.js";
import { handle, staticPaths } from "../src/api/router.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function build({ out = join(ROOT, "dist"), dataDir = join(ROOT, "data") } = {}) {
  const repo = Repository.fromDir(dataDir);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(join(ROOT, "public"), out, { recursive: true });
  await cp(join(ROOT, "src", "core"), join(out, "core"), { recursive: true });
  await writeFile(join(out, ".nojekyll"), "");

  const written = [];
  const write = async (rel, body) => {
    const file = join(out, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(body) + "\n");
    written.push(rel);
  };
  for (const path of staticPaths(repo)) {
    const r = handle(repo, { path });
    if (r.status !== 200) throw new Error(`${path} answered ${r.status}`);
    await write(path.slice(1) + ".json", r.body);
  }
  if (repo.updateFeed()) await write("ios/latest.json", repo.updateFeed());
  return { out, files: written, revision: repo.revision };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const { out, files, revision } = await build(i > 0 ? { out: resolve(process.argv[i + 1]) } : {});
  console.log(`Built ${out} (data revision ${revision}):`);
  files.forEach((f) => console.log("  " + f));
}
