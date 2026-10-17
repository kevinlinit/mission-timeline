/**
 * The mission-timeline/v1 data model, shared by the API, the web app and (as a Swift port) the iOS app.
 *
 * Mission: {id, name, emoji, goal, highlight, createdAt, updatedAt, example, tz, blocks: Block[], memos: {"YYYY-MM-DD": text}}
 * Block:   {id, date, s, e, cat, title, note, em, fixed, opt, dl, branch, status}
 *
 * `tz` (optional, IANA name) is the time zone the mission's wall-clock times are in. Clients that don't
 * know it ignore it; the API uses it for the live state.
 */
import { blockTimes, isDate, isoDate, floatingNow, isTimeZone, toMin } from "./time.js";

export const CATS = {
  do: ["Do", "🎯"],
  prep: ["Prep", "📝"],
  move: ["Move", "🚶"],
  rest: ["Rest", "😴"],
  fuel: ["Fuel", "🍽️"],
  admin: ["Admin", "📋"],
};
export const STATUSES = ["done", "changed", "skipped"];

export const rid = () => Math.random().toString(36).slice(2, 10);

/** A valid block from anything: bad or missing values fall back to defaults. `today` is floating ms. */
export function cleanBlock(b, today = floatingNow()) {
  b = b || {};
  const cat = CATS[b.cat] ? b.cat : "do";
  const s = toMin(b.s) !== null ? b.s : "09:00";
  const e = toMin(b.e) !== null ? b.e : s;
  return {
    id: String(b.id || rid()),
    date: isDate(b.date) ? b.date : isoDate(today),
    s, e, cat,
    title: String(b.title || "Untitled").slice(0, 120),
    note: String(b.note || "").slice(0, 600),
    em: String(b.em || "").slice(0, 4),
    fixed: !!b.fixed, opt: !!b.opt, dl: !!b.dl,
    branch: String(b.branch || "").slice(0, 80),
    status: STATUSES.includes(b.status) ? b.status : "",
  };
}

export function cleanMission(m) {
  m = m || {};
  return {
    id: String(m.id || rid()),
    name: String(m.name || "Untitled mission").slice(0, 80),
    emoji: String(m.emoji || "🎯").slice(0, 4),
    goal: String(m.goal || "").slice(0, 300),
    highlight: String(m.highlight || "").slice(0, 400),
    createdAt: Number(m.createdAt) || Date.now(),
    // When the mission was last changed (ms); sync keeps the newer copy. Older files fall back to createdAt.
    updatedAt: Number(m.updatedAt) || Number(m.createdAt) || Date.now(),
    example: !!m.example,
    tz: isTimeZone(m.tz) ? m.tz : "",
    blocks: Array.isArray(m.blocks) ? m.blocks.map((b) => cleanBlock(b)) : [],
    memos: m.memos && typeof m.memos === "object" && !Array.isArray(m.memos)
      ? Object.fromEntries(Object.entries(m.memos).filter(([d, v]) => isDate(d) && typeof v === "string"))
      : {},
  };
}

/** Blocks by start time; blocks starting together keep their order. */
export const sorted = (m) => [...m.blocks].sort((a, b) => blockTimes(a)[0] - blockTimes(b)[0]);

/** The emoji a block shows: its own, or its category's. */
export const emojiOf = (b) => b.em || CATS[b.cat][1];
