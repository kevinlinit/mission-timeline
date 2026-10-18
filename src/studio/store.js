/**
 * The studio's staff and customer cases, as JSON files under STATE_DIR next to the accounts:
 *
 *   var/studio/staff.json   { staff: { [email]: { role, addedBy, addedAt } } }   added in the console
 *   var/studio/cases.json   { seq, cases: { [id]: Case } }                         see model.js
 *
 * Staff also come from STUDIO_STAFF ("admin:a@x.com,planner:b@y.com"); those can't be removed in the
 * console, so the studio can't lock itself out. Every change to a case bumps its revision and adds to
 * its history; edits sent with an older baseRevision are refused, so two planners can't overwrite
 * each other.
 */
import { join } from "node:path";
import { cleanMission, rid } from "../core/index.js";
import { atomicWrite, readJson } from "../auth/accounts.js";
import {
  MAX_ITINERARIES, MAX_NOTE, PRIORITIES, ROLES, STAGES, caseSummary, cleanCustomer, cleanProgress, cleanTrip,
  customerMission, isEmail, itineraryId, matches, normEmail, stageLabel,
} from "./model.js";

export class StudioError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

/** "admin:a@x.com, planner:b@y.com" (a bare email is a planner) -> { email: role } */
export function parseStaff(spec = "") {
  const out = {};
  for (const part of String(spec).split(/[,\s]+/).filter(Boolean)) {
    const [role, email] = part.includes(":") ? part.split(":") : ["planner", part];
    if (ROLES.includes(role) && isEmail(email)) out[normEmail(email)] = role;
  }
  return out;
}

const PRIORITY_ORDER = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]));
const COALESCE_MS = 30 * 60 * 1000;

export class StudioStore {
  /** @param seedStaff { email: role } from STUDIO_STAFF */
  constructor(dir, { seedStaff = {}, now = () => Date.now() } = {}) {
    this.dir = join(dir, "studio");
    this.seed = seedStaff;
    this.now = now;
    this.data = null;
    this.staffData = null;
    this.queue = Promise.resolve();
  }

  // ---------- staff ----------

  async loadStaff() {
    if (!this.staffData) this.staffData = (await readJson(join(this.dir, "staff.json")))?.staff || {};
    return this.staffData;
  }

