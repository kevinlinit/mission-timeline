import test from "node:test";
import assert from "node:assert/strict";
import * as MT from "../src/core/index.js";

// Floating time: wall-clock ms as if UTC. Same result on every machine.
const t = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

test("toMin parses valid times and rejects bad ones", () => {
  assert.equal(MT.toMin("00:00"), 0);
  assert.equal(MT.toMin("9:05"), 545);
  assert.equal(MT.toMin("23:59"), 1439);
  assert.equal(MT.toMin("24:00"), null);
  assert.equal(MT.toMin("12:60"), null);
  assert.equal(MT.toMin("noon"), null);
});

test("a block ending before it starts runs into the next day", () => {
  const [t0, t1] = MT.blockTimes({ date: "2026-10-09", s: "23:00", e: "07:00" });
  assert.equal(t1 - t0, 8 * 3600000);
});

test("a zero-length block stays zero-length", () => {
  const [t0, t1] = MT.blockTimes({ date: "2026-10-09", s: "10:00", e: "10:00" });
  assert.equal(t1, t0);
});

test("floating time ignores DST: a night across the change is still 8 hours", () => {
  const [t0, t1] = MT.blockTimes({ date: "2026-03-28", s: "23:00", e: "07:00" });
  assert.equal(t1 - t0, 8 * 3600000);
});

test("floatingNow converts an instant to a time zone's wall clock", () => {
  const instant = Date.parse("2026-10-01T22:20:00Z");
  assert.equal(MT.floatingNow(instant, "Asia/Tokyo"), t(2026, 10, 2, 7, 20));
  assert.equal(MT.floatingNow(instant, "UTC"), t(2026, 10, 1, 22, 20));
  assert.equal(MT.floatingNow(instant, "America/New_York"), t(2026, 10, 1, 18, 20));
});

test("labels and countdowns", () => {
  assert.equal(MT.dayLabel("2026-10-15"), "Thu 15 Oct");
  assert.equal(MT.countdown(3 * 86400000 + 20 * 3600000 + 52 * 60000), "3d 20h 52m");
  assert.equal(MT.countdown(3600000 + 5 * 60000 + 9000), "1h 05m 09s");
  assert.equal(MT.countdown(-5), "0m 00s");
  assert.equal(MT.dur(105), "1h 45m");
});

test("cleanBlock fills defaults and drops unknown values", () => {
  const b = MT.cleanBlock({ title: "Run", cat: "nonsense", s: "7:00", e: "bad", status: "maybe" }, t(2026, 10, 15));
  assert.equal(b.cat, "do");
  assert.equal(b.date, "2026-10-15");
  assert.equal(b.e, "7:00");
  assert.equal(b.status, "");
  assert.ok(b.id);
});

test("cleanMission keeps a valid time zone and drops a bad one", () => {
  assert.equal(MT.cleanMission({ tz: "Asia/Tokyo" }).tz, "Asia/Tokyo");
  assert.equal(MT.cleanMission({ tz: "Mars/Olympus" }).tz, "");
  assert.deepEqual(MT.cleanMission({ memos: { "2026-10-01": "ok", nope: "x", "2026-10-02": 5 } }).memos, { "2026-10-01": "ok" });
});

test("liveState walks through before, during and after", () => {
  const m = MT.cleanMission({
    name: "Test",
    blocks: [
      { date: "2026-10-10", s: "08:00", e: "09:00", title: "A", dl: true },
      { date: "2026-10-10", s: "09:00", e: "10:00", title: "B", status: "done" },
      { date: "2026-10-10", s: "08:00", e: "09:00", title: "Rain plan", opt: true, branch: "If it rains" },
    ],
  });
  const before = MT.liveState(m, t(2026, 10, 10, 7));
  assert.equal(before.phase, "before");
  assert.equal(before.nextDeadline.title, "A");

  const during = MT.liveState(m, t(2026, 10, 10, 8, 30));
  assert.equal(during.phase, "during");
  assert.equal(during.current.title, "A");
  assert.equal(during.next.title, "B");
  assert.equal(during.planB.length, 1);

  const after = MT.liveState(m, t(2026, 10, 10, 11));
  assert.equal(after.phase, "after");
  assert.deepEqual(after.tally, { done: 1, changed: 0, skipped: 0, unmarked: 1 });
});

test("an empty mission has an empty live state", () => {
  assert.equal(MT.liveState(MT.cleanMission({}), Date.now()).phase, "empty");
});

test("every template builds valid future blocks with a hard deadline and a Plan B", () => {
  const from = t(2026, 10, 15, 12);
  for (const [key, tpl] of Object.entries(MT.TEMPLATES)) {
    const m = MT.cleanMission(tpl.build(from));
    assert.ok(m.blocks.length >= 8, key);
    assert.ok(m.blocks.some((b) => b.dl), `${key} has a deadline`);
    assert.ok(m.blocks.some((b) => b.branch), `${key} has a Plan B`);
    for (const b of m.blocks) assert.ok(MT.toMin(b.s) !== null && MT.toMin(b.e) !== null, `${key}: ${b.title}`);
    const first = Math.min(...m.blocks.map((b) => MT.blockTimes(b)[0]));
    assert.ok(first > from, `${key} starts in the future`);
  }
  assert.equal(MT.TEMPLATES.workout.build(from).blocks[0].date, "2026-10-19", "training week starts next Monday");
});

