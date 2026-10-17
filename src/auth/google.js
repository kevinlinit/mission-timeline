/**
 * Verifies Google ID tokens (the JWT the web sign-in button and the iOS sign-in flow return), with no
 * dependencies: Google's public keys come from its JWKS endpoint and the RS256 signature is checked
 * with node:crypto. See https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
 */
import { createPublicKey, verify } from "node:crypto";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const LEEWAY_S = 60; // clock skew allowed on exp/iat

export class GoogleTokenError extends Error {}

const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

/** Fetches Google's signing keys and caches them for as long as Google says (Cache-Control max-age). */
export function googleKeys({ fetch: fetchFn = globalThis.fetch, url = JWKS_URL, now = () => Date.now() } = {}) {
  let cache = { keys: new Map(), until: 0 };
  return async function keyFor(kid) {
    if (now() >= cache.until || !cache.keys.has(kid)) {
      const res = await fetchFn(url);
      if (!res.ok) throw new GoogleTokenError(`Couldn't fetch Google's keys (${res.status}).`);
      const { keys } = await res.json();
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1] || 3600);
      cache = { keys: new Map(keys.map((k) => [k.kid, createPublicKey({ key: k, format: "jwk" })])), until: now() + maxAge * 1000 };
    }
    const key = cache.keys.get(kid);
    if (!key) throw new GoogleTokenError("The sign-in token was signed with an unknown key.");
    return key;
  };
}

/**
 * Check a Google ID token and return the person it's for.
 * @param token      the JWT
 * @param clientIds  OAuth client IDs this server accepts (web and iOS)
 * @param keyFor     from googleKeys()
 * @returns { sub, email, name, picture }
 */
export async function verifyGoogleIdToken(token, { clientIds, keyFor, now = () => Date.now() }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new GoogleTokenError("That isn't a Google sign-in token.");
  let header, payload;
  try { header = b64json(parts[0]); payload = b64json(parts[1]); } catch { throw new GoogleTokenError("That isn't a Google sign-in token."); }
  if (header.alg !== "RS256" || !header.kid) throw new GoogleTokenError("Unexpected token algorithm.");

  const key = await keyFor(header.kid);
  const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new GoogleTokenError("The sign-in token's signature is wrong.");

  const t = Math.floor(now() / 1000);
  if (!ISSUERS.has(payload.iss)) throw new GoogleTokenError("The sign-in token isn't from Google.");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.some((a) => clientIds.includes(a))) throw new GoogleTokenError("The sign-in token is for a different app.");
  if (!(payload.exp + LEEWAY_S > t)) throw new GoogleTokenError("The sign-in token has expired. Sign in again.");
  if (payload.iat && payload.iat - LEEWAY_S > t) throw new GoogleTokenError("The sign-in token is from the future.");
  if (!payload.sub) throw new GoogleTokenError("The sign-in token has no account id.");
  if (payload.email && payload.email_verified === false) throw new GoogleTokenError("Verify your Google email address first.");

  return { sub: String(payload.sub), email: String(payload.email || ""), name: String(payload.name || ""), picture: String(payload.picture || "") };
}
