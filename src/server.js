/**
 * Mission Timeline server: the JSON API under /api/v1 plus the web app, with no dependencies.
 *
 *   npm start                     PORT=8080 HOST=0.0.0.0 DATA_DIR=./data
 *
 * Sign-in with Google and per-account mission sync turn on when these are set:
 *   GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID   OAuth client IDs (either or both)
 *   SESSION_SECRET                               32+ random characters, signs session tokens
 *   STATE_DIR                                    where accounts and their missions are kept (default ./var)
 *
 * The studio console at /studio (customer cases) uses the same sign-in, for the staff listed in:
 *   STUDIO_STAFF                                 "admin:you@studio.com,planner:them@studio.com"
 *   STUDIO_NAME                                  shown to customers as "From <name>" (default "Your studio")
 */
import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Repository } from "./api/repository.js";
import { handle } from "./api/router.js";
import { accountConfigFromEnv, createAccountApi, isAccountPath, isStudioPath } from "./api/account-routes.js";
import { createStudioApi } from "./api/studio-routes.js";
import { StudioStore, parseStaff } from "./studio/store.js";
import { AccountStore } from "./auth/accounts.js";
import { createSessions } from "./auth/session.js";
import { googleKeys, verifyGoogleIdToken } from "./auth/google.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** URL prefix -> folder. The web app imports the shared core from /core/. */
const STATIC_MOUNTS = [
  ["/core/", join(ROOT, "src", "core")],
  ["/", join(ROOT, "web")],
];

const CACHE = {
  static: "public, max-age=60",
  dynamic: "no-cache",
  none: "no-store",
};

const MAX_BODY = 2 * 1024 * 1024;

/** The account and studio APIs from settings; with sign-in off they still answer, explaining what's missing. */
export function apisFromConfig(config, { fetch: fetchFn, now = () => Date.now() } = {}) {
  if (!config.enabled) return { accountApi: createAccountApi({ config }), studioApi: createStudioApi({ config }) };
  const keyFor = googleKeys({ fetch: fetchFn, now });
  const dir = config.stateDir || join(ROOT, "var");
  const accounts = new AccountStore(dir, { now });
  const sessions = createSessions(config.secret, { now });
  const studio = new StudioStore(dir, { seedStaff: parseStaff(config.staff), now });
  return {
    accountApi: createAccountApi({
      config, accounts, sessions,
      verifyGoogle: (t) => verifyGoogleIdToken(t, { clientIds: config.clientIds, keyFor, now }),
    }),
    studioApi: createStudioApi({ config, accounts, sessions, studio }),
    studio,
  };
}

/** Just the account API (kept for callers that don't need the studio). */
export const accountApiFromConfig = (config, opts) => apisFromConfig(config, opts).accountApi;

export function createServer({
  dataDir = join(ROOT, "data"), repo = Repository.fromDir(dataDir), now = () => Date.now(), log = () => {},
  apis = null, accountApi = null, studioApi = null,
} = {}) {
  if (!accountApi || !studioApi) {
    const made = apis || apisFromConfig(accountConfigFromEnv());
    accountApi ||= made.accountApi;
    studioApi ||= made.studioApi;
  }
  const server = createHttpServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url, "http://localhost");
      // The iOS app's update feed lives at /ios/latest.json on the public site.
      const path = url.pathname === "/ios/latest.json" ? "/api/v1/ios/latest.json" : url.pathname;
      const studioPath = isStudioPath(path);
      if (studioPath || isAccountPath(path)) {
        let body;
        if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
          try { body = await readJsonBody(req); } catch (e) {
            return sendJson(req, res, { status: e.status || 400, body: { error: { code: e.code || "bad_json", message: e.message } }, cache: "none" });
          }
        }
        const api = studioPath ? studioApi : accountApi;
        const r = await api.handle({ method: req.method, path, query: url.searchParams, headers: req.headers, body });
        sendJson(req, res, r, url.searchParams.has("pretty"));
      } else if (path === "/api" || path.startsWith("/api/")) {
        const r = handle(repo, { method: req.method, path, query: url.searchParams }, now());
        sendJson(req, res, r, url.searchParams.has("pretty"));
      } else {
        await serveStatic(req, res, path);
      }
    } catch (e) {
      sendJson(req, res, { status: 500, body: { error: { code: "internal", message: "Something went wrong." } }, cache: "none" });
      console.error(e);
    } finally {
      log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
  server.repo = repo;
  return server;
}

/** The request body as JSON, at most 2 MB. */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error("The request is too large (2 MB at most)."), { status: 413, code: "too_large" });
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("The request body isn't valid JSON."); }
}

// Bearer tokens, not cookies, so allowing any origin is safe: a page can only act for you with your token.
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "If-None-Match, Accept, Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Access-Control-Expose-Headers", "ETag");
}

/** JSON response with CORS, caching, ETag/304 and gzip. `?pretty` indents it for reading. */
function sendJson(req, res, { status, body, cache, allow }, pretty = false) {
  cors(res);
  if (allow) res.setHeader("Allow", allow);
  res.setHeader("Cache-Control", CACHE[cache] || CACHE.none);
  if (body === null) { res.writeHead(status).end(); return; }
  const text = JSON.stringify(body, null, pretty ? 2 : 0) + "\n";
  const etag = `"${createHash("sha1").update(text).digest("base64url").slice(0, 20)}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Content-Type", MIME[".json"]);
  if (status === 200 && req.headers["if-none-match"] === etag) { res.writeHead(304).end(); return; }
  res.setHeader("Vary", "Accept-Encoding");
  let payload = Buffer.from(text);
  if (payload.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    payload = gzipSync(payload);
    res.setHeader("Content-Encoding", "gzip");
  }
  res.setHeader("Content-Length", payload.length);
  res.writeHead(status).end(req.method === "HEAD" ? undefined : payload);
}

async function serveStatic(req, res, path) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.writeHead(405).end();
    return;
  }
  const [prefix, dir] = STATIC_MOUNTS.find(([p]) => path.startsWith(p));
  let rel = decodeURIComponent(path.slice(prefix.length));
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = resolve(dir, rel);
  if (file !== dir && !file.startsWith(dir + sep)) { res.writeHead(403).end(); return; } // no ../ escapes
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    const data = await readFile(file);
    res.setHeader("Content-Type", MIME[extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Length", data.length);
    res.writeHead(200).end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.writeHead(404).end("Not found\n");
  }
}

// Run directly: node src/server.js
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || "127.0.0.1";
  const server = createServer({ dataDir: process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : undefined, log: (l) => console.log(l) });
  server.listen(port, host, () => {
    const auth = accountConfigFromEnv();
    console.log(`Mission Timeline on http://${host}:${port}  (API: /api/v1.json, ${server.repo.missions().length} missions, data revision ${server.repo.revision})`);
    console.log(auth.enabled ? `Sign-in with Google is on (accounts in ${auth.stateDir || "./var"}).` : "Sign-in is off: set GOOGLE_WEB_CLIENT_ID and SESSION_SECRET to turn it on.");
    if (auth.enabled) {
      const staff = Object.keys(parseStaff(auth.staff)).length;
      console.log(`Studio console: http://${host}:${port}/studio/ (${staff ? `${staff} staff from STUDIO_STAFF` : "set STUDIO_STAFF=admin:you@example.com to let yourself in"}).`);
    }
  });
}
