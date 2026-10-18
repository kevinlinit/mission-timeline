/**
 * The customer questionnaire (github.com/kevinlinit/travel-survey) and what the studio makes of it:
 *
 *   parseIntake(record)       the survey's JSON -> { answers: {id: value}, sections: [...] } or throws
 *   caseFromIntake(answers)   the fields of a new case: customer, trip, priority
 *   brief(answers)            one screen for the planner: the trip's shape, style, loves, red flags
 *   ideas(answers)            routes from the catalog (routes.js), scored against the answers, with
 *                             reasons, cautions and a night-by-night plan
 *   draftItinerary(idea, a)   a first mission-timeline/v1 mission from an idea, for the planner to tailor
 *
 * Pure functions, no I/O. Answer shapes are the survey's: radio -> "text" or { choice, other },
 * scale -> 1-5, matrix -> { row: 1-5 }, checks -> [..], rank -> [most important, ..].
 */
import { addDays, cleanMission, dayLabel, isDate, isoDate, rid } from "../core/index.js";
import { ACTIVITY_TRAITS, ROUTES } from "./routes.js";

export class IntakeError extends Error {}

const MAX_TEXT = 4000;

/** The survey's record: { submitted_at, respondent, email, sections: { id: { title, answers: { qid: { question, answer, display } } } } } */
export function parseIntake(rec) {
  if (!rec || typeof rec !== "object" || !rec.sections || typeof rec.sections !== "object") throw new IntakeError("That isn't a questionnaire response.");
  const answers = {};
  const sections = [];
  for (const [sid, sec] of Object.entries(rec.sections).slice(0, 40)) {
    const items = [];
    for (const [qid, q] of Object.entries(sec?.answers || {}).slice(0, 80)) {
      if (!/^[a-z0-9_]{1,40}$/.test(qid)) continue;
      answers[qid] = clip(q?.answer);
      items.push({ id: qid, question: String(q?.question || qid).slice(0, 300), display: String(q?.display ?? "").slice(0, 2000) });
    }
    sections.push({ id: String(sid).slice(0, 40), title: String(sec?.title || sid).slice(0, 120), items });
  }
  if (answers.privacy_agree !== true) throw new IntakeError("The privacy agreement wasn't accepted.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(answers.email || ""))) throw new IntakeError("The questionnaire needs a valid email address.");
  return { answers, sections, submittedAt: Date.parse(rec.submitted_at) || null };
}

/** Keep answers small and plain: strings, numbers, booleans, short lists and maps of those. */
function clip(v, depth = 0) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, MAX_TEXT);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (depth > 1) return null;
  if (Array.isArray(v)) return v.slice(0, 60).map((x) => clip(x, depth + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [String(k).slice(0, 120), clip(x, depth + 1)]));
  return null;
}

// ---------- reading answers ----------

/** A radio answer as text: the choice, or what they typed for "Other". */
const pick = (v) => (v && typeof v === "object" && !Array.isArray(v) ? (v.other ? String(v.other) : String(v.choice || "")) : v == null ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v.map(String) : []);
const real = (v, none) => list(v).filter((x) => x !== none);
const num = (v) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : null);
const text = (v) => (typeof v === "string" ? v.trim() : "");
const startOf = (a) => {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(String(a.start_datetime || ""));
  return m && isDate(m[1]) ? { date: m[1], time: m[2] || "" } : null;
};
/** "7 nights / 8 days" -> 7; a custom answer like "two weeks" -> 14 when it can tell. */
export function nightsOf(a) {
  const s = pick(a.length).toLowerCase();
  const n = /(\d+)\s*(night|day|week)?/.exec(s);
  if (n) return Math.min(60, n[2]?.startsWith("week") ? Number(n[1]) * 7 : n[2]?.startsWith("day") ? Math.max(1, Number(n[1]) - 1) : Number(n[1]));
  if (/two weeks|fortnight/.test(s)) return 14;
  if (/week/.test(s)) return 7;
  return 0;
}
const scaleWord = (v, [lo, mid, hi]) => (v == null ? "" : v <= 2 ? lo : v >= 4 ? hi : mid);
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
/** The studio's published starting prices per person, from the questionnaire's budget page. */
const STARTING_PRICES = [[7, 4000], [10, 5800], [21, 12200]];
const startingPrice = (nights) => {
  if (!nights) return null;
  const [n, p] = STARTING_PRICES.reduce((best, x) => (Math.abs(x[0] - nights) < Math.abs(best[0] - nights) ? x : best));
  return Math.round((p / n) * nights / 100) * 100;
};

