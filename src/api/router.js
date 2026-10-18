import {
  FORMAT, TEMPLATES, blockTimes, cleanMission, countdown, describeBlock, floatingNow, isDate, isTimeZone,
  liveState, summarize, timelineDays, at as atDate,
} from "../core/index.js";
import { ACCOUNT_ENDPOINTS } from "./account-routes.js";
import { STUDIO_ENDPOINTS } from "./studio-routes.js";

/**
 * The HTTP API, as pure functions: request in, { status, body, cache } out. No sockets here, so the
 * same code serves the Node server, the static export and the tests.
 *
 * Every route answers with or without a ".json" suffix. The static export on GitHub Pages only has
 * the ".json" files, so clients should use that form.
 */
export const API_VERSION = "v1";
const BASE = `/api/${API_VERSION}`;

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/**
 * Routes. `static: true` routes don't depend on the current time and are written out by the static
 * export; the others need the server.
 */
const routes = [
  { path: "", static: true, doc: "This index.", handler: (ctx) => index(ctx) },
  { path: "/missions", static: true, doc: "Every published mission, summarized.", handler: ({ repo }) => ({ missions: repo.missions().map(summarize) }) },
  { path: "/missions/:id", static: true, doc: "One mission in the mission-timeline/v1 format.", handler: ({ mission }) => mission },
  { path: "/missions/:id/timeline", static: true, doc: "The mission day by day: deadlines, blocks and Plan B groups in order.", handler: ({ mission }) => ({ id: mission.id, tz: mission.tz, days: timelineDays(mission) }) },
  { path: "/missions/:id/live", static: false, doc: "What's happening now. Query: at (ISO time, default now), tz (default the mission's).", handler: (ctx) => live(ctx) },
  { path: "/export", static: true, doc: "All missions as one export file the web and iOS apps can import.", handler: ({ repo }) => ({ format: FORMAT, exportedAt: null, missions: repo.missions() }) },
  { path: "/templates", static: true, doc: "Starter templates.", handler: () => ({ templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label, emoji: t.emoji, blurb: t.blurb })) }) },
  { path: "/templates/:template", static: false, doc: "A template built into a mission. Query: from (YYYY-MM-DD, default today), tz.", handler: (ctx) => buildTemplate(ctx) },
  { path: "/ios/latest", static: true, doc: "The iOS app's update feed: { version, notes, url }.", handler: ({ repo }) => repo.updateFeed() || notFound("No update feed is published.") },
];

const compiled = routes.map((r) => ({
  ...r,
  regex: new RegExp(`^${BASE}${r.path.replace(/:(\w+)/g, "(?<$1>[^/]+?)")}(?:\\.json)?/?$`),
}));

/**
 * Handle one request.
 * @param repo   a Repository
 * @param req    { method, path, query: URLSearchParams }
 * @param now    the current instant in ms (injectable for tests)
 * @returns      { status, body, cache: "static" | "dynamic" | "none", allow? }
 */
export function handle(repo, { method = "GET", path, query = new URLSearchParams() }, now = Date.now()) {
  try {
    const route = compiled.find((r) => r.regex.test(path));
    if (!route) throw new HttpError(404, "not_found", `No such endpoint: ${path}. See ${BASE}.json for the list.`);
    if (method === "OPTIONS") return { status: 204, body: null, cache: "none" };
    if (method !== "GET" && method !== "HEAD") {
      return { status: 405, body: error("method_not_allowed", "Published data is read-only: use GET. Your own missions are under /api/v1/me/missions."), cache: "none", allow: "GET, HEAD, OPTIONS" };
    }
    const params = route.regex.exec(path).groups || {};
    const ctx = { repo, query, now, params };
    if (params.id !== undefined) {
      ctx.mission = repo.mission(decodeURIComponent(params.id));
      if (!ctx.mission) throw new HttpError(404, "mission_not_found", `No mission with the id "${params.id}".`);
    }
    return { status: 200, body: route.handler(ctx), cache: route.static ? "static" : "dynamic" };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: error(e.code, e.message), cache: "none" };
    throw e;
  }
}

