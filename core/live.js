import { blockTimes } from "./time.js";
import { sorted } from "./model.js";

/**
 * What the live panel shows at floating time t.
 *   { phase: "empty" }
 *   { phase: "before", start, first, nextDeadline }
 *   { phase: "during", current, next, nextDeadline, planB }
 *   { phase: "after",  tally: { done, changed, skipped, unmarked } }
 * Plan B blocks never count as the current or next block; they're reported in `planB` while they run.
 */
export function liveState(m, t) {
  const all = sorted(m);
  const main = all.filter((b) => !b.branch);
  const branches = all.filter((b) => b.branch);
  if (!main.length) return { phase: "empty" };
  const start = blockTimes(main[0])[0];
  const end = Math.max(...main.map((b) => blockTimes(b)[1]));
  const inBlock = (b) => { const [a, z] = blockTimes(b); return a <= t && t < z; };
  const next = main.find((b) => blockTimes(b)[0] > t) || null;
  const nextDeadline = main.filter((b) => b.dl).find((b) => blockTimes(b)[0] > t) || null;
  if (t < start) return { phase: "before", start, first: main[0], nextDeadline };
  if (t >= end) return { phase: "after", tally: tally(main) };
  return {
    phase: "during",
    current: main.filter(inBlock).pop() || null,
    next, nextDeadline,
    planB: branches.filter(inBlock),
  };
}

/** Status counts over the main plan. */
export function tally(mainBlocks) {
  const count = (s) => mainBlocks.filter((b) => b.status === s).length;
  return { done: count("done"), changed: count("changed"), skipped: count("skipped"), unmarked: mainBlocks.filter((b) => !b.status).length };
}