// ---------- the case ----------

/** The fields of a new case from the answers. `now` is ms. */
export function caseFromIntake(a, now = Date.now()) {
  const start = startOf(a);
  const nights = nightsOf(a);
  const party = Math.max(1, Math.min(30, num(a.party_size) || 1));
  const pp = num(a.budget_pp) || 0;
  const cities = [pick(a.start_city), pick(a.end_city)].filter(Boolean);
  const daysAway = start ? Math.round((Date.parse(`${start.date}T00:00:00Z`) - now) / 86400000) : null;
  const theme = pick(a.theme).toLowerCase();
  const celebration = pick(a.celebration);
  const tags = [
    "mystery trip",
    /beaten/.test(theme) ? "off the beaten track" : /action/.test(theme) ? "action-packed" : /relax/.test(theme) ? "relaxing" : "",
    /never/i.test(pick(a.visits)) ? "first time in japan" : "",
    celebration && !/^no /i.test(celebration) ? celebration.toLowerCase().replace(/ or /, "/") : "",
  ].filter(Boolean);
  const heard = pick(a.heard_about);
  const summary = [
    `Mystery trip for ${party}`,
    nights ? `${nights} nights` : "",
    cities[0] ? `from ${cities[0]}${cities[1] && cities[1] !== cities[0] ? ` to ${cities[1]}` : ""}` : "",
    start ? `starting ${dayLabel(start.date)}` : "",
  ].filter(Boolean).join(", ");
  return {
    customer: { name: text(a.name), email: text(a.email), phone: text(a.whatsapp) },
    trip: {
      start: start?.date || "",
      end: start && nights ? isoDate(addDays(Date.parse(`${start.date}T00:00:00Z`), nights)) : "",
      destinations: [...new Set(cities)],
      travellers: party,
      budget: { amount: pp * party, currency: "USD" },
      source: `Questionnaire${heard ? ` · ${heard}` : ""}`,
      tags,
      request: [summary + ".", text(a.final_notes)].filter(Boolean).join("\n\n"),
    },
    priority: daysAway !== null && daysAway <= 7 ? "urgent" : daysAway !== null && daysAway <= 30 ? "high" : "normal",
  };
}

// ---------- the brief ----------

/**
 * One screen for the planner: { headline, flags: [{ level: "warn" | "info", text }], sections: [{ title, items: [{ label, value }] }] }
 * Flags are the things that change what can be booked.
 */