test("timelineDays orders deadline, block and Plan B, and counts per day", () => {
  const m = MT.cleanMission(MT.TEMPLATES.workout.build(t(2026, 10, 15, 12)));
  const days = MT.timelineDays(m);
  assert.equal(days.length, 7);
  const sat = days[5];
  assert.equal(sat.label, "Sat 24 Oct");
  assert.equal(sat.deadlines, 1);
  const kinds = sat.items.map((i) => i.type + ":" + (i.block?.title || i.label));
  assert.deepEqual(kinds, [
    "block:Travel to the trailhead",
    "block:Long hike",
    "planB:If it rains",
    "deadline:Turn-back time",
    "block:Turn-back time",
    "block:Recovery meal",
  ]);
  const sleep = days[4].items.find((i) => i.block?.title === "Sleep early").block;
  assert.equal(sleep.endsNextDay, true);
  assert.equal(sleep.minutes, 480);
  assert.equal(sleep.emoji, "😴");
});

test("summarize gives the span and counts", () => {
  const m = MT.cleanMission(MT.TEMPLATES.date.build(t(2026, 10, 15, 12)));
  const s = MT.summarize(m);
  assert.equal(s.start, "2026-10-20T20:00");
  assert.equal(s.end, "2026-10-25T11:10");
  assert.equal(s.blocks, 9);
  assert.equal(s.planB, 1);
  assert.deepEqual(s.tally, { done: 0, changed: 0, skipped: 0, unmarked: 9 });
});

test("export and import round-trip", () => {
  const m = MT.cleanMission(MT.TEMPLATES.date.build(t(2026, 10, 15)));
  m.memos["2026-10-17"] = "Great evening";
  const back = MT.importData(MT.exportData([m]));
  assert.equal(back.length, 1);
  assert.deepEqual(back[0], m);
});

test("import rejects files without missions", () => {
  assert.throws(() => MT.importData('{"hello": 1}'), /doesn't contain any missions/);
  assert.throws(() => MT.importData("not json"), /isn't valid JSON/);
});

test("placeOf guesses where a block happens from its title", () => {
  const p = (cat, title) => MT.placeOf({ cat, title });
  assert.deepEqual(p("move", "High-speed rail: Guangzhou South → Shenzhen North"), { query: "Shenzhen North", directions: true });
  assert.deepEqual(p("move", "Metro to Futian, drop bags at the hotel"), { query: "Futian", directions: true });
  assert.deepEqual(p("move", "Subway to 博多"), { query: "博多", directions: true });
  assert.deepEqual(p("move", "Cross at Futian Checkpoint instead"), { query: "Futian Checkpoint", directions: true });
  assert.deepEqual(p("fuel", "Dinner: Chaoshan beef hotpot"), { query: "Chaoshan beef hotpot", directions: false });
  assert.deepEqual(p("fuel", "Lunch near Huaqiangbei"), { query: "Huaqiangbei", directions: false });
  assert.deepEqual(p("do", "Onsen at 萬力屋"), { query: "萬力屋", directions: false });
  assert.deepEqual(p("do", "Shenzhen Bay Park at sunset"), { query: "Shenzhen Bay Park", directions: false });
  for (const [cat, title] of [["move", "Back to the hotel"], ["fuel", "Breakfast and check out"], ["fuel", "Lunch"], ["do", "Halls: shortlist suppliers"], ["admin", "Badge and entry, Canton Fair"], ["rest", "Sleep"]]) {
    assert.equal(p(cat, title), null, title);
  }
});

test("steps splits a note into a checklist", () => {
  assert.deepEqual(MT.steps("Lay out clothes, print your CV. Check the route; bring cash.\nPassport"), ["Lay out clothes, print your CV", "Check the route", "bring cash", "Passport"]);
  assert.deepEqual(MT.steps(""), []);
});

test("blockDetails: timing, neighbours, slack and reminders", () => {
  const m = MT.cleanMission(MT.TEMPLATES.workout.build(t(2026, 10, 15, 12)));
  const hike = m.blocks.find((b) => b.title === "Long hike");
  const d = MT.blockDetails(m, hike.id, t(2026, 10, 24, 9));
  assert.equal(d.kind, "do");
  assert.equal(d.timing.phase, "now");
  assert.equal(d.timing.minutes, 300);
  assert.equal(Math.round(d.timing.progress * 100), 10);
  assert.equal(d.prev.title, "Travel to the trailhead");
  assert.equal(d.next.title, "Turn-back time", "the next main block, Plan B excluded");
  assert.equal(d.planB.map((b) => b.title).join(), "Indoor stair session instead");
  assert.equal(d.reminder, null, "already started");

  const turnBack = m.blocks.find((b) => b.dl);
  const early = MT.blockDetails(m, turnBack.id, t(2026, 10, 24, 7));
  assert.equal(early.kind, "deadline");
  assert.equal(early.timing.phase, "upcoming");
  assert.deepEqual(early.reminder, { at: t(2026, 10, 24, 10, 30), minutesBefore: 30 });
  assert.deepEqual(early.checklist, ["Wherever you are at 11:00, turn back"]);

  const rain = m.blocks.find((b) => b.branch);
  const pb = MT.blockDetails(m, rain.id, t(2026, 10, 24, 7));
  assert.equal(pb.kind, "planB");
  assert.deepEqual(pb.replaces.map((b) => b.title), ["Long hike"]);

  const meal = m.blocks.find((b) => b.title === "Recovery meal");
  assert.equal(MT.blockDetails(m, meal.id, t(2026, 10, 25)).timing.phase, "past");
  assert.equal(MT.blockDetails(m, "nope", 0), null);
});

test("blockDetails: slack to the next block", () => {
  const m = MT.cleanMission({ blocks: [
    { id: "a", date: "2026-10-16", s: "17:30", e: "19:30", title: "Bay" },
    { id: "b", date: "2026-10-16", s: "19:45", e: "21:00", cat: "fuel", title: "Dinner: hotpot" },
  ] });
  assert.equal(MT.blockDetails(m, "a", 0).slackMs, 15 * 60000);
  assert.equal(MT.blockDetails(m, "b", 0).slackMs, null);
});
