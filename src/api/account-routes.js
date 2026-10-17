/**
 * Account endpoints: sign in with Google, and your own missions, synced between devices.
 * Async (they verify tokens and touch files), so they live apart from the read-only public routes.
 *
 *   GET  /api/v1/auth/config      { enabled, google: { webClientId, iosClientId } }    public
 *   POST /api/v1/auth/google      { idToken } -> { token, expiresAt, account }          public
 *   POST /api/v1/auth/signout     sign out every device (204)                            signed in
 *   GET  /api/v1/me               your account                                          signed in
 *   GET  /api/v1/me/missions      { revision, updatedAt, missions, tombstones }         signed in
 *   PUT  /api/v1/me/missions      { baseRevision, missions, tombstones } -> new state,  signed in
 *                                 or 409 with the current state if another device saved first
 *
 * Signed-in requests send "Authorization: Bearer <token>".
 */
import { MAX_MISSIONS } from "../auth/accounts.js";
import { GoogleTokenError } from "../auth/google.js";

const BASE = "/api/v1";

export const ACCOUNT_ENDPOINTS = [
  { method: "GET", path: `${BASE}/auth/config.json`, description: "Whether sign-in is set up, and the Google client IDs the apps should use." },
  { method: "POST", path: `${BASE}/auth/google`, description: "Sign in with a Google ID token: { idToken } -> { token, expiresAt, account }." },
  { method: "POST", path: `${BASE}/auth/signout`, description: "Sign out on every device. Needs a session token." },
  { method: "GET", path: `${BASE}/me.json`, description: "Your account. Needs a session token." },
  { method: "GET", path: `${BASE}/me/missions.json`, description: "Your missions: { revision, updatedAt, missions, tombstones }. Needs a session token." },
  { method: "PUT", path: `${BASE}/me/missions`, description: "Save your missions: { baseRevision, missions, tombstones }. 409 with the current state if it changed since baseRevision." },
];

export const isAccountPath = (path) => /^\/api\/v1\/(auth|me)(\/|\.json$|$)/.test(path);

class HttpError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const error = (code, message, extra) => ({ error: { code, message }, ...extra });

/**
 * @param config        { enabled, webClientId, iosClientId }
 * @param accounts      AccountStore
 * @param sessions      from createSessions()
 * @param verifyGoogle  idToken -> { sub, email, name, picture }
 */
export function createAccountApi({ config, accounts, sessions, verifyGoogle }) {
  const route = (method, path) => {
    const p = path.replace(/\.json$/, "").replace(/\/$/, "");
    const table = {
      "GET /api/v1/auth/config": authConfig,
      "POST /api/v1/auth/google": signIn,
      "POST /api/v1/auth/signout": signOut,
      "GET /api/v1/me": me,
      "GET /api/v1/me/missions": getMissions,
      "PUT /api/v1/me/missions": putMissions,
    };
    const allowed = Object.keys(table).filter((k) => k.endsWith(` ${p}`)).map((k) => k.split(" ")[0]);
    if (!allowed.length) return { notFound: true };
    const fn = table[`${method === "HEAD" ? "GET" : method} ${p}`];
    return fn ? { fn } : { allow: [...allowed, "OPTIONS"].join(", ") };
  };

  async function handle(req) {
    try {
      const r = route(req.method, req.path);
      if (r.notFound) throw new HttpError(404, "not_found", `No such endpoint: ${req.path}.`);
      if (req.method === "OPTIONS") return { status: 204, body: null, cache: "none" };
      if (!r.fn) return { status: 405, body: error("method_not_allowed", `Use ${r.allow}.`), cache: "none", allow: r.allow };
      return { cache: "none", ...(await r.fn(req)) };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: error(e.code, e.message, e.extra), cache: "none" };
      throw e;
    }
  }

  // ---------- handlers ----------

  function authConfig() {
    return { status: 200, body: { enabled: !!config.enabled, google: config.enabled ? { webClientId: config.webClientId || null, iosClientId: config.iosClientId || null } : null } };
  }

  async function signIn(req) {
    requireEnabled();
    const idToken = req.body?.idToken;
    if (typeof idToken !== "string" || !idToken) throw new HttpError(400, "bad_request", 'Send { "idToken": "<Google ID token>" }.');
    let identity;
    try {
      identity = await verifyGoogle(idToken);
    } catch (e) {
      if (e instanceof GoogleTokenError) throw new HttpError(401, "bad_google_token", e.message);
      throw e;
    }
    const account = await accounts.upsertGoogle(identity);
    const { token, expiresAt } = sessions.issue(account.id, account.sessionVersion);
    return { status: 200, body: { token, expiresAt, account: publicAccount(account) } };
  }

  async function signOut(req) {
    const account = await requireAccount(req);
    await accounts.bumpSessionVersion(account.id);
    return { status: 204, body: null };
  }

  async function me(req) {
    return { status: 200, body: publicAccount(await requireAccount(req)) };
  }

  async function getMissions(req) {
    const account = await requireAccount(req);
    return { status: 200, body: await accounts.missions(account.id) };
  }

  async function putMissions(req) {
    const account = await requireAccount(req);
    const b = req.body || {};
    if (!Number.isInteger(b.baseRevision) || b.baseRevision < 0) throw new HttpError(400, "bad_request", "baseRevision must be the revision you last fetched (0 if none).");
    if (!Array.isArray(b.missions)) throw new HttpError(400, "bad_request", "missions must be a list.");
    if (b.missions.length > MAX_MISSIONS) throw new HttpError(413, "too_many_missions", `At most ${MAX_MISSIONS} missions.`);
    const tombstones = b.tombstones && typeof b.tombstones === "object" && !Array.isArray(b.tombstones)
      ? Object.fromEntries(Object.entries(b.tombstones).filter(([, at]) => Number.isFinite(at)))
      : {};
    const r = await accounts.saveMissions(account.id, { baseRevision: b.baseRevision, missions: b.missions, tombstones });
    if (!r.ok) throw new HttpError(409, "conflict", "Your missions changed on another device. Merge with these and try again.", { state: r.state });
    return { status: 200, body: r.state };
  }

  // ---------- helpers ----------

  function requireEnabled() {
    if (!config.enabled) throw new HttpError(503, "auth_not_configured", "Sign-in isn't set up on this server (GOOGLE_WEB_CLIENT_ID and SESSION_SECRET).");
  }

  async function requireAccount(req) {
    requireEnabled();
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers?.authorization || "");
    const claims = m && sessions.read(m[1]);
    const account = claims && (await accounts.get(claims.uid));
    if (!account || account.sessionVersion !== claims.ver) throw new HttpError(401, "unauthorized", "Sign in first.");
    return account;
  }

  return { handle };
}

const publicAccount = (a) => ({ id: a.id, provider: a.provider, email: a.email, name: a.name, picture: a.picture, createdAt: a.createdAt });

/** Settings from the environment. Sign-in is on when a Google client ID and a session secret are set. */
export function accountConfigFromEnv(env = process.env) {
  const webClientId = env.GOOGLE_WEB_CLIENT_ID || "";
  const iosClientId = env.GOOGLE_IOS_CLIENT_ID || "";
  const secret = env.SESSION_SECRET || "";
  return {
    enabled: !!(webClientId || iosClientId) && secret.length >= 32,
    webClientId, iosClientId, secret,
    clientIds: [webClientId, iosClientId].filter(Boolean),
    stateDir: env.STATE_DIR || "",
  };
}