export function brief(a, now = Date.now()) {
  const start = startOf(a);
  const nights = nightsOf(a);
  const party = num(a.party_size) || 1;
  const pp = num(a.budget_pp);
  const flags = [];
  const warn = (t) => flags.push({ level: "warn", text: t });
  const info = (t) => flags.push({ level: "info", text: t });

  for (const c of real(a.conditions, "None")) warn(c);
  const tattoo = pick(a.tattoos);
  const publicOnsen = pick(a.onsen_ok) !== "No";
  if (!publicOnsen) warn("Not comfortable in a public onsen: private baths (kashikiri or in-room) only");
  if (tattoo && tattoo !== "No") {
    if (pick(a.tattoo_cover) === "No") warn(`Tattoo (${tattoo.toLowerCase()}) and won't cover it: tattoo-friendly or private onsen only`);
    else info(`Tattoo (${tattoo.toLowerCase()}): cover tape is fine`);
  }
  if (text(a.dietary)) warn(`Dietary: ${text(a.dietary)}`);
  if (text(a.dislikes)) info(`Dislikes: ${text(a.dislikes)}`);
  const avoid = real(a.avoid_activities, "None!");
  if (avoid.length) info(`Avoid: ${avoid.join(", ").toLowerCase()}`);
  if (text(a.avoid_places) && !/^none\.?$/i.test(text(a.avoid_places))) info(`Places to avoid: ${text(a.avoid_places)}`);
  if (pick(a.shared_bath) === "No") info("Private bathroom needed");
  if (text(a.room_needs)) info(`Room: ${text(a.room_needs)}`);
  if (/^No/.test(pick(a.offline))) info("Needs reliable data: arrange an eSIM or pocket Wi-Fi");
  if (start) {
    const days = Math.round((Date.parse(`${start.date}T00:00:00Z`) - now) / 86400000);
    if (days < 0) warn("The start date has passed: confirm new dates");
    else if (days <= 30) warn(`Starts in ${days} day${days === 1 ? "" : "s"}: book the hard-to-get stays first`);
  }
  if (pick(a.flights_booked) === "No") info("Flights not booked yet: dates may still move");
  const floor = startingPrice(nights);
  if (pp != null && floor && pp < floor) warn(`Budget ${money(pp)} per person is under our starting price for ${nights} nights (about ${money(floor)})`);
  const celebration = pick(a.celebration);
  if (celebration && !/^No /.test(celebration)) info(`Celebrating: ${celebration}${isDate(a.celebration_date) ? ` on ${dayLabel(a.celebration_date)}` : ""}${text(a.celebration_details) ? ` (${text(a.celebration_details)})` : ""}`);

  const ratings = (m) => Object.entries(m && typeof m === "object" ? m : {}).filter(([, v]) => Number.isFinite(v));
  const loves = [...ratings(a.activity_interest), ...ratings(a.food_interest)].filter(([, v]) => v >= 4).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${short(k)}${v === 5 ? " ★" : ""}`);
  const notFor = [...ratings(a.activity_interest), ...ratings(a.food_interest)].filter(([, v]) => v <= 2).map(([k]) => short(k));
  const prefectures = real(a.prefectures, "None of them (first time!)");

  const items = (pairs) => pairs.filter(([, v]) => v !== "" && v != null).map(([label, value]) => ({ label, value: String(value) }));
  const cities = [pick(a.start_city), pick(a.end_city)];
  return {
    headline: [
      `${party} traveller${party === 1 ? "" : "s"}`,
      nights ? `${nights} nights` : pick(a.length),
      start ? `from ${dayLabel(start.date)}${start.time ? ` ${start.time}` : ""}` : "",
      cities[0] ? `${cities[0]} → ${cities[1] || cities[0]}` : "",
      pp != null ? `${money(pp)} pp` : "",
    ].filter(Boolean).join(" · "),
    flags,
    sections: [
      { title: "Shape", items: items([
        ["Dates", start ? `${dayLabel(start.date)}${nights ? ` – ${dayLabel(isoDate(addDays(Date.parse(`${start.date}T00:00:00Z`), nights)))}` : ""}` : ""],
        ["Flexibility", pick(a.flexibility)],
        ["Tokyo / Kyoto days", a.days_tokyo != null || a.days_kyoto != null ? `${pick(a.days_tokyo) || 0} / ${pick(a.days_kyoto) || 0}` : ""],
        ["Budget", pp != null ? `${money(pp)} per person, ${money(pp * party)} in all` : ""],
        ["Spend first on", list(a.budget_priorities).slice(0, 2).join(", then ")],
        ["Flights", pick(a.flights_booked)],
      ]) },
      { title: "Style", items: items([
        ["Theme", pick(a.theme)],
        ["Famous spots", /avoid/.test(pick(a.must_see)) ? "Avoid them: local places" : pick(a.must_see) ? "A few, if worth it" : ""],
        ["City or rural", scaleWord(num(a.city_rural), ["Rural", "A mix", "Big cities"])],
        ["Pace", scaleWord(num(a.pace), ["Slow and relaxed", "A mix", "See as much as possible"])],
        ["Moving", pick(a.moving)],
        ["Mornings", scaleWord(num(a.mornings), ["Slow mornings", "A mix", "Early starts"])],
        ["Evenings", scaleWord(num(a.evenings), ["Quiet nights", "Sometimes out", "Loves nights out"])],
        ["Locals", scaleWord(num(a.locals), ["Prefers not", "Neutral", "Loves meeting locals"])],
        ["Plan", pick(a.structure)],
        ["Why a mystery trip", pick(a.why_mystery)],
      ]) },
      { title: "Loves", items: items([["Yes please", loves.join(", ")], ["Not for them", notFor.join(", ")]]) },
      { title: "Stay", items: items([
        ["Style", pick(a.stay_style)],
        ["Cares most about", list(a.stay_priorities).slice(0, 3).join(", ")],
        ["Sleeping", pick(a.sleeping)],
      ]) },
      { title: "Been before", items: items([
        ["Visits", pick(a.visits)],
        ["Prefectures", prefectures.length ? prefectures.join(", ") : real(a.prefectures, "").length ? "None" : ""],
      ]) },
      { title: "About them", items: items([
        ["Age", pick(a.age)], ["Country", text(a.country)], ["Notes", text(a.final_notes)],
      ]) },
    ].filter((s) => s.items.length),
  };
}

/** "Hot springs and wellness time" -> "Hot springs"; "Fine dining" stays. */
const short = (row) => row.replace(/\s*\(.*\)$/, "").replace(/ and wellness time| and time in nature| and coastal areas| and workshops/, "").replace(/^Drinking — /, "Drinks: ");

// ---------- ideas ----------

/**
 * Routes from the catalog that fit the answers, best first:
 * [{ id, name, emoji, region, pitch, match (0-100), why: [..], cautions: [..], plan: [{ place, nights, highlights }] }]
 */
export function ideas(a, { routes = ROUTES, count = 3 } = {}) {
  return routes.map((r) => scoreRoute(r, a)).sort((x, y) => y.score - x.score).slice(0, count)
    .map(({ score, route, why, cautions }) => ({
      id: route.id, name: route.name, emoji: route.emoji, region: route.region, pitch: route.pitch,
      score: Math.round(score),
      match: Math.round(100 / (1 + Math.exp(-(score - 20) / 10))),
      why: why.slice(0, 4), cautions, plan: planNights(route, a),
    }));
}

function scoreRoute(r, a) {
  const t = r.traits;
  const why = [], cautions = [];
  let score = 0;
  const add = (n, reason) => { score += n; if (reason && n > 2) why.push(reason); };

  // What they'd love, and what they wouldn't.
  const rated = a.activity_interest && typeof a.activity_interest === "object" ? a.activity_interest : {};
  const contributions = [];
  for (const [row, trait] of Object.entries(ACTIVITY_TRAITS)) {
    const v = num(rated[row]);
    if (v == null) continue;
    const n = (v - 3) * (t[trait] || 0) * 6;
    score += n;
    if (n >= 6) contributions.push([n, short(row).toLowerCase()]);
  }
  contributions.sort((x, y) => y[0] - x[0]);
  if (contributions.length) why.push(`Plenty of what they rated highest: ${contributions.slice(0, 3).map((c) => c[1]).join(", ")}`);
  const food = a.food_interest && typeof a.food_interest === "object" ? Object.values(a.food_interest).filter(Number.isFinite) : [];
  if (food.length) add((Math.max(...food) - 3) * t.food * 3, t.food >= 0.8 && Math.max(...food) >= 4 ? "A food-lover's region" : "");
  const evenings = num(a.evenings);
  if (evenings != null) add((evenings - 3) * (t.night - 0.5) * 4, evenings >= 4 && t.night >= 0.7 ? "Lively evenings" : evenings <= 2 && t.night <= 0.3 ? "Quiet nights" : "");

  // City or country, famous or local.
  const cityPref = num(a.city_rural);
  if (cityPref != null) add(10 - Math.abs((cityPref - 1) / 4 - t.city) * 20, Math.abs((cityPref - 1) / 4 - t.city) < 0.25 ? (t.city < 0.4 ? "Rural, as they prefer" : t.city > 0.6 ? "Big-city energy, as they prefer" : "A city-and-country mix") : "");
  const local = /avoid/.test(pick(a.must_see));
  if (pick(a.must_see)) add(local ? (0.5 - t.famous) * 16 : (t.famous - 0.3) * 8, local && t.famous <= 0.3 ? "Away from the tourist trail" : !local && t.famous >= 0.8 ? "Includes the famous sights they're happy to see" : "");
  const theme = pick(a.theme).toLowerCase();
  if (/beaten/.test(theme)) add((0.5 - t.famous) * 10, t.famous <= 0.3 ? "Off the beaten track, their theme" : "");
  if (/action/.test(theme)) add((t.active - 0.4) * 12, t.active >= 0.7 ? "Action-packed, their theme" : "");
  if (/relax/.test(theme)) add(((t.onsen + t.beach) / 2 - t.active / 2) * 12, t.onsen >= 0.8 || t.beach >= 0.8 ? "Built for relaxing, their theme" : "");
  const visits = pick(a.visits);
  if (visits === "Never") add((t.famous - 0.4) * 10, t.famous >= 0.8 ? "A strong first trip to Japan" : "");
  else if (/3\+|live/.test(visits)) add((0.5 - t.famous) * 10, t.famous <= 0.3 ? "New ground for someone who knows Japan" : "");

  // Been there already.
  const seen = new Set(real(a.prefectures, "None of them (first time!)"));
  const overlap = r.prefectures.filter((p) => seen.has(p));
  if (overlap.length) {
    score -= (overlap.length / r.prefectures.length) * 14;
    cautions.push(`They've been to ${overlap.join(", ")}`);
  }

  // Season.
  const start = startOf(a);
  if (start) {
    const month = Number(start.date.slice(5, 7));
    if (r.months.includes(month)) why.push(`Good time of year (${MONTHS[month - 1]})`);
    else { score -= 8; cautions.push(`${MONTHS[month - 1]} isn't its best month${r.seasonNote ? `: ${r.seasonNote}` : ""}`); }
  }

  // Fears, conditions and things to avoid.
  const conditions = new Set(real(a.conditions, "None"));
  const avoid = new Set(real(a.avoid_activities, "None!"));
  const f = r.flags || {};
  const conflict = (on, weight, text) => { if (on) { score -= weight; cautions.push(text); } };
  conflict((conditions.has("Can't ride a bike") || avoid.has("Riding a bike")) && f.bike, f.bike * 8, "Has cycling: swap it for a car, taxi or walk");
  conflict((conditions.has("Can't swim") || conditions.has("Fear of deep water") || conditions.has("Fear of open water, boats or kayaks") || conditions.has("Get seasick easily") || avoid.has("River or sea activities")) && f.boat, f.boat * 10, "Relies on boats or ferries: check every crossing, or reroute");
  conflict((conditions.has("Severe fear of extreme heights") || conditions.has("Fear of certain heights (ski lifts, gondolas)")) && f.heights, f.heights * 8, "Has ropeways or high paths: plan the alternatives");
  conflict((conditions.has("Unable to do prolonged physical activity") || conditions.has("Pregnant, or travelling with someone pregnant")) && t.active >= 0.5, t.active * 16, "Long walking or hiking days: shorten them, or add transport");
  conflict(avoid.has("Climbing a mountain") && f.climb, f.climb * 8, "Has climbs: keep to the valley options");
  conflict(avoid.has("Snow activities") && f.snow && (!start || [12, 1, 2, 3].includes(Number(start.date.slice(5, 7)))), f.snow * 8, "Snow season: keep it to warm indoor days");
  conflict(avoid.has("Beachside activities") && f.beachside, f.beachside * 10, "Beach-heavy: they'd rather avoid beaches");
  conflict(avoid.has("Visiting museums") && t.art >= 0.8, 8, "Museum-heavy: they'd rather avoid museums");
  conflict(avoid.has("Visiting forts and historical sites") && t.history >= 0.8, 6, "Lots of historical sites, which they'd rather avoid");
  const publicOnsen = pick(a.onsen_ok) !== "No" && !avoid.has("Public baths and saunas") && !(pick(a.tattoos) !== "No" && pick(a.tattoo_cover) === "No" && pick(a.tattoos));
  if (!publicOnsen && t.onsen >= 0.7) cautions.push("Onsen town: book private baths (kashikiri or in-room)");
  if (conditions.has("Pregnant, or travelling with someone pregnant") && t.onsen >= 0.7) cautions.push("Hot springs: check with their doctor; keep baths short and not too hot");
  if (/^No/.test(pick(a.offline)) && f.remote >= 0.5) cautions.push("Patchy signal in places: eSIM plus offline maps");

  // Moving around.
  const longStays = /^Longer/.test(pick(a.moving));
  const nights = nightsOf(a) || 7;
  if (longStays && r.stops.length > Math.max(2, nights / 3)) { score -= 4; }
  else if (longStays) why.push("Few hotel changes");

  return { route: r, score, why, cautions };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Nights per place: the start city (their Tokyo days if they start there), the route, Kyoto if they
 * asked for it, and the last night near where they finish.
 */
