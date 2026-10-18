/*
 * Sign in with Google and sync your missions with the Mission Timeline server.
 *
 * Sign-in: Google's button gives an ID token; the server checks it and returns its own session token,
 * kept in this browser. Sync: fetch your missions, merge them with this browser's (newest edit wins,
 * deletions stick; mergeMissions() in the shared core), save the result with the revision it was based
 * on, and on a conflict (another device saved first) merge again and retry.
 */
import { mergeMissions } from "../core/index.js";
import { SERVER_URL } from "./config.js";

const SESSION_KEY = "mission-timeline:session";
const SYNC_KEY = "mission-timeline:sync";
const GIS_SRC = "https://accounts.google.com/gsi/client";

const base = new URL("api/v1/", SERVER_URL ? new URL(SERVER_URL.replace(/\/?$/, "/")) : document.baseURI);
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const save = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* not saved */ } };

export class AuthError extends Error {}

async function call(method, path, { body, token } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(new URL(path, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new AuthError("Couldn't reach the Mission Timeline server.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

/**
 * @param local     { get(): { missions, tombstones }, set(missions, tombstones) }  this browser's missions
 * @param onChange  called when sign-in or sync state changes, to redraw
 */
export function createAccount({ local, onChange, onSynced = () => {}, onSignedOut = () => {} }) {
  let config = null;          // { enabled, google: { webClientId } } from the server, or null if there's no server
  let session = load(SESSION_KEY); // { token, expiresAt, account }
  let sync = load(SYNC_KEY) || { revision: 0, lastSynced: null, error: null };
  let syncing = null, timer = null;

  if (session && !(session.expiresAt > Date.now())) { session = null; save(SESSION_KEY, null); }

  const state = () => ({
    available: !!config?.enabled && !!config.google?.webClientId,
    account: session?.account || null,
    lastSynced: sync.lastSynced,
    syncing: !!syncing,
    error: sync.error,
  });
  const changed = () => onChange(state());

  async function init() {
    const r = await call("GET", "auth/config.json").catch(() => null);
    config = r?.status === 200 ? r.data : null;
    changed();
    if (session && config?.enabled) syncNow();
  }

  /** Draw Google's sign-in button into `el` (loads Google's script the first time). */
  async function renderButton(el) {
    if (!state().available || !el) return;
    await loadScript(GIS_SRC);
    const id = window.google?.accounts?.id;
    if (!id) return;
    id.initialize({ client_id: config.google.webClientId, callback: (r) => signIn(r.credential), use_fedcm_for_prompt: true, itp_support: true });
    id.renderButton(el, { theme: "outline", size: "medium", text: "signin_with", shape: "pill", logo_alignment: "left" });
  }

  async function signIn(idToken) {
    const r = await call("POST", "auth/google", { body: { idToken } });
    if (r.status !== 200) { sync.error = r.data?.error?.message || "Sign-in didn't work."; changed(); return; }
    session = r.data;
    save(SESSION_KEY, session);
    sync = { revision: 0, lastSynced: null, error: null };
    save(SYNC_KEY, sync);
    changed();
    await syncNow(); // merges this browser's missions into your account
  }

  /** Sign out of this browser. Your missions stay here and on the server. */
  function signOut() {
    window.google?.accounts?.id?.disableAutoSelect?.();
    session = null; save(SESSION_KEY, null);
    sync = { revision: 0, lastSynced: null, error: null }; save(SYNC_KEY, sync);
    onSignedOut();
    changed();
  }

  /** A signed-in request to the server: { status, data }. Null when signed out. */
  async function request(method, path, body) {
    if (!session || !config?.enabled) return null;
    const r = await call(method, path, { token: session.token, body });
    if (r.status === 401) { fail(r); onSignedOut(); changed(); }
    return r;
  }

  /** Sync soon (after an edit); several edits in a row make one sync. */
  function schedule() {
    if (!session || !config?.enabled) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  }

  function syncNow() {
    if (!session || !config?.enabled) return Promise.resolve();
    if (syncing) return syncing.then(() => syncNow());
    syncing = (async () => {
      changed();
      try {
        let remote = await get();
        for (let attempt = 0; attempt < 3; attempt++) {
          const merged = mergeMissions(local.get(), remote);
          local.set(merged.missions, merged.tombstones);
          if (same(merged, remote)) { sync.revision = remote.revision; break; }
          const r = await call("PUT", "me/missions", { token: session.token, body: { baseRevision: remote.revision, ...merged } });
          if (r.status === 200) { sync.revision = r.data.revision; break; }
          if (r.status === 409) { remote = r.data.state; continue; } // another device saved first: merge again
          throw fail(r);
        }
        sync.lastSynced = Date.now();
        sync.error = null;
        onSynced();
      } catch (e) {
        sync.error = e.message;
      } finally {
        save(SYNC_KEY, sync);
        syncing = null;
        changed();
      }
    })();
    return syncing;
  }

  async function get() {
    const r = await call("GET", "me/missions.json", { token: session.token });
    if (r.status === 200) return r.data;
    throw fail(r);
  }

  function fail(r) {
    if (r.status === 401) { // signed out elsewhere, or the session expired
      session = null; save(SESSION_KEY, null);
      return new AuthError("You've been signed out. Sign in again to sync.");
    }
    return new AuthError(r.data?.error?.message || `Sync failed (${r.status}).`);
  }

  // Keep in step with other devices while the page is open.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60000);

  return { init, renderButton, signOut, syncNow, schedule, state, request };
}

const same = (a, b) => JSON.stringify([a.missions, a.tombstones]) === JSON.stringify([b.missions, b.tombstones || {}]);

function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return new Promise((r) => setTimeout(r, 50));
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new AuthError("Couldn't load Google sign-in."));
    document.head.appendChild(s);
  });
}
