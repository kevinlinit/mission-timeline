import { DAY, addDays, floatingNow, isoDate, startOfDay, weekday } from "./time.js";

/** The first given weekday strictly after floating time `from` (0 = Sunday). */
export function nextDow(dow, from = floatingNow()) {
  let d = addDays(startOfDay(from), 1);
  while (weekday(d) !== dow) d = addDays(d, 1);
  return d;
}

/**
 * Starter missions. `build(from)` takes floating "now" and returns a mission dated from there.
 */
export const TEMPLATES = {
  interview: {
    label: "Interview prep", emoji: "💼",
    blurb: "Four evenings of prep, then the day itself, with a late-train Plan B.",
    build(from = floatingNow()) {
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
    build(from = floatingNow()) {
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
    build(from = floatingNow()) {
      // The first block is 4 days before the date, so pick a Saturday at least 5 days out.
      let sat = nextDow(6, from);
      if (sat - from < 5 * DAY) sat = addDays(sat, 7);
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