export function planNights(r, a) {
  const total = nightsOf(a) || 7;
  const startCity = pick(a.start_city) || "Tokyo";
  const endCity = pick(a.end_city) || startCity;
  const tokyo = Math.min(Number(pick(a.days_tokyo)) || 0, 5);
  const kyoto = Math.min(Number(pick(a.days_kyoto)) || 0, 5);
  const inRoute = (p) => r.stops.some((s) => s.place.startsWith(p));
  const plan = [];
  const head = startCity === "Tokyo" && !inRoute("Tokyo") ? tokyo : inRoute(startCity) ? 0 : startCity ? 1 : 0;
  if (head) plan.push({ place: startCity, nights: head, highlights: CITY_DAYS[startCity] || [] });
  const tail = endCity !== startCity && !inRoute(endCity) ? (endCity === "Tokyo" ? Math.max(1, tokyo) : 1) : 0;
  const kyotoNights = kyoto && !inRoute("Kyoto") ? kyoto : 0;
  let left = Math.max(1, total - head - tail - kyotoNights);

  // Keep the stops that fit: at least one night each, two each if they'd rather move less.
  const perStop = /^Longer/.test(pick(a.moving)) ? 2 : 1;
  // Run the route towards where they finish.
  let stops = r.stops[0].place.startsWith(endCity) && !r.stops.at(-1).place.startsWith(endCity) ? [...r.stops].reverse() : [...r.stops];
  while (stops.length > 1 && stops.length * perStop > left) {
    const lightest = stops.reduce((m, s) => (s.weight < m.weight ? s : m));
    stops = stops.filter((s) => s !== lightest);
  }
  const weight = stops.reduce((n, s) => n + s.weight, 0);
  const floor = Math.min(perStop, Math.floor(left / stops.length)) || 1;
  const share = stops.map((s) => ({ s, n: Math.max(floor, Math.floor((left * s.weight) / weight)) }));
  let extra = left - share.reduce((n, x) => n + x.n, 0);
  while (extra > 0) for (const x of [...share].sort((p, q) => q.s.weight - p.s.weight)) { if (extra <= 0) break; x.n++; extra--; }
  while (extra < 0) { const big = share.reduce((m, x) => (x.n > m.n ? x : m)); if (big.n <= 1) break; big.n--; extra++; }
  for (const { s, n } of share) plan.push({ place: s.place, nights: n, highlights: s.highlights, rain: s.rain || "" });
  if (kyotoNights) plan.push({ place: "Kyoto", nights: kyotoNights, highlights: CITY_DAYS.Kyoto });
  if (tail) plan.push({ place: endCity, nights: tail, highlights: CITY_DAYS[endCity] || [] });
  return plan;
}

