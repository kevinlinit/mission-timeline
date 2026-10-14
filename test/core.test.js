const test = require("node:test");
const assert = require("node:assert/strict");
const MT = require("../js/core.js");

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

test("cleanBlock fills defaults and drops unknown values", () => {
  const b = MT.cleanBlock({ title: "Run", cat: "nonsense", s: "7:00", e: "bad", status: "maybe" }, new Date(2026, 9, 15));
  assert.equal(b.cat, "do");
  assert.equal(b.date, "2026-10-15");
  assert.equal(b.e, "7:00");
  assert.equal(b.status, "");
  assert.ok(b.id);
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
  const t = (h, mi = 0) => new Date(2026, 9, 10, h, mi).getTime();

  const before = MT.liveState(m, t(7));
  assert.equal(before.phase, "before");
  assert.equal(before.nextDeadline.title, "A");

  const during = MT.liveState(m, t(8, 30));
  assert.equal(during.phase, "during");
  assert.equal(during.current.title, "A");
  assert.equal(during.next.title, "B");
  assert.equal(during.planB.length, 1);

  const after = MT.liveState(m, t(11));
  assert.equal(after.phase, "after");
  assert.deepEqual(after.tally, { done: 1, changed: 0, skipped: 0, unmarked: 1 });
});

test("an empty mission has an empty live state", () => {
  assert.equal(MT.liveState(MT.cleanMission({}), Date.now()).phase, "empty");
});

test("every template builds valid future blocks with a hard deadline", () => {
  const from = new Date(2026, 9, 15, 12, 0);
  for (const [key, tpl] of Object.entries(MT.TEMPLATES)) {
    const m = MT.cleanMission(tpl.build(from));
    assert.ok(m.blocks.length >= 8, key);
    assert.ok(m.blocks.some((b) => b.dl), `${key} has a deadline`);
    assert.ok(m.blocks.some((b) => b.branch), `${key} has a Plan B`);
    for (const b of m.blocks) assert.ok(MT.toMin(b.s) !== null && MT.toMin(b.e) !== null, `${key}: ${b.title}`);
    const first = Math.min(...m.blocks.map((b) => MT.blockTimes(b)[0]));
    assert.ok(first > from.getTime(), `${key} starts in the future`);
  }
});

test("export and import round-trip", () => {
  const m = MT.cleanMission(MT.TEMPLATES.date.build(new Date(2026, 9, 15)));
  m.memos["2026-10-17"] = "Great evening";
  const back = MT.importData(MT.exportData([m]));
  assert.equal(back.length, 1);
  assert.equal(back[0].name, "Date night");
  assert.equal(back[0].memos["2026-10-17"], "Great evening");
  assert.equal(back[0].blocks.length, m.blocks.length);
});

test("import rejects files without missions", () => {
  assert.throws(() => MT.importData('{"hello": 1}'), /doesn't contain any missions/);
  assert.throws(() => MT.importData("not json"));
});

test("the Japan trip example is a valid, finished mission", () => {
  const m = MT.cleanMission(require("../js/demo-japan.js"));
  assert.equal(m.blocks.length, 151);
  for (const b of m.blocks) assert.ok(MT.toMin(b.s) !== null && MT.toMin(b.e) !== null, b.title);
  assert.ok(m.blocks.some((b) => b.dl));
  assert.equal(Object.keys(m.memos).length, 10);
  const after = MT.liveState(m, Date.UTC(2026, 9, 6));
  assert.equal(after.phase, "after");
  assert.equal(after.tally.done + after.tally.changed, 147);
});
