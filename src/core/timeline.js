import { blockTimes, dayLabel, isoDate } from "./time.js";
import { CATS, emojiOf, sorted } from "./model.js";
import { tally } from "./live.js";

/**
 * A block with what clients need to draw it: resolved emoji, category label, length and whether it
 * ends the next day.
 */
export function describeBlock(b) {
  const [t0, t1] = blockTimes(b);
  return {
    ...b,
    emoji: emojiOf(b),
    category: CATS[b.cat][0],
    minutes: Math.round((t1 - t0) / 60000),
    endsNextDay: t1 > t0 && isoDate(t1) !== isoDate(t0),
  };
}

/**
 * The timeline day by day, the way every client draws it:
 *   [{ date, label, memo, blocks, deadlines, items: [
 *       { type: "deadline", block }        a hard-deadline marker, just before its block
 *       { type: "block", block }           a main-plan block
 *       { type: "planB", label, blocks }   a Plan B branch, at the time its first block starts
 *   ]}]
 * Items are in time order; at the same time: deadline, then block, then Plan B.
 */
export function timelineDays(m) {
  const all = sorted(m);
  const dates = [...new Set(all.map((b) => b.date))];
  return dates.map((date) => {
    const list = all.filter((b) => b.date === date);
    const main = list.filter((b) => !b.branch);
    const items = [];
    main.forEach((b) => {
      const t = blockTimes(b)[0];
      if (b.dl) items.push({ t, k: 0, item: { type: "deadline", block: describeBlock(b) } });
      items.push({ t, k: 1, item: { type: "block", block: describeBlock(b) } });
    });
    const groups = new Map();
    list.filter((b) => b.branch).forEach((b) => { if (!groups.has(b.branch)) groups.set(b.branch, []); groups.get(b.branch).push(b); });
    groups.forEach((bs, label) => items.push({ t: blockTimes(bs[0])[0], k: 2, item: { type: "planB", label, blocks: bs.map(describeBlock) } }));
    items.sort((a, b) => a.t - b.t || a.k - b.k);
    return {
      date,
      label: dayLabel(date),
      memo: m.memos[date] || "",
      blocks: main.length,
      deadlines: main.filter((b) => b.dl).length,
      items: items.map((x) => x.item),
    };
  });
}

/** One line per mission for lists: span, counts and the debrief tally. */
export function summarize(m) {
  const main = sorted(m).filter((b) => !b.branch);
  const times = main.map(blockTimes);
  const start = times.length ? Math.min(...times.map((t) => t[0])) : null;
  const end = times.length ? Math.max(...times.map((t) => t[1])) : null;
  const local = (t) => (t === null ? null : new Date(t).toISOString().slice(0, 16));
  return {
    id: m.id, name: m.name, emoji: m.emoji, goal: m.goal, highlight: m.highlight, example: m.example, tz: m.tz,
    start: local(start),
    end: local(end),
    days: new Set(m.blocks.map((b) => b.date)).size,
    blocks: main.length,
    deadlines: main.filter((b) => b.dl).length,
    planB: [...new Set(m.blocks.filter((b) => b.branch).map((b) => b.branch))].length,
    tally: tally(main),
  };
}