/** Days in the gateway cities when a route doesn't already cover them. */
const CITY_DAYS = {
  Tokyo: ["Yanaka and Nezu old-town walk", "Kiyosumi garden and Fukagawa", "Dinner: izakaya in a backstreet of Ebisu", "Shimokitazawa vintage and coffee", "Meiji Jingu at opening"],
  Osaka: ["Nakazakicho backstreets", "Kuromon market", "Dinner: Shinsekai kushikatsu", "Osaka Castle park at dawn"],
  Kyoto: ["Fushimi Inari before the crowds", "Philosopher's Path and Honen-in", "Tea ceremony in a machiya", "Dinner: obanzai home cooking in Pontocho", "Kurama to Kibune mountain walk"],
};

// ---------- a first draft ----------

/**
 * A mission for the planner to tailor: one day per night of the plan, starting when they want to
 * start, with as many outings a day as their pace suggests, meals, a rain plan per place, and the
 * celebration dinner on its date. Everything is estimated (not booked) until the planner fixes it.
 */
export function draftItinerary(idea, a, customerName = "") {
  const start = startOf(a) || { date: isoDate(Date.now() + 30 * 86400000), time: "" };
  const pace = num(a.pace) ?? 3;
  const perDay = pace <= 2 ? 2 : pace >= 4 ? 3 : 2;
  const early = num(a.mornings) ?? 3;
  const dayStart = early >= 4 ? "08:00" : early <= 2 ? "10:00" : "09:00";
  const nightOut = (num(a.evenings) ?? 3) >= 4;
  const dietary = text(a.dietary);
  const celebration = pick(a.celebration);
  const celebrationDate = isDate(a.celebration_date) ? a.celebration_date : "";
  const fuelNote = dietary ? `Dietary: ${dietary}.` : "";
  const blocks = [];
  const b = (date, s, e, cat, title, extra = {}) => blocks.push({ id: rid(), date, s, e, cat, title, fixed: false, ...extra });
  const SLOTS = [[dayStart, "12:00"], ["14:00", "17:00"], ["17:00", "18:30"]];

  let day = 0;
  idea.plan.forEach((stop, i) => {
    let next = 0; // which highlight comes next at this place
    for (let n = 0; n < stop.nights; n++, day++) {
      const date = isoDate(addDays(Date.parse(`${start.date}T00:00:00Z`), day));
      const first = day === 0;
      const arriving = n === 0;
      let slots = SLOTS.slice(0, perDay);
      if (first) {
        const t = start.time || "14:00";
        const from = pick(a.start_city);
        if (from && !stop.place.startsWith(from)) { // they start somewhere else: the first move is the reveal
          b(date, t, addMin(t, 30), "admin", `Trip begins in ${from}`, { fixed: true, note: "Welcome pack, rail passes and the first envelope." });
          b(date, addMin(t, 30), addMin(t, 210), "move", `Travel to ${stop.place}`);
        } else {
          b(date, t, addMin(t, 30), "admin", `Trip begins: meet in ${stop.place}`, { fixed: true, note: "Welcome pack, rail passes and the first surprise." });
        }
        const free = addMin(t, from && !stop.place.startsWith(from) ? 210 : 30);
        slots = SLOTS.filter(([s]) => s >= free).slice(0, Math.max(1, perDay - 1));
      } else if (arriving) {
        b(date, dayStart, addMin(dayStart, 150), "move", `Travel to ${stop.place}`, { note: `From ${idea.plan[i - 1].place}. Luggage forwarding if the hop is long.` });
        slots = SLOTS.slice(1, perDay);
      }
      for (const [s, e] of slots) {
        const h = stop.highlights[next++ % Math.max(1, stop.highlights.length)] || `Free time in ${stop.place}`;
        const meal = /^(Dinner|Lunch|Breakfast)\b/.test(h);
        b(date, s, e, meal ? "fuel" : "do", h, meal && fuelNote ? { note: fuelNote } : {});
      }
      if (!blocks.some((x) => x.date === date && x.cat === "fuel" && x.s === "12:30") && !first) b(date, "12:30", "13:30", "fuel", `Lunch in ${stop.place}`, fuelNote ? { note: fuelNote } : {});
      const special = celebrationDate === date && celebration && !/^No /.test(celebration);
      b(date, "19:00", "20:30", "fuel", special ? `Celebration dinner: ${celebration.toLowerCase()}` : `Dinner in ${stop.place}`, { ...(fuelNote ? { note: fuelNote } : {}), ...(special ? { fixed: true } : {}) });
      if (nightOut && !first) b(date, "21:00", "22:30", "do", `Evening out in ${stop.place}`, { opt: true });
      if (arriving && !first) b(date, "13:30", "14:00", "admin", `Drop bags or check in, ${stop.place}`, { fixed: true });
      if (arriving && stop.rain) b(date, "14:00", "17:00", "do", stop.rain, { branch: "If it rains", opt: true });
    }
  });
  const lastDate = isoDate(addDays(Date.parse(`${start.date}T00:00:00Z`), day));
  const endCity = pick(a.end_city) || idea.plan.at(-1)?.place || "";
  b(lastDate, "10:00", "11:00", "admin", "Check out", { fixed: true });
  b(lastDate, "11:00", "11:15", "admin", `Trip ends in ${endCity}`, { fixed: true, dl: true, note: "Leave time for the airport or your onward train." });

  return cleanMission({
    name: `${idea.name}${customerName ? ` for ${customerName.split(" ")[0]}` : ""}`,
    emoji: idea.emoji,
    goal: idea.pitch,
    tz: "Asia/Tokyo",
    blocks,
  });
}

const addMin = (hhmm, m) => {
  const [h, mm] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + mm + m);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
