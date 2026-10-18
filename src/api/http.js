/** Bits shared by the async API handlers (accounts, studio). */

export class HttpError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

export const errorBody = (code, message, extra) => ({ error: { code, message }, ...extra });

/** Turn a handler's HttpError into a JSON error response. */
export async function respond(fn) {
  try {
    return { cache: "none", ...(await fn()) };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: errorBody(e.code, e.message, e.extra), cache: "none" };
    throw e;
  }
}

/** The signed-in account for a request with "Authorization: Bearer <token>", or a 401. */
export async function bearerAccount(req, { accounts, sessions }) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers?.authorization || "");
  const claims = m && sessions.read(m[1]);
  const account = claims && (await accounts.get(claims.uid));
  if (!account || account.sessionVersion !== claims.ver) throw new HttpError(401, "unauthorized", "Sign in first.");
  return account;
}
