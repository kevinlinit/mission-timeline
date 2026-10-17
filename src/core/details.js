import { blockTimes, dayLabel } from "./time.js";
import { sorted } from "./model.js";
import { describeBlock } from "./timeline.js";

/**
 * Everything a client shows when you tap a block, worked out from the mission and the time.
 * Pure, so the web app and the API agree; the iOS app has a Swift port (BlockDetails.swift).
 *
 *   kind       "deadline" | "planB" | the category (do, prep, move, rest, fuel, admin)
 *   timing     { phase: upcoming | now | past, start, end, startsInMs, endsInMs, progress, minutes, day }
 *   prev/next  neighbouring main-plan blocks
 *   slackMs    gap between this block's end and the next block's start (negative if they overlap)
 *   checklist  the note split into steps, for admin, prep and deadlines
 *   planB      Plan B blocks that could replace this one; for a Plan B block, `replaces` is the reverse
 *   place      { query, directions } to open in a maps app, guessed from the title (null if generic)
 *   reminder   when to be reminded: { at, minutesBefore }, or null if the block has started
 */
export function blockDetails(m, blockId, t) {
  const all = sorted(m);
  const b = all.find((x) => x.id === blockId);
  if (!b) return null;
  const main = all.filter((x) => !x.branch);
  const [t0, t1] = blockTimes(b);
  const overlaps = (x) => { const [a, z] = blockTimes(x); return a < t1 && z > t0; };

  const i = main.indexOf(b);
  const prev = b.branch ? main.filter((x) => blockTimes(x)[0] < t0).pop() : main[i - 1];
  const next = b.branch ? main.find((x) => blockTimes(x)[0] >= t1) : main.slice(i + 1).find((x) => blockTimes(x)[0] >= t0);

  const phase = t < t0 ? "upcoming" : t < t1 ? "now" : "past";
  const kind = b.branch ? "planB" : b.dl ? "deadline" : b.cat;
  const minutesBefore = kind === "deadline" ? 30 : b.cat === "move" && b.fixed ? 15 : 10;

  return {
    block: describeBlock(b),
    kind,
    timing: {
      phase, start: t0, end: t1,
      startsInMs: t0 - t, endsInMs: t1 - t,
      progress: phase === "now" && t1 > t0 ? (t - t0) / (t1 - t0) : phase === "past" ? 1 : 0,
      minutes: Math.round((t1 - t0) / 60000),
      day: dayLabel(b.date),
    },
    prev: prev ? describeBlock(prev) : null,
    next: next ? describeBlock(next) : null,
    slackMs: next ? blockTimes(next)[0] - t1 : null,
    checklist: ["admin", "prep"].includes(b.cat) || b.dl ? steps(b.note) : [],
    planB: b.branch ? [] : all.filter((x) => x.branch && overlaps(x)).map(describeBlock),
    replaces: b.branch ? main.filter(overlaps).map(describeBlock) : [],
    place: placeOf(b),
    reminder: t < t0 - minutesBefore * 60000 ? { at: t0 - minutesBefore * 60000, minutesBefore } : null,
  };
}

/** A note split into steps: one per sentence, line or semicolon. */
export function steps(note) {
  return String(note || "")
    .split(/\n+|;\s*|(?<=[.!?])\s+(?=[A-Z0-9　-鿿])/)
    .map((s) => s.trim().replace(/[.;]$/, ""))
    .filter(Boolean);
}

const GENERIC = /^(the )?(sleep|breakfast|lunch|dinner|brunch|snack|halls?|home|hotel|capsule|room|complex|station|rest|debrief.*|pack.*|light breakfast)$/i;
const MEAL = /^(breakfast|brunch|lunch|dinner|snack|supper|drinks?|coffee)\b/i;
const TIME_OF_DAY = /^(sunset|sunrise|dawn|dusk|night|noon|midnight|the top|the summit)\b/i;

/**
 * Where a block happens, for a maps app, from its title:
 *   moves: the destination ("Metro to Futian, drop bags" -> Futian, "博多 → 別府" -> 別府, "Cross at X instead" -> X)
 *   meals: what comes after "Dinner:" or "Lunch near" ("Dinner: Chaoshan beef hotpot", "Lunch near Huaqiangbei")
 *   others: "Onsen at 萬力屋" -> 萬力屋, otherwise the title before any colon ("OCT Loft creative park")
 * Null for admin, prep and rest, and for generic titles like "Lunch" or "Back to the hotel".
 */
export function placeOf(b) {
  if (["admin", "prep", "rest"].includes(b.cat)) return null;
  // "… instead" and "… at sunset" say when or why, not where.
  const title = String(b.title || "").replace(/\s+instead$/i, "").replace(/\s+at\s+(sunset|sunrise|dawn|dusk|night|noon|midnight)$/i, "");
  const after = (re) => { const m = re.exec(title); return m ? m[1] : null; };
  const atPlace = () => { const p = after(/\bat\s+(.+)$/i); return p && !TIME_OF_DAY.test(p) ? p : null; };
  let query = null, directions = false;
  if (b.cat === "move") {
    query = after(/(?:→|->|\bto\b)\s*(.+)$/i) || atPlace();
    directions = true;
  } else if (title.includes(":")) {
    const [head, ...rest] = title.split(":");
    query = MEAL.test(head.trim()) ? rest.join(":") : head;
  } else if (MEAL.test(title)) {
    query = after(/^\S+\s+(?:near|at|in|inside)\s+(.+)$/i); // "Lunch near Huaqiangbei"; "Breakfast and check out" -> none
  } else {
    // "Climb to Lantau Peak" -> Lantau Peak
    query = atPlace() || after(/^(?:climb|hike|walk|head|go|ride|cycle|run|swim|drive)\s+(?:up\s+|down\s+|back\s+)?to\s+(.+)$/i) || title;
  }
  if (!query) return null;
  query = query.split(/,|\s\/\s|\s\(/)[0].replace(/[.。]$/, "").trim();
  const tooShort = /^[\x00-\x7F]*$/.test(query) ? query.length < 3 : query.length < 1;
  if (tooShort || GENERIC.test(query)) return null;
  return { query, directions };
}
