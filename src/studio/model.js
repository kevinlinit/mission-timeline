/**
 * Customer cases for the studio: who the customer is, what they asked for, where the case is in the
 * pipeline, who's handling it, notes, a history of what happened, and the itineraries planned for it.
 *
 * Case: {
 *   id, ref ("C-0042"), revision, createdAt, updatedAt, createdBy,
 *   status, priority, assignee (staff email or ""),
 *   customer: { name, email, phone },
 *   trip: { start, end, destinations[], travellers, budget: { amount, currency }, source, tags[], request },
 *   notes: [{ id, at, by, text }],
 *   history: [{ at, by, type, text }],          newest last; `by` is a staff email or "customer"
 *   itineraries: [Itinerary],
 * }
 * Itinerary: {
 *   mission,                                    a mission-timeline/v1 mission, edited by staff
 *   shared, sharedAt,                           shared ones show up in the customer's app
 *   progress: { blocks: { [blockId]: { status, at } }, memos: { [date]: text }, at },   from the customer
 * }
 */
import { STATUSES, cleanMission, isDate, rid } from "../core/index.js";

export const PIPELINE = [
  ["new", "New inquiry"],
  ["planning", "Planning"],
  ["proposal_sent", "Proposal sent"],
  ["confirmed", "Confirmed"],
  ["travelling", "Travelling"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];
export const STAGES = PIPELINE.map(([k]) => k);
export const stageLabel = (k) => (PIPELINE.find(([s]) => s === k) || [k, k])[1];
export const PRIORITIES = ["low", "normal", "high", "urgent"];
export const ROLES = ["admin", "planner"];
/** Cases that are still being worked on. */
export const OPEN_STAGES = ["new", "planning", "proposal_sent", "confirmed", "travelling"];

export const MAX_NOTE = 4000;
export const MAX_ITINERARIES = 10;

const str = (v, n) => String(v ?? "").trim().slice(0, n);
export const normEmail = (v) => str(v, 254).toLowerCase();
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || "");

export function cleanCustomer(c = {}) {
  return { name: str(c.name, 120), email: normEmail(c.email), phone: str(c.phone, 40) };
}

export function cleanTrip(t = {}) {
  const list = (v, n, each) => (Array.isArray(v) ? v : String(v || "").split(","))
    .map((x) => str(x, each)).filter(Boolean).slice(0, n);
  const amount = Number(t.budget?.amount);
  return {
    start: isDate(t.start) ? t.start : "",
    end: isDate(t.end) ? t.end : "",
    destinations: list(t.destinations, 20, 80),
    travellers: Math.max(0, Math.min(99, Math.round(Number(t.travellers) || 0))),
    budget: { amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0, currency: str(t.budget?.currency || "USD", 3).toUpperCase() },
    source: str(t.source, 60),
    tags: list(t.tags, 20, 30).map((x) => x.toLowerCase()),
    request: str(t.request, 4000),
  };
}

export function cleanProgress(p = {}) {
  const blocks = {};
  for (const [id, v] of Object.entries(p.blocks || {})) {
    if (v && (STATUSES.includes(v.status) || v.status === "") && Number.isFinite(v.at)) blocks[String(id).slice(0, 64)] = { status: v.status, at: v.at };
  }
  const memos = Object.fromEntries(Object.entries(p.memos || {}).filter(([d, v]) => isDate(d) && typeof v === "string").map(([d, v]) => [d, v.slice(0, 2000)]));
  return { blocks, memos, at: Number(p.at) || 0 };
}

/**
 * What the customer sees: the studio's mission with their own marks and notes on top. Its updatedAt is
 * whichever changed last, so the apps know when to redraw.
 */
export function customerMission(it) {
  const m = cleanMission(it.mission);
  const p = it.progress || { blocks: {}, memos: {}, at: 0 };
  return {
    ...m,
    example: false,
    updatedAt: Math.max(m.updatedAt, p.at || 0),
    blocks: m.blocks.map((b) => (p.blocks[b.id] ? { ...b, status: p.blocks[b.id].status } : b)),
    memos: { ...m.memos, ...p.memos },
  };
}

/** A mission id that's unique across the studio, so it can't collide with customers' own missions. */
export const itineraryId = (caseId) => `st-${caseId.replace(/^c_/, "")}-${rid().slice(0, 6)}`;

/** The line in the case list. */
export function caseSummary(c) {
  const shared = c.itineraries.filter((i) => i.shared);
  const blocks = shared.flatMap((i) => customerMission(i).blocks.filter((b) => !b.branch));
  return {
    id: c.id, ref: c.ref, status: c.status, priority: c.priority, assignee: c.assignee,
    customer: c.customer,
    trip: { start: c.trip.start, end: c.trip.end, destinations: c.trip.destinations, travellers: c.trip.travellers, tags: c.trip.tags },
    itineraries: c.itineraries.length,
    questionnaire: !!c.intake,
    shared: shared.length,
    progress: { done: blocks.filter((b) => b.status).length, total: blocks.length },
    lastActivity: c.history.at(-1) || null,
    createdAt: c.createdAt, updatedAt: c.updatedAt, revision: c.revision,
  };
}

/** Does a case match the list filters? { status, assignee, priority, q, open } */
export function matches(c, f = {}) {
  if (f.status && f.status !== c.status) return false;
  if (f.open && !OPEN_STAGES.includes(c.status)) return false;
  if (f.priority && f.priority !== c.priority) return false;
  if (f.assignee === "none" ? c.assignee : f.assignee && f.assignee !== c.assignee) return false;
  if (f.q) {
    const hay = [c.intake ? "questionnaire" : "", c.ref, c.customer.name, c.customer.email, c.customer.phone, ...c.trip.destinations, ...c.trip.tags, c.trip.request]
      .join(" ").toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}
