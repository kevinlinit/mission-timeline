/**
 * Accounts and each account's missions, stored as JSON files under STATE_DIR (default ./var), apart
 * from the published data in data/:
 *
 *   var/accounts.json               { accounts: { [id]: { id, provider, sub, email, name, picture, createdAt, lastSignIn, sessionVersion } } }
 *   var/missions/<account id>.json  { revision, updatedAt, missions, tombstones }
 *
 * Writes go to a temporary file and are renamed into place, one at a time per file, so a crash never
 * leaves half a file. Fine for one server process; a database would replace this for more.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanMission, pruneTombstones } from "../core/index.js";

export const MAX_MISSIONS = 200;

export class AccountStore {
  constructor(dir, { now = () => Date.now() } = {}) {
    this.dir = dir;
    this.now = now;
    this.queues = new Map(); // file -> promise chain, so writes to one file never overlap
    this.accounts = null;
  }

  async load() {
    if (!this.accounts) this.accounts = (await readJson(join(this.dir, "accounts.json")))?.accounts || {};
    return this.accounts;
  }

  /** Create or update the account for a Google identity. Returns the account. */
  async upsertGoogle(identity) {
    const accounts = await this.load();
    const id = `g_${identity.sub}`;
    const t = this.now();
    const prev = accounts[id];
    accounts[id] = {
      id, provider: "google", sub: identity.sub,
      email: identity.email, name: identity.name, picture: identity.picture,
      createdAt: prev?.createdAt || t, lastSignIn: t,
      sessionVersion: prev?.sessionVersion || 1,
    };
    await this.saveAccounts();
    return accounts[id];
  }

  async get(id) { return (await this.load())[id] || null; }

  /** Sign out everywhere: every session issued so far stops working. */
  async bumpSessionVersion(id) {
    const accounts = await this.load();
    if (!accounts[id]) return;
    accounts[id].sessionVersion += 1;
    await this.saveAccounts();
  }

  saveAccounts() {
    return this.write(join(this.dir, "accounts.json"), { accounts: this.accounts });
  }

  /** { revision, updatedAt, missions, tombstones } for an account; revision 0 if it has nothing yet. */
  async missions(id) {
    const data = await readJson(this.missionsFile(id));
    return data ? { ...data, missions: data.missions.map(cleanMission) } : { revision: 0, updatedAt: null, missions: [], tombstones: {} };
  }

  /**
   * Replace an account's missions, if nobody else has changed them since `baseRevision`.
   * Returns { ok: true, state } or { ok: false, state } (the current state, for the client to merge).
   */
  saveMissions(id, { baseRevision, missions, tombstones }) {
    const file = this.missionsFile(id);
    return this.serial(file, async () => {
      const current = await this.missions(id);
      if (baseRevision !== current.revision) return { ok: false, state: current };
      const state = {
        revision: current.revision + 1,
        updatedAt: this.now(),
        missions: missions.map(cleanMission),
        tombstones: pruneTombstones(tombstones, this.now()),
      };
      await atomicWrite(file, state);
      return { ok: true, state };
    });
  }

  missionsFile(id) {
    if (!/^[a-z]_[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("bad account id");
    return join(this.dir, "missions", `${id}.json`);
  }

  write(file, data) { return this.serial(file, () => atomicWrite(file, data)); }

  serial(key, fn) {
    const run = (this.queues.get(key) || Promise.resolve()).then(fn, fn);
    this.queues.set(key, run.catch(() => {}));
    return run;
  }
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

async function atomicWrite(file, data) {
  await mkdir(join(file, ".."), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}
