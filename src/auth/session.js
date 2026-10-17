/**
 * Session tokens: what the server gives you after you sign in with Google, sent back as
 * "Authorization: Bearer <token>". Stateless and signed (HMAC-SHA256 with SESSION_SECRET):
 *
 *   mt1.<base64url payload>.<base64url signature>     payload: { uid, ver, iat, exp }
 *
 * `ver` is the account's session version; signing out everywhere bumps it, which invalidates every
 * token issued before.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_TTL_MS = 30 * 86400000;
const PREFIX = "mt1";

export function createSessions(secret, { ttlMs = SESSION_TTL_MS, now = () => Date.now() } = {}) {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  const sign = (data) => createHmac("sha256", secret).update(data).digest("base64url");

  return {
    issue(uid, ver) {
      const iat = now();
      const payload = Buffer.from(JSON.stringify({ uid, ver, iat, exp: iat + ttlMs })).toString("base64url");
      const body = `${PREFIX}.${payload}`;
      return { token: `${body}.${sign(body)}`, expiresAt: iat + ttlMs };
    },

    /** The token's claims, or null if it's malformed, forged or expired. */
    read(token) {
      const parts = String(token || "").split(".");
      if (parts.length !== 3 || parts[0] !== PREFIX) return null;
      const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
      const given = Buffer.from(parts[2]);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      let claims;
      try { claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
      if (!claims.uid || !(claims.exp > now())) return null;
      return claims;
    },
  };
}
