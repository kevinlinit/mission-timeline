/**
 * Studio endpoints: the staff console's API for customer cases, and the customer's side of it.
 * Everything needs a session token from POST /api/v1/auth/google. Staff are the emails on the staff
 * list (STUDIO_STAFF, plus those an admin adds); customers are matched to cases by their Google email.
 *
 * Staff (admin or planner):
 *   GET    /studio/me                                   who you are, your role, the pipeline
 *   GET    /studio/cases?status=&assignee=&priority=&q=&open=1
 *   POST   /studio/cases                                { customer, trip, priority, assignee, status, note }
 *   GET    /studio/cases/:id
 *   PATCH  /studio/cases/:id                            { baseRevision?, status?, priority?, assignee?, customer?, trip? }
 *   POST   /studio/cases/:id/notes                      { text }
 *   POST   /studio/cases/:id/itineraries                { mission, baseRevision? }       add
 *   PUT    /studio/cases/:id/itineraries/:mid           { mission, baseRevision? }       replace
 *   DELETE /studio/cases/:id/itineraries/:mid
 *   POST   /studio/cases/:id/itineraries/:mid/share     { shared: true | false }
 *   GET    /studio/staff
 * Admins only:
 *   DELETE /studio/cases/:id
 *   PUT    /studio/staff/:email                         { role }
 *   DELETE /studio/staff/:email
 * Customers:
 *   GET    /me/studio                                   { studio, trips: [{ caseId, ref, status, planner, sharedAt, mission }] }
 *   PUT    /me/studio/trips/:mid/progress               { blocks: { [id]: { status, at } }, memos } -> { mission }
 */
import { HttpError, bearerAccount, respond } from "./http.js";
import { StudioError } from "../studio/store.js";
import { OPEN_STAGES, PIPELINE, PRIORITIES, ROLES, customerMission, normEmail } from "../studio/model.js";

const B = "/api/v1";
const ID = "(c_[a-z0-9]+)";
const MID = "([A-Za-z0-9_-]{1,64})";

export const STUDIO_ENDPOINTS = [
  { method: "GET", path: `${B}/studio/me.json`, description: "Staff: who you are and your role. 403 if you're not on the staff list." },
  { method: "GET", path: `${B}/studio/cases.json`, description: "Staff: customer cases, filtered by ?status=&assignee=&priority=&q=&open=1, with counts per stage." },
  { method: "POST", path: `${B}/studio/cases`, description: "Staff: open a case { customer: { name, email, phone }, trip, priority, assignee }." },
  { method: "GET", path: `${B}/studio/cases/{id}.json`, description: "Staff: a case with its notes, history and itineraries." },
  { method: "PATCH", path: `${B}/studio/cases/{id}`, description: "Staff: change status, priority, assignee, customer or trip. Send baseRevision to avoid overwriting someone else's change (409)." },
  { method: "POST", path: `${B}/studio/cases/{id}/notes`, description: "Staff: add an internal note { text }." },
  { method: "POST", path: `${B}/studio/cases/{id}/itineraries`, description: "Staff: add an itinerary { mission } in the mission-timeline/v1 mission shape." },
  { method: "PUT", path: `${B}/studio/cases/{id}/itineraries/{missionId}`, description: "Staff: replace an itinerary's mission. Shared ones update in the customer's app." },
  { method: "POST", path: `${B}/studio/cases/{id}/itineraries/{missionId}/share`, description: "Staff: { shared: true } to send it to the customer's app (by their email), false to take it back." },
  { method: "GET", path: `${B}/studio/staff.json`, description: "Staff: the staff list. Admins change it with PUT/DELETE /studio/staff/{email}." },
  { method: "GET", path: `${B}/me/studio.json`, description: "Customers: trips your studio shared with your email." },
  { method: "PUT", path: `${B}/me/studio/trips/{missionId}/progress`, description: "Customers: your done / changed / skipped marks and debrief notes { blocks, memos }; the studio sees them." },
];

/**
 * @param config    { enabled, studioName }
 * @param accounts  AccountStore (the same one the account API uses)
 * @param sessions  from createSessions()
 * @param studio    StudioStore
 */