/** Every static path, for the export: ["/api/v1", "/api/v1/missions", "/api/v1/missions/x", ...]. */
export function staticPaths(repo) {
  const out = [];
  for (const r of routes.filter((x) => x.static)) {
    if (r.path.includes(":id")) repo.missions().forEach((m) => out.push(BASE + r.path.replace(":id", m.id)));
    else if (r.path === "/ios/latest" && !repo.updateFeed()) continue;
    else out.push(BASE + r.path);
  }
  return out;
}

// ---------- handlers ----------

function index({ repo }) {
  return {
    name: "Mission Timeline API",
    version: API_VERSION,
    format: FORMAT,
    revision: repo.revision,
    missions: repo.missions().length,
    endpoints: routes.map((r) => ({ method: "GET", path: `${BASE}${r.path}.json`.replace("/.json", ".json"), description: r.doc, static: r.static }))
      .concat(ACCOUNT_ENDPOINTS.map((e) => ({ ...e, static: false, signIn: true })))
      .concat(STUDIO_ENDPOINTS.map((e) => ({ ...e, static: false, signIn: true }))),
  };
}

function live({ mission, query, now }) {
  const instant = parseInstant(query.get("at"), now);
  // Without a time zone the server's own would be arbitrary, so UTC.
  const tz = zone(query.get("tz"), mission.tz) || "UTC";
  const t = floatingNow(instant, tz);
  const st = liveState(mission, t);
  const local = (ms) => new Date(ms).toISOString().slice(0, 19);
  const block = (b) => {
    if (!b) return null;
    const [t0, t1] = blockTimes(b);
    return { ...describeBlock(b), start: local(t0), end: local(t1), startsInMs: Math.max(0, t0 - t), endsInMs: Math.max(0, t1 - t) };
  };
  const out = { id: mission.id, at: new Date(instant).toISOString(), tz, wallClock: local(t), phase: st.phase };
  if (st.phase === "before") {
    Object.assign(out, { startsInMs: st.start - t, startsIn: countdown(st.start - t), first: block(st.first), nextDeadline: block(st.nextDeadline) });
  } else if (st.phase === "during") {
    Object.assign(out, {
      current: block(st.current),
      progress: st.current ? round((t - blockTimes(st.current)[0]) / (blockTimes(st.current)[1] - blockTimes(st.current)[0])) : null,
      next: block(st.next), nextDeadline: block(st.nextDeadline), planB: st.planB.map(block),
    });
  } else if (st.phase === "after") {
    Object.assign(out, { tally: st.tally, highlight: mission.highlight });
  }
  return out;
}

function buildTemplate({ params, query, now }) {
  const tpl = TEMPLATES[params.template];
  if (!tpl) throw new HttpError(404, "template_not_found", `No template "${params.template}". Try ${Object.keys(TEMPLATES).join(", ")}.`);
  const tz = zone(query.get("tz"), "");
  const fromDate = query.get("from");
  let from = floatingNow(now, tz || "UTC");
  if (fromDate !== null) {
    if (!isDate(fromDate)) throw new HttpError(400, "bad_from", 'from must be a date like "2026-10-15".');
    from = atDate(fromDate, 12 * 60); // midday, so "5 days out" rules don't depend on the hour
  }
  return cleanMission({ ...tpl.build(from), tz });
}

// ---------- helpers ----------

function parseInstant(s, now) {
  if (s === null || s === "") return now;
  const t = /^\d+$/.test(s) ? Number(s) : Date.parse(s);
  if (Number.isNaN(t)) throw new HttpError(400, "bad_at", 'at must be an ISO time like "2026-10-02T07:20:00+09:00" or milliseconds.');
  return t;
}

function zone(requested, fallback) {
  if (requested === null || requested === "") return fallback || "";
  if (!isTimeZone(requested)) throw new HttpError(400, "bad_tz", `Unknown time zone "${requested}". Use an IANA name like "Asia/Tokyo".`);
  return requested;
}

const round = (x) => Math.round(x * 1000) / 1000;
const error = (code, message) => ({ error: { code, message } });
function notFound(message) { throw new HttpError(404, "not_found", message); }
