import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cleanMission, importData } from "../core/index.js";

export class DataError extends Error {}

/**
 * Read-only store of the published data:
 *   data/missions/*.json   one mission per file (a bare mission, or an export file with missions)
 *   data/ios/latest.json   the iOS update feed: { version, notes, url }
 * Everything is loaded and validated once, so a bad file fails at startup or build, not on a request.
 */
export class Repository {
  constructor({ missions, updateFeed }) {
    this.byId = new Map();
    for (const m of missions) {
      if (this.byId.has(m.id)) throw new DataError(`Two missions have the id "${m.id}".`);
      this.byId.set(m.id, m);
    }
    this.feed = updateFeed;
    // Changes whenever the data does; used in the API index so clients can tell.
    this.revision = createHash("sha1").update(JSON.stringify([missions, updateFeed])).digest("hex").slice(0, 12);
  }

  static fromDir(dir) {
    const missionsDir = join(dir, "missions");
    const missions = [];
    if (existsSync(missionsDir)) {
      for (const file of readdirSync(missionsDir).filter((f) => f.endsWith(".json")).sort()) {
        const text = readFileSync(join(missionsDir, file), "utf8");
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { throw new DataError(`${file} isn't valid JSON: ${e.message}`); }
        const list = parsed && !Array.isArray(parsed) && !parsed.missions ? [cleanMission(parsed)] : importData(text);
        for (const m of list) {
          if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.id)) throw new DataError(`${file}: mission id "${m.id}" must be lowercase letters, digits and dashes.`);
          missions.push(m);
        }
      }
    }
    const feedFile = join(dir, "ios", "latest.json");
    const updateFeed = existsSync(feedFile) ? validateFeed(JSON.parse(readFileSync(feedFile, "utf8"))) : null;
    return new Repository({ missions, updateFeed });
  }

  missions() { return [...this.byId.values()]; }
  mission(id) { return this.byId.get(id) || null; }
  updateFeed() { return this.feed; }
}

function validateFeed(f) {
  if (!f || typeof f.version !== "string" || !/^v?\d+(\.\d+)*$/.test(f.version)) {
    throw new DataError('data/ios/latest.json needs a "version" like "1.2.0".');
  }
  return { version: f.version, notes: String(f.notes || ""), url: String(f.url || "") };
}
