/*
 * Mission Timeline core: pure data and time logic, no DOM.
 * Works in the browser (window.MT) and in Node (require) for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MT = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CATS = {
    do: ["Do", "🎯"],
    prep: ["Prep", "📝"],
    move: ["Move", "🚶"],
    rest: ["Rest", "😴"],
    fuel: ["Fuel", "🍽️"],
    admin: ["Admin", "📋"],
  };
  const STATUSES = ["done", "changed", "skipped"];
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY = 86400000;

  const pad = (n) => String(n).padStart(2, "0");
  const rid = () => Math.random().toString(36).slice(2, 10);
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  /** "HH:MM" -> minutes since midnight, or null if malformed. */
  function toMin(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  /** Local timestamp (ms) for a "YYYY-MM-DD" date plus minutes. */
  function at(date, min) {
    const [y, mo, d] = date.split("-").map(Number);
    return new Date(y, mo - 1, d, 0, min).getTime();
  }

  /** [start, end] in ms. An end at or before the start runs into the next day (e.g. sleep 23:00-07:00). */
  function blockTimes(b) {
    const s = toMin(b.s), e = toMin(b.e);
    const t0 = at(b.date, s);
    let t1 = at(b.date, e);
    if (t1 < t0 || (t1 === t0 && e !== s)) t1 += DAY;
    return [t0, t1];
  }

  const dur = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
  function dayLabel(date) {
    const [y, m, d] = date.split("-").map(Number);
    return `${WD[new Date(y, m - 1, d).getDay()]} ${d} ${MO[m - 1]}`;
  }
  function countdown(ms) {
    ms = Math.max(0, ms);
    let s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    return d ? `${d}d ${h}h ${pad(m)}m` : h ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
  }

  function cleanBlock(b, today = new Date()) {
    b = b || {};
    const cat = CATS[b.cat] ? b.cat : "do";
    const s = toMin(b.s) !== null ? b.s : "09:00";
    const e = toMin(b.e) !== null ? b.e : s;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : isoDate(today);
    return {
      id: String(b.id || rid()),
      date, s, e, cat,
      title: String(b.title || "Untitled").slice(0, 120),
      note: String(b.note || "").slice(0, 600),
      em: String(b.em || "").slice(0, 4),
      fixed: !!b.fixed, opt: !!b.opt, dl: !!b.dl,
      branch: String(b.branch || "").slice(0, 80),
      status: STATUSES.includes(b.status) ? b.status : "",
    };
  }

  function cleanMission(m) {
    m = m || {};
    return {
      id: String(m.id || rid()),
      name: String(m.name || "Untitled mission").slice(0, 80),
      emoji: String(m.emoji || "🎯").slice(0, 4),
      goal: String(m.goal || "").slice(0, 300),
      highlight: String(m.highlight || "").slice(0, 400),
      createdAt: Number(m.createdAt) || Date.now(),
      example: !!m.example,
      blocks: Array.isArray(m.blocks) ? m.blocks.map((b) => cleanBlock(b)) : [],
      memos: m.memos && typeof m.memos === "object" && !Array.isArray(m.memos) ? { ...m.memos } : {},
    };
  }

  const sorted = (m) => [...m.blocks].sort((a, b) => blockTimes(a)[0] - blockTimes(b)[0]);

  /**
   * What the live panel shows at time t.
   * phase: "empty" | "before" | "during" | "after"
   */
  function liveState(m, t) {
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
    if (t >= end) {
      const count = (s) => main.filter((b) => b.status === s).length;
      return {
        phase: "after",
        tally: { done: count("done"), changed: count("changed"), skipped: count("skipped"), unmarked: main.filter((b) => !b.status).length },
      };
    }
    return {
      phase: "during",
      current: main.filter(inBlock).pop() || null,
      next, nextDeadline,
      planB: branches.filter(inBlock),
    };
  }

  // ---------- templates ----------
  function nextDow(dow, from = new Date()) {
    const t = new Date(from); t.setHours(0, 0, 0, 0);
    let d = addDays(t, 1);
    while (d.getDay() !== dow) d = addDays(d, 1);
    return d;
  }

  const TEMPLATES = {
    interview: {
      label: "Interview prep", emoji: "💼",
      blurb: "Four evenings of prep, then the day itself, with a late-train Plan B.",
      build(from = new Date()) {
        const day = addDays(from, 5), D = (n) => isoDate(addDays(day, n));
        return {
          name: "Interview day", emoji: "💼", goal: "Walk in prepared, calm and on time.",
          blocks: [
            { date: D(-4), s: "20:00", e: "21:30", cat: "prep", title: "Research the company and the role", note: "Read their site, recent news and the job description. Write 3 reasons you want this job." },
            { date: D(-3), s: "20:00", e: "21:30", cat: "prep", title: "Write 5 STAR stories", note: "Situation, task, action, result: a challenge, a conflict, a failure, a win, a leadership moment." },
            { date: D(-2), s: "20:00", e: "21:00", cat: "prep", title: "Mock interview out loud", note: "Record yourself answering the top 10 questions. Watch it back once." },
            { date: D(-2), s: "21:00", e: "21:15", cat: "admin", title: "Prepare 3 questions to ask them" },
            { date: D(-1), s: "19:00", e: "19:30", cat: "admin", title: "Outfit, documents, route", note: "Lay out clothes, print your CV, check the route and how long it takes." },
            { date: D(-1), s: "23:00", e: "07:00", cat: "rest", title: "Sleep", note: "Eight hours. No new prep after 21:00." },
            { date: D(0), s: "07:00", e: "07:45", cat: "fuel", title: "Breakfast and a short walk" },
            { date: D(0), s: "07:45", e: "08:30", cat: "prep", title: "Read your STAR notes once", note: "Just once. Then put them away." },
            { date: D(0), s: "08:45", e: "09:40", cat: "move", title: "Travel to the office", note: "Leave with 20 minutes spare.", fixed: true },
            { date: D(0), s: "09:40", e: "09:50", cat: "admin", title: "Arrive and check in", note: "Be in the lobby 10 minutes early.", fixed: true, dl: true },
            { date: D(0), s: "10:00", e: "11:00", cat: "do", title: "The interview", note: "Smile, slow down, ask your 3 questions.", fixed: true, dl: true },
            { date: D(0), s: "08:45", e: "08:50", cat: "admin", title: "Running late: call the recruiter", note: "Call before the start time, not after. Give a new arrival time.", opt: true, branch: "If the train is delayed" },
            { date: D(0), s: "12:00", e: "12:30", cat: "admin", title: "Debrief notes", note: "What went well, what to improve, who you met." },
            { date: D(0), s: "18:00", e: "18:15", cat: "admin", title: "Send a thank-you email" },
          ],
        };
      },
    },
    workout: {
      label: "Training week", emoji: "🏔️",
      blurb: "Strength, runs and a long Saturday hike with a turn-back time.",
      build(from = new Date()) {
        const mon = nextDow(1, from), D = (n) => isoDate(addDays(mon, n));
        return {
          name: "Training week", emoji: "🏔️", goal: "Build the legs and lungs for longer hikes.",
          blocks: [
            { date: D(0), s: "07:00", e: "07:50", cat: "do", title: "Strength: legs and core", note: "Squats, lunges, step-ups, plank. 3 rounds." },
            { date: D(1), s: "07:00", e: "07:40", cat: "do", title: "Easy run", note: "Conversation pace." },
            { date: D(2), s: "07:00", e: "07:50", cat: "do", title: "Strength: upper body and core" },
            { date: D(3), s: "19:00", e: "20:00", cat: "do", title: "Stair climbing with a loaded pack", note: "Carry your pack with 5kg in it." },
            { date: D(4), s: "19:00", e: "19:20", cat: "admin", title: "Check tomorrow's weather and pack", note: "Water, food, rain shell, headlamp, offline map." },
            { date: D(4), s: "22:30", e: "06:30", cat: "rest", title: "Sleep early" },
            { date: D(5), s: "07:30", e: "08:30", cat: "move", title: "Travel to the trailhead", fixed: true },
            { date: D(5), s: "08:30", e: "13:30", cat: "do", title: "Long hike", note: "The goal of the week. Note the trail junctions as you pass them." },
            { date: D(5), s: "11:00", e: "11:05", cat: "admin", title: "Turn-back time", note: "Wherever you are at 11:00, turn back.", fixed: true, dl: true },
            { date: D(5), s: "08:30", e: "10:00", cat: "do", title: "Indoor stair session instead", note: "Heavy rain or a storm warning: 90 minutes of stairs with the pack.", opt: true, branch: "If it rains" },
            { date: D(5), s: "14:00", e: "14:45", cat: "fuel", title: "Recovery meal" },
            { date: D(6), s: "10:00", e: "10:30", cat: "rest", title: "Rest day stretch", note: "Then nothing." },
            { date: D(6), s: "20:00", e: "20:15", cat: "admin", title: "Debrief the week", note: "What felt strong, what hurt, what to change next week." },
          ],
        };
      },
    },
    date: {
      label: "Date night", emoji: "🌙",
      blurb: "Book, confirm, get ready, dinner and a walk, with a rain plan.",
      build(from = new Date()) {
        // The first block is 4 days before the date, so pick a Saturday at least 5 days out.
        let sat = nextDow(6, from);
        if (sat.getTime() - from.getTime() < 5 * DAY) sat = addDays(sat, 7);
        const D = (n) => isoDate(addDays(sat, n));
        return {
          name: "Date night", emoji: "🌙", goal: "A relaxed evening where you're present, not planning.",
          blocks: [
            { date: D(-4), s: "20:00", e: "20:20", cat: "admin", title: "Book the restaurant", note: "Somewhere quiet enough to talk. Reserve a table for two.", dl: true },
            { date: D(-2), s: "20:00", e: "20:15", cat: "admin", title: "Confirm the time and place", note: "A short, friendly message." },
            { date: D(-1), s: "19:00", e: "19:30", cat: "prep", title: "Outfit and grooming", note: "Pick it the day before, not an hour before." },
            { date: D(0), s: "17:00", e: "18:00", cat: "prep", title: "Get ready", note: "Shower, dress, phone charged, cash and card." },
            { date: D(0), s: "18:15", e: "18:45", cat: "move", title: "Travel to meet", note: "Aim to arrive 10 minutes early.", fixed: true },
            { date: D(0), s: "18:45", e: "18:50", cat: "admin", title: "Meet", fixed: true, dl: true },
            { date: D(0), s: "19:00", e: "20:45", cat: "fuel", title: "Dinner", note: "Ask about them. Listen more than you talk.", fixed: true },
            { date: D(0), s: "21:00", e: "22:00", cat: "do", title: "A walk somewhere with a view", note: "Waterfront or a viewpoint." },
            { date: D(0), s: "21:00", e: "22:00", cat: "do", title: "Dessert or a quiet bar indoors", note: "Somewhere warm and calm nearby.", opt: true, branch: "If it rains" },
            { date: D(1), s: "11:00", e: "11:10", cat: "admin", title: "Send a thank-you message", note: "Mention one thing you enjoyed." },
          ],
        };
      },
    },
  };

  // ---------- import / export ----------
  const FORMAT = "mission-timeline/v1";
  function exportData(missions) {
    return JSON.stringify({ format: FORMAT, exportedAt: new Date().toISOString(), missions }, null, 2);
  }
  /** Parse an export file. Accepts the wrapped format or a bare array of missions. Throws on bad input. */
  function importData(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data && Array.isArray(data.missions) ? data.missions : null;
    if (!list) throw new Error("This file doesn't contain any missions.");
    return list.map(cleanMission);
  }

  return {
    CATS, STATUSES, WD, MO, pad, rid, isoDate, addDays, toMin, at, blockTimes, dur, dayLabel, countdown,
    cleanBlock, cleanMission, sorted, liveState, nextDow, TEMPLATES, FORMAT, exportData, importData,
  };
});