export function createStudioApi({ config, accounts, sessions, studio }) {
  const routes = [
    ["GET", "/studio/me", staffOnly(me)],
    ["GET", "/studio/cases", staffOnly(listCases)],
    ["POST", "/studio/cases", staffOnly(createCase)],
    ["GET", `/studio/cases/${ID}`, staffOnly(getCase)],
    ["PATCH", `/studio/cases/${ID}`, staffOnly(patchCase)],
    ["DELETE", `/studio/cases/${ID}`, adminOnly(deleteCase)],
    ["POST", `/studio/cases/${ID}/notes`, staffOnly(addNote)],
    ["POST", `/studio/cases/${ID}/itineraries`, staffOnly(addItinerary)],
    ["PUT", `/studio/cases/${ID}/itineraries/${MID}`, staffOnly(putItinerary)],
    ["DELETE", `/studio/cases/${ID}/itineraries/${MID}`, staffOnly(deleteItinerary)],
    ["POST", `/studio/cases/${ID}/itineraries/${MID}/share`, staffOnly(share)],
    ["GET", "/studio/staff", staffOnly(listStaff)],
    ["PUT", "/studio/staff/([^/]+)", adminOnly(putStaff)],
    ["DELETE", "/studio/staff/([^/]+)", adminOnly(deleteStaff)],
    ["GET", "/me/studio", customer(myTrips)],
    ["PUT", `/me/studio/trips/${MID}/progress`, customer(progress)],
  ].map(([method, pattern, fn]) => ({ method, re: new RegExp(`^${B}${pattern}$`), fn }));

  async function handle(req) {
    const path = req.path.replace(/\.json$/, "").replace(/\/$/, "");
    const hits = routes.map((r) => ({ r, m: r.re.exec(path) })).filter((x) => x.m);
    if (!hits.length) return respond(() => { throw new HttpError(404, "not_found", `No such endpoint: ${req.path}.`); });
    if (req.method === "OPTIONS") return { status: 204, body: null, cache: "none" };
    const method = req.method === "HEAD" ? "GET" : req.method;
    const hit = hits.find((x) => x.r.method === method);
    if (!hit) {
      const allow = [...new Set(hits.map((x) => x.r.method)), "OPTIONS"].join(", ");
      return { status: 405, body: { error: { code: "method_not_allowed", message: `Use ${allow}.` } }, cache: "none", allow };
    }
    return respond(async () => {
      try {
        return await hit.r.fn(req, ...hit.m.slice(1).map(decodeURIComponent));
      } catch (e) {
        if (e instanceof StudioError) throw new HttpError(e.status, e.code, e.message, e.extra && { ...e.extra, case: e.extra.case && (await withCustomer(e.extra.case)) });
        throw e;
      }
    });
  }

  // ---------- who's asking ----------

  async function signedIn(req) {
    if (!config.enabled) throw new HttpError(503, "auth_not_configured", "Sign-in isn't set up on this server (GOOGLE_WEB_CLIENT_ID and SESSION_SECRET).");
    return bearerAccount(req, { accounts, sessions });
  }

  function staffOnly(fn, roles = ROLES) {
    return async (req, ...args) => {
      const account = await signedIn(req);
      const role = await studio.roleOf(account.email);
      if (!role) throw new HttpError(403, "not_staff", `${account.email} isn't on the studio's staff list. Ask an admin to add you.`);
      if (!roles.includes(role)) throw new HttpError(403, "admins_only", "Only admins can do that.");
      return fn({ req, account, role, by: normEmail(account.email), body: req.body || {} }, ...args);
    };
  }
  function adminOnly(fn) { return staffOnly(fn, ["admin"]); }
  function customer(fn) {
    return async (req, ...args) => fn({ req, account: await signedIn(req), body: req.body || {} }, ...args);
  }

  // ---------- staff ----------

  function me({ account, role }) {
    return ok({
      email: normEmail(account.email), name: account.name, picture: account.picture, role,
      studio: { name: config.studioName || "Your studio" },
      pipeline: PIPELINE.map(([id, label]) => ({ id, label, open: OPEN_STAGES.includes(id) })),
      priorities: PRIORITIES,
    });
  }

  async function listCases({ req }) {
    const q = req.query || new URLSearchParams();
    return ok(await studio.list({
      status: q.get("status") || "", priority: q.get("priority") || "", q: q.get("q") || "",
      assignee: normEmail(q.get("assignee")), open: ["1", "true"].includes(q.get("open")),
    }));
  }

  async function createCase({ by, body }) {
    return { status: 201, body: { case: await withCustomer(await studio.create(body, by)) } };
  }

  async function getCase(_, id) { return ok({ case: await withCustomer(await studio.get(id)) }); }

  async function patchCase({ by, body }, id) {
    const patch = Object.fromEntries(["status", "priority", "assignee", "customer", "trip"].filter((k) => k in body).map((k) => [k, body[k]]));
    const r = await studio.update(id, patch, by, body.baseRevision);
    return ok({ case: await withCustomer(r.case) });
  }

  async function deleteCase(_, id) { await studio.remove(id); return { status: 204, body: null }; }

  async function addNote({ by, body }, id) {
    return ok({ case: await withCustomer((await studio.addNote(id, body.text, by)).case) });
  }

  async function addItinerary({ by, body }, id) {
    if (!body.mission || typeof body.mission !== "object") throw new HttpError(400, "bad_request", "Send { mission } in the mission-timeline/v1 mission shape.");
    const r = await studio.putItinerary(id, null, body.mission, by, body.baseRevision);
    return { status: 201, body: { case: await withCustomer(r.case), missionId: r.missionId } };
  }

  async function putItinerary({ by, body }, id, mid) {
    if (!body.mission || typeof body.mission !== "object") throw new HttpError(400, "bad_request", "Send { mission } in the mission-timeline/v1 mission shape.");
    const r = await studio.putItinerary(id, mid, body.mission, by, body.baseRevision);
    return ok({ case: await withCustomer(r.case), missionId: r.missionId });
  }

  async function deleteItinerary({ by }, id, mid) {
    return ok({ case: await withCustomer((await studio.deleteItinerary(id, mid, by)).case) });
  }

  async function share({ by, body }, id, mid) {
    if (typeof body.shared !== "boolean") throw new HttpError(400, "bad_request", "Send { shared: true } or { shared: false }.");
    return ok({ case: await withCustomer((await studio.share(id, mid, body.shared, by)).case) });
  }

  async function listStaff() { return ok({ staff: await withNames(await studio.staff()) }); }
  async function putStaff({ by, body }, email) { return ok({ staff: await withNames(await studio.setStaff(email, body.role, by)) }); }
  async function deleteStaff({ by }, email) { return ok({ staff: await withNames(await studio.removeStaff(email, by)) }); }

  // ---------- customers ----------

  async function myTrips({ account }) {
    const found = await studio.forCustomer(account.email);
    const names = await namesByEmail();
    return ok({
      studio: { name: config.studioName || "Your studio" },
      trips: found.map(({ c, it }) => ({
        caseId: c.id, ref: c.ref, status: c.status,
        planner: c.assignee ? { email: c.assignee, name: names.get(c.assignee)?.name || "" } : null,
        sharedAt: it.sharedAt,
        mission: customerMission(it),
      })),
    });
  }

  async function progress({ account, body }, mid) {
    return ok({ mission: await studio.recordProgress(account.email, mid, body) });
  }

  // ---------- helpers ----------

  async function namesByEmail() {
    const all = await accounts.load();
    return new Map(Object.values(all).map((a) => [normEmail(a.email), a]));
  }

  /** The case for staff, with each itinerary as the customer sees it and whether the customer has signed in. */
  async function withCustomer(c) {
    const a = c.customer.email && (await namesByEmail()).get(c.customer.email);
    return { ...staffCase(c), customerAccount: a ? { signedIn: true, lastSignIn: a.lastSignIn } : { signedIn: false } };
  }

  async function withNames(staff) {
    const names = await namesByEmail();
    return staff.map((s) => ({ ...s, name: names.get(s.email)?.name || "", lastSignIn: names.get(s.email)?.lastSignIn || null }));
  }

  return { handle };
}

const ok = (body) => ({ status: 200, body });

/** A case as staff see it: each itinerary also comes with `live`, the mission with the customer's marks. */
export function staffCase(c) {
  return { ...c, itineraries: c.itineraries.map((it) => ({ ...it, live: customerMission(it) })) };
}