  /** Everyone who can use the console. */
  async staff() {
    const stored = await this.loadStaff();
    const all = { ...Object.fromEntries(Object.entries(stored).map(([e, s]) => [e, { email: e, ...s, locked: false }])) };
    for (const [email, role] of Object.entries(this.seed)) all[email] = { email, role, locked: true, addedBy: "STUDIO_STAFF", addedAt: 0 };
    return Object.values(all).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.email.localeCompare(b.email));
  }

  async roleOf(email) {
    email = normEmail(email);
    return this.seed[email] || (await this.loadStaff())[email]?.role || null;
  }

  setStaff(email, role, by) {
    return this.serial(async () => {
      email = normEmail(email);
      if (!isEmail(email)) throw new StudioError(400, "bad_request", "That isn't an email address.");
      if (!ROLES.includes(role)) throw new StudioError(400, "bad_request", `role must be one of ${ROLES.join(", ")}.`);
      if (this.seed[email]) throw new StudioError(409, "locked", `${email} is set in STUDIO_STAFF on the server; change it there.`);
      const staff = await this.loadStaff();
      staff[email] = { role, addedBy: by, addedAt: staff[email]?.addedAt || this.now() };
      await atomicWrite(join(this.dir, "staff.json"), { staff });
      return this.staff();
    });
  }

  removeStaff(email, by) {
    return this.serial(async () => {
      email = normEmail(email);
      if (this.seed[email]) throw new StudioError(409, "locked", `${email} is set in STUDIO_STAFF on the server; change it there.`);
      if (email === normEmail(by)) throw new StudioError(409, "self", "You can't remove yourself.");
      const staff = await this.loadStaff();
      if (!staff[email]) throw new StudioError(404, "not_found", `${email} isn't on the staff list.`);
      delete staff[email];
      await atomicWrite(join(this.dir, "staff.json"), { staff });
      return this.staff();
    });
  }

  // ---------- cases ----------

  async load() {
    if (!this.data) {
      const d = await readJson(join(this.dir, "cases.json"));
      this.data = { seq: d?.seq || 0, cases: d?.cases || {} };
    }
    return this.data;
  }

  /** Summaries matching the filters, most urgent and most recently touched first, with counts per stage. */
  async list(filter = {}) {
    const all = Object.values((await this.load()).cases);
    const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
    for (const c of all) if (matches(c, { ...filter, status: "", open: false })) counts[c.status]++;
    const cases = all.filter((c) => matches(c, filter))
      .sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority] || b.updatedAt - a.updatedAt)
      .map(caseSummary);
    return { cases, counts, total: all.length };
  }

  async get(id) {
    const c = (await this.load()).cases[id];
    if (!c) throw new StudioError(404, "not_found", "No such case.");
    return c;
  }

  create(input, by) {
    return this.serial(async () => {
      const data = await this.load();
      const customer = cleanCustomer(input.customer);
      if (!customer.name && !customer.email) throw new StudioError(400, "bad_request", "A case needs the customer's name or email.");
      if (customer.email && !isEmail(customer.email)) throw new StudioError(400, "bad_request", "The customer's email doesn't look right.");
      const t = this.now();
      data.seq += 1;
      const id = `c_${rid()}${rid().slice(0, 4)}`;
      const c = {
        id, ref: `C-${String(data.seq).padStart(4, "0")}`, revision: 1, createdAt: t, updatedAt: t, createdBy: by,
        status: STAGES.includes(input.status) ? input.status : "new",
        priority: PRIORITIES.includes(input.priority) ? input.priority : "normal",
        assignee: await this.staffEmail(input.assignee),
        customer, trip: cleanTrip(input.trip),
        notes: [], history: [{ at: t, by, type: "created", text: "Case opened" }], itineraries: [],
      };
      if (input.note) c.notes.push({ id: rid(), at: t, by, text: String(input.note).slice(0, MAX_NOTE) });
      data.cases[id] = c;
      await this.save();
      return c;
    });
  }

  /**
   * Change a case's fields: { status, priority, assignee, customer, trip }. Each change is written to
   * the history. With baseRevision, refuses if someone else changed the case since.
   */
  update(id, patch, by, baseRevision) {
    return this.change(id, by, baseRevision, async (c, log) => {
      if ("status" in patch) {
        if (!STAGES.includes(patch.status)) throw new StudioError(400, "bad_request", `status must be one of ${STAGES.join(", ")}.`);
        if (patch.status !== c.status) { log("status", `${stageLabel(c.status)} → ${stageLabel(patch.status)}`); c.status = patch.status; }
      }
      if ("priority" in patch) {
        if (!PRIORITIES.includes(patch.priority)) throw new StudioError(400, "bad_request", `priority must be one of ${PRIORITIES.join(", ")}.`);
        if (patch.priority !== c.priority) { log("priority", `Priority ${c.priority} → ${patch.priority}`); c.priority = patch.priority; }
      }
      if ("assignee" in patch) {
        const a = await this.staffEmail(patch.assignee);
        if (a !== c.assignee) { log("assignee", a ? `Assigned to ${a}` : "Unassigned"); c.assignee = a; }
      }
      if ("customer" in patch) {
        const next = cleanCustomer({ ...c.customer, ...patch.customer });
        if (next.email && !isEmail(next.email)) throw new StudioError(400, "bad_request", "The customer's email doesn't look right.");
        if (!next.name && !next.email) throw new StudioError(400, "bad_request", "A case needs the customer's name or email.");
        const changed = Object.keys(next).filter((k) => next[k] !== c.customer[k]);
        if (changed.length) {
          log("customer", changed.includes("email") ? `Customer email ${c.customer.email || "(none)"} → ${next.email || "(none)"}` : `Customer details: ${changed.join(", ")}`);
          c.customer = next;
        }
      }
      if ("trip" in patch) {
        const next = cleanTrip({ ...c.trip, ...patch.trip, budget: { ...c.trip.budget, ...patch.trip?.budget } });
        const changed = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(c.trip[k]));
        if (changed.length) { log("trip", `Trip details: ${changed.join(", ")}`); c.trip = next; }
      }
    });
  }

  addNote(id, text, by) {
    text = String(text || "").trim();
    if (!text) throw new StudioError(400, "bad_request", "The note is empty.");
    return this.change(id, by, undefined, (c, log) => {
      c.notes.push({ id: rid(), at: this.now(), by, text: text.slice(0, MAX_NOTE) });
      log("note", "Added a note");
    });
  }

  /** Delete a case for good (admins). Cancelling is the usual way to close one. */
  remove(id) {
    return this.serial(async () => {
      const data = await this.load();
      if (!data.cases[id]) throw new StudioError(404, "not_found", "No such case.");
      delete data.cases[id];
      await this.save();
    });
  }

  // ---------- itineraries ----------

  /** Add an itinerary (no missionId) or replace one's mission. Customer marks are kept for blocks that still exist. */
  putItinerary(id, missionId, mission, by, baseRevision) {
    return this.change(id, by, baseRevision, (c, log) => {
      const t = this.now();
      const existing = missionId && c.itineraries.find((i) => i.mission.id === missionId);
      if (missionId && !existing) throw new StudioError(404, "not_found", "No such itinerary on this case.");
      if (!existing && c.itineraries.length >= MAX_ITINERARIES) throw new StudioError(413, "too_many", `At most ${MAX_ITINERARIES} itineraries per case.`);
      const m = cleanMission({ ...mission, id: existing ? missionId : itineraryId(c.id), example: false, updatedAt: t, createdAt: existing?.mission.createdAt || t });
      // Statuses belong to the customer: the studio's copy keeps none of its own.
      m.blocks = m.blocks.map((b) => ({ ...b, status: "" }));
      if (existing) {
        const ids = new Set(m.blocks.map((b) => b.id));
        existing.progress.blocks = Object.fromEntries(Object.entries(existing.progress.blocks).filter(([b]) => ids.has(b)));
        existing.mission = m;
        log("itinerary", `Updated itinerary “${m.name}”${existing.shared ? " (the customer sees the change)" : ""}`);
      } else {
        c.itineraries.push({ mission: m, shared: false, sharedAt: 0, progress: { blocks: {}, memos: {}, at: 0 } });
        log("itinerary", `Added itinerary “${m.name}”`);
      }
      c.lastItinerary = m.id; // read back by the handler
    });
  }

  deleteItinerary(id, missionId, by) {
    return this.change(id, by, undefined, (c, log) => {
      const i = c.itineraries.findIndex((x) => x.mission.id === missionId);
      if (i < 0) throw new StudioError(404, "not_found", "No such itinerary on this case.");
      log("itinerary", `Removed itinerary “${c.itineraries[i].mission.name}”`);
      c.itineraries.splice(i, 1);
    });
  }

  /** Share an itinerary with the customer, or take it back. The first share moves an early case to "Proposal sent". */
  share(id, missionId, shared, by) {
    return this.change(id, by, undefined, (c, log) => {
      const it = c.itineraries.find((x) => x.mission.id === missionId);
      if (!it) throw new StudioError(404, "not_found", "No such itinerary on this case.");
      if (shared && !isEmail(c.customer.email)) throw new StudioError(409, "no_email", "Add the customer's email first: it's how the itinerary reaches their app.");
      if (it.shared === !!shared) return;
      it.shared = !!shared;
      it.sharedAt = shared ? this.now() : it.sharedAt;
      log("share", shared ? `Shared “${it.mission.name}” with ${c.customer.email}` : `Stopped sharing “${it.mission.name}”`);
      if (shared && ["new", "planning"].includes(c.status)) {
        log("status", `${stageLabel(c.status)} → ${stageLabel("proposal_sent")}`);
        c.status = "proposal_sent";
      }
    });
  }

  // ---------- the customer's side ----------

  /** Shared itineraries for a customer's (verified) email, newest case first. */
  async forCustomer(email) {
    email = normEmail(email);
    if (!email) return [];
    const out = [];
    for (const c of Object.values((await this.load()).cases)) {
      if (c.customer.email !== email || c.status === "cancelled") continue;
      for (const it of c.itineraries) if (it.shared) out.push({ c, it });
    }
    return out.sort((a, b) => b.c.createdAt - a.c.createdAt);
  }

  /**
   * The customer's done / changed / skipped marks and debrief notes for a shared itinerary:
   * { blocks: { [blockId]: { status, at } }, memos: { [date]: text } }. The newer mark wins per block.
   */
  recordProgress(email, missionId, input) {
    return this.serial(async () => {
      const found = (await this.forCustomer(email)).find(({ it }) => it.mission.id === missionId);
      if (!found) throw new StudioError(404, "not_found", "No such trip from your studio.");
      const { c, it } = found;
      const t = this.now();
      const ids = new Map(it.mission.blocks.map((b) => [b.id, b]));
      const incoming = cleanProgress({ blocks: Object.fromEntries(Object.entries(input.blocks || {}).map(([k, v]) => [k, { status: v?.status ?? v, at: Math.min(Number(v?.at) || t, t) }])), memos: input.memos });
      const marks = [];
      for (const [bid, v] of Object.entries(incoming.blocks)) {
        if (!ids.has(bid)) continue;
        const prev = it.progress.blocks[bid];
        if (prev && prev.at >= v.at) continue;
        if ((prev?.status || "") !== v.status) marks.push(`${ids.get(bid).title}: ${v.status || "cleared"}`);
        it.progress.blocks[bid] = v;
      }
      const memoDays = Object.keys(incoming.memos).filter((d) => it.progress.memos[d] !== incoming.memos[d]);
      for (const d of memoDays) it.progress.memos[d] = incoming.memos[d];
      if (marks.length || memoDays.length) {
        it.progress.at = t;
        const text = [marks.length && `Marked ${marks.join("; ")}`, memoDays.length && `Debrief notes for ${memoDays.join(", ")}`].filter(Boolean).join(". ");
        // One history line per stretch of activity, not one per tap.
        const last = c.history.at(-1);
        if (last?.type === "progress" && last.mission === missionId && t - last.at < COALESCE_MS) {
          last.text = `${last.text}; ${text.replace(/^Marked /, "")}`.slice(-1000);
          last.at = t;
        } else {
          c.history.push({ at: t, by: "customer", type: "progress", mission: missionId, text: `${it.mission.name}: ${text}`.slice(0, 1000) });
        }
        c.revision += 1;
        c.updatedAt = t;
        await this.save();
      }
      return customerMission(it);
    });
  }

  // ---------- helpers ----------

  /** A staff email, or "" for nobody; anything else is refused. */
  async staffEmail(v) {
    const e = normEmail(v);
    if (!e) return "";
    if (!(await this.roleOf(e))) throw new StudioError(400, "bad_request", `${e} isn't on the staff list.`);
    return e;
  }

  change(id, by, baseRevision, fn) {
    return this.serial(async () => {
      const c = await this.get(id);
      if (Number.isInteger(baseRevision) && baseRevision !== c.revision) {
        throw new StudioError(409, "conflict", "Someone else changed this case. Here's the latest; check it and try again.", { case: c });
      }
      const before = JSON.stringify(c);
      const t = this.now();
      const log = (type, text) => c.history.push({ at: t, by, type, text });
      try {
        await fn(c, log);
      } catch (e) {
        this.data.cases[id] = JSON.parse(before); // leave nothing half-changed
        throw e;
      }
      const last = c.lastItinerary;
      delete c.lastItinerary;
      if (JSON.stringify(c) !== before) {
        c.revision += 1;
        c.updatedAt = t;
        if (c.history.length > 500) c.history.splice(0, c.history.length - 500);
        await this.save();
      }
      return last ? { case: c, missionId: last } : { case: c };
    });
  }

  save() { return atomicWrite(join(this.dir, "cases.json"), this.data); }

  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }
}

