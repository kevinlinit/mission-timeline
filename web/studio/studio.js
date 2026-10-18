/*
 * The studio console: customer cases for staff. Signs in with Google like the customer app (its own
 * session, kept in this browser), then talks to /api/v1/studio. Hash routes:
 *
 *   #/              cases, filtered by stage, planner, priority and a search
 *   #/case/<id>     one case: pipeline, customer, trip, itineraries, notes, history
 *   #/new           open a case
 *   #/staff         who can use the console (admins change it)
 */
import { summarize, tally } from "../core/index.js";
import { SERVER_URL } from "../js/config.js";
import { openEditor } from "./editor.js";

const SESSION_KEY = "mission-timeline:studio-session";
const FILTER_KEY = "mission-timeline:studio-filters";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const base = new URL("api/v1/", SERVER_URL ? SERVER_URL.replace(/\/?$/, "/") : new URL("../", location.href));

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const save = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };

let session = load(SESSION_KEY);
let me = null;            // { email, name, role, studio, pipeline, priorities }
let staff = [];
let list = null;          // { cases, counts, total }
let current = null;       // the open case
let filters = { stage: "open", assignee: "", priority: "", q: "", ...load(FILTER_KEY) };
let authConfig = null;

// ---------- API ----------

class ApiError extends Error {
  constructor(status, body) { super(body?.error?.message || `The server answered ${status}.`); this.status = status; this.body = body; }
}

async function api(method, path, body) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  let res;
  try {
    res = await fetch(new URL(path, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: { message: "Couldn't reach the Mission Timeline server." } });
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && session) { signOut(); throw new ApiError(401, data); }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------- small UI helpers ----------

let toastTimer;
function toast(text, err = false) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.toggle("err", err);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), err ? 6000 : 2800);
}

const stageLabel = (id) => me?.pipeline.find((s) => s.id === id)?.label || id;
const ago = (t) => {
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const when = (t) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) : "");
const span = (a, b) => (a && b ? `${fmtDate(a)} – ${fmtDate(b)}` : a ? `from ${fmtDate(a)}` : b ? `until ${fmtDate(b)}` : "Dates open");
const initials = (email) => {
  const s = staff.find((x) => x.email === email);
  const n = (s?.name || email || "").replace(/@.*/, "");
  return n.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
};
const staffName = (email) => staff.find((x) => x.email === email)?.name || email;
const money = (b) => (b?.amount ? new Intl.NumberFormat(undefined, { style: "currency", currency: b.currency || "USD", maximumFractionDigits: 0 }).format(b.amount) : "");
const isAdmin = () => me?.role === "admin";

// ---------- sign-in ----------

function signOut() {
  window.google?.accounts?.id?.disableAutoSelect?.();
  session = null; me = null; save(SESSION_KEY, null);
  route();
}

async function signIn(idToken) {
  try {
    const r = await fetch(new URL("auth/google", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || "Sign-in didn't work.");
    session = data; save(SESSION_KEY, session);
    await start();
  } catch (e) { toast(e.message, true); }
}

function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error("Couldn't load Google sign-in."));
    document.head.appendChild(s);
  });
}

async function renderSignIn(message = "") {
  $("#topnav").hidden = true;
  $("#me").innerHTML = "";
  const enabled = authConfig?.enabled && authConfig.google?.webClientId;
  $("#app").innerHTML = `<section class="gate">
    <h1>Studio console</h1>
    <p class="sub">Customer cases, from the first inquiry to the trip home. Sign in with the Google account on the studio's staff list.</p>
    ${message ? `<p class="gate-msg">${message}</p>` : ""}
    ${enabled ? `<div id="gsi"></div>` : `<p class="gate-msg">${authConfig ? "Sign-in isn't set up on this server yet: set <code>GOOGLE_WEB_CLIENT_ID</code> and <code>SESSION_SECRET</code>, and <code>STUDIO_STAFF</code> for who may use the console." : "Couldn't reach the Mission Timeline server. The console needs the Node server (<code>npm start</code>), not the static site."}</p>`}
  </section>`;
  if (!enabled) return;
  try {
    await loadScript(GIS_SRC);
    const id = window.google?.accounts?.id;
    id?.initialize({ client_id: authConfig.google.webClientId, callback: (r) => signIn(r.credential), use_fedcm_for_prompt: true, itp_support: true });
    id?.renderButton($("#gsi"), { theme: "outline", size: "large", text: "signin_with", shape: "pill" });
  } catch (e) { $("#gsi").textContent = e.message; }
}

function renderMe() {
  $("#studio-name").textContent = me.studio.name;
  document.title = `${me.studio.name} · Studio Cases`;
  $("#topnav").hidden = false;
  $("#me").innerHTML = `${session.account?.picture ? `<img src="${esc(session.account.picture)}" alt="" width="28" height="28" referrerpolicy="no-referrer">` : `<span class="av">${esc(initials(me.email))}</span>`}
    <span class="who"><b>${esc(me.name || me.email)}</b><small>${esc(me.role === "admin" ? "Admin" : "Planner")}</small></span>
    <button class="btn small" id="sign-out" type="button">Sign out</button>`;
  $("#sign-out").onclick = signOut;
}

// ---------- routing ----------

async function start() {
  if (!authConfig) authConfig = await fetch(new URL("auth/config.json", base)).then((r) => r.json()).catch(() => null);
  if (!session || !(session.expiresAt > Date.now())) { session = null; save(SESSION_KEY, null); return renderSignIn(); }
  try {
    me = await api("GET", "studio/me.json");
    staff = (await api("GET", "studio/staff.json")).staff;
  } catch (e) {
    if (e.status === 403) {
      return renderSignIn(`${esc(e.message)} <button class="btn small" id="gate-out" type="button">Use another account</button>`).then(() => { const b = $("#gate-out"); if (b) b.onclick = signOut; });
    }
    return renderSignIn(esc(e.message));
  }
  renderMe();
  route();
}

window.addEventListener("hashchange", () => me && route());

async function route() {
  if (!me) return start();
  const h = location.hash.replace(/^#/, "") || "/";
  $$("#topnav a").forEach((a) => a.setAttribute("aria-current", String((a.dataset.nav === "staff") === h.startsWith("/staff"))));
  if (h.startsWith("/staff")) return renderStaff();
  const m = /^\/case\/(c_[a-z0-9]+)/.exec(h);
  if (h === "/new") { await refreshList(); return renderCases({ creating: true }); }
  await refreshList();
  if (m) {
    try { current = (await api("GET", `studio/cases/${m[1]}.json`)).case; } catch (e) { toast(e.message, true); current = null; }
  } else current = null;
  renderCases();
}

// ---------- the case list ----------

async function refreshList() {
  const q = new URLSearchParams();
  if (filters.stage === "open") q.set("open", "1"); else if (filters.stage !== "all") q.set("status", filters.stage);
  if (filters.assignee === "me") q.set("assignee", me.email); else if (filters.assignee) q.set("assignee", filters.assignee);
  if (filters.priority) q.set("priority", filters.priority);
  if (filters.q) q.set("q", filters.q);
  try { list = await api("GET", `studio/cases.json?${q}`); } catch (e) { toast(e.message, true); list = list || { cases: [], counts: {}, total: 0 }; }
}

function setFilter(k, v) {
  filters[k] = v;
  save(FILTER_KEY, filters);
  refreshList().then(() => { renderList(); });
}

function renderCases({ creating = false } = {}) {
  const app = $("#app");
  const showing = creating ? "new" : current ? "case" : "none";
  app.innerHTML = `<div class="split" data-showing="${showing}">
    <section class="list-pane" aria-label="Cases">
      <div class="list-head">
        <h1>Cases</h1>
        <a class="btn primary" href="#/new">+ New case</a>
      </div>
      <div class="stages" role="tablist" aria-label="Stage" id="stages"></div>
      <div class="filters">
        <label class="search"><span class="sr">Search</span><input id="f-q" type="search" placeholder="Search name, email, place, tag…" value="${esc(filters.q)}"></label>
        <label><span class="sr">Planner</span><select id="f-assignee">
          <option value="">Any planner</option><option value="me">Mine</option><option value="none">Unassigned</option>
          ${staff.map((s) => `<option value="${esc(s.email)}">${esc(s.name || s.email)}</option>`).join("")}
        </select></label>
        <label><span class="sr">Priority</span><select id="f-priority"><option value="">Any priority</option>${me.priorities.slice().reverse().map((p) => `<option value="${p}">${p[0].toUpperCase() + p.slice(1)}</option>`).join("")}</select></label>
      </div>
      <ol class="cases" id="cases"></ol>
    </section>
    <section class="detail-pane" id="detail" aria-live="polite"></section>
  </div>`;
  $("#f-assignee").value = filters.assignee;
  $("#f-priority").value = filters.priority;
  let qTimer;
  $("#f-q").oninput = (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => setFilter("q", e.target.value.trim()), 250); };
  $("#f-assignee").onchange = (e) => setFilter("assignee", e.target.value);
  $("#f-priority").onchange = (e) => setFilter("priority", e.target.value);
  renderList();
  if (creating) renderNewCase();
  else if (current) renderCase();
  else $("#detail").innerHTML = `<div class="placeholder"><p class="muted">${list.total ? "Pick a case to see it here." : "No cases yet. Open the first one with <b>+ New case</b>."}</p></div>`;
}

function renderList() {
  const c = list.counts || {};
  const open = me.pipeline.filter((s) => s.open).reduce((n, s) => n + (c[s.id] || 0), 0);
  const tabs = [["open", "Open", open], ...me.pipeline.map((s) => [s.id, s.label, c[s.id] || 0]), ["all", "All", Object.values(c).reduce((a, b) => a + b, 0)]];
  $("#stages").innerHTML = tabs.map(([id, label, n]) => `<button role="tab" class="stage-tab s-${id}" data-stage="${id}" aria-selected="${filters.stage === id}">${esc(label)} <span class="num">${n}</span></button>`).join("");
  $$("#stages [data-stage]").forEach((b) => (b.onclick = () => setFilter("stage", b.dataset.stage)));
  const el = $("#cases");
  if (!list.cases.length) {
    el.innerHTML = `<li class="empty-list muted">${filters.q || filters.assignee || filters.priority ? "No cases match these filters." : "Nothing here."}</li>`;
    return;
  }
  el.innerHTML = list.cases.map((x) => {
    const pct = x.progress.total ? Math.round((x.progress.done / x.progress.total) * 100) : 0;
    return `<li><a class="case-row${current?.id === x.id ? " on" : ""}" href="#/case/${x.id}" data-id="${x.id}">
      <div class="cr-top"><span class="ref num">${esc(x.ref)}</span>${x.priority !== "normal" ? `<span class="pri p-${x.priority}">${esc(x.priority)}</span>` : ""}<span class="pill s-${x.status}">${esc(stageLabel(x.status))}</span></div>
      <div class="cr-name"><b>${esc(x.customer.name || x.customer.email)}</b>${x.assignee ? `<span class="av sm" title="${esc(staffName(x.assignee))}">${esc(initials(x.assignee))}</span>` : `<span class="av sm none" title="Unassigned">–</span>`}</div>
      <div class="cr-meta muted">${esc(x.trip.destinations.join(", ") || "Destination open")} · ${esc(span(x.trip.start, x.trip.end))}${x.trip.travellers ? ` · ${x.trip.travellers} pax` : ""}</div>
      ${x.shared ? `<div class="cr-prog" title="${x.progress.done} of ${x.progress.total} blocks marked by the customer"><i style="width:${pct}%"></i></div>` : ""}
      <div class="cr-foot muted">${x.itineraries ? `${x.itineraries} itinerar${x.itineraries === 1 ? "y" : "ies"}${x.shared ? `, ${x.shared} shared` : ""} · ` : ""}${esc(ago(x.updatedAt))}</div>
    </a></li>`;
  }).join("");
}

// ---------- a new case ----------

function renderNewCase() {
  $("#detail").innerHTML = `<form class="case-form" id="new-case">
    <a class="back" href="#/">← Cases</a>
    <h2>New case</h2>
    <fieldset><legend>Customer</legend><div class="grid3">
      <label class="field">Name<input name="name" maxlength="120" autocomplete="off" required></label>
      <label class="field">Email <small>(how the itinerary reaches their app)</small><input name="email" type="email" maxlength="254" autocomplete="off"></label>
      <label class="field">Phone<input name="phone" maxlength="40" autocomplete="off"></label>
    </div></fieldset>
    ${tripFields({ start: "", end: "", destinations: [], travellers: 2, budget: { amount: 0, currency: "USD" }, source: "", tags: [], request: "" })}
    <fieldset><legend>Handling</legend><div class="grid3">
      <label class="field">Planner<select name="assignee"><option value="">Unassigned</option>${staff.map((s) => `<option value="${esc(s.email)}"${s.email === me.email ? " selected" : ""}>${esc(s.name || s.email)}</option>`).join("")}</select></label>
      <label class="field">Priority<select name="priority">${me.priorities.map((p) => `<option${p === "normal" ? " selected" : ""}>${p}</option>`).join("")}</select></label>
      <label class="field wide">First note (internal)<textarea name="note" maxlength="4000" placeholder="What came up on the first call: pace, must-sees, dietary needs…"></textarea></label>
    </div></fieldset>
    <div class="row-actions"><button class="btn primary" type="submit">Open case</button><a class="btn" href="#/">Cancel</a></div>
  </form>`;
  $("#new-case").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $("button[type=submit]", e.target);
    btn.disabled = true;
    try {
      const r = await api("POST", "studio/cases", {
        customer: { name: f.get("name"), email: f.get("email"), phone: f.get("phone") },
        trip: tripFrom(f), assignee: f.get("assignee"), priority: f.get("priority"), note: f.get("note"),
      });
      toast(`Opened ${r.case.ref}`);
      location.hash = `#/case/${r.case.id}`;
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

function tripFields(t) {
  return `<fieldset><legend>Trip</legend><div class="grid3">
    <label class="field">From<input name="start" type="date" value="${esc(t.start)}"></label>
    <label class="field">To<input name="end" type="date" value="${esc(t.end)}"></label>
    <label class="field">Travellers<input name="travellers" type="number" min="0" max="99" value="${t.travellers || ""}"></label>
    <label class="field wide">Destinations <small>(comma-separated)</small><input name="destinations" maxlength="600" value="${esc(t.destinations.join(", "))}" placeholder="Kyoto, Osaka, Nara"></label>
    <label class="field">Budget<span class="money"><input name="budget" type="number" min="0" step="50" value="${t.budget.amount || ""}"><input name="currency" maxlength="3" value="${esc(t.budget.currency)}" aria-label="Currency"></span></label>
    <label class="field">Came in through<input name="source" maxlength="60" value="${esc(t.source)}" placeholder="Website, referral, Instagram…" list="sources"></label>
    <label class="field">Tags <small>(comma-separated)</small><input name="tags" maxlength="600" value="${esc(t.tags.join(", "))}" placeholder="honeymoon, food"></label>
    <label class="field wide">What they asked for<textarea name="request" maxlength="4000" placeholder="In the customer's words.">${esc(t.request)}</textarea></label>
  </div><datalist id="sources"><option>Website</option><option>Referral</option><option>Instagram</option><option>Email</option><option>Phone</option><option>Returning customer</option></datalist></fieldset>`;
}

const tripFrom = (f) => ({
  start: f.get("start"), end: f.get("end"), travellers: Number(f.get("travellers")) || 0,
  destinations: String(f.get("destinations") || "").split(",").map((s) => s.trim()).filter(Boolean),
  budget: { amount: Number(f.get("budget")) || 0, currency: String(f.get("currency") || "USD").toUpperCase() },
  source: f.get("source"), tags: String(f.get("tags") || "").split(",").map((s) => s.trim()).filter(Boolean), request: f.get("request"),
});

// ---------- one case ----------

async function patch(body, msg) {
  try {
    current = (await api("PATCH", `studio/cases/${current.id}`, { baseRevision: current.revision, ...body })).case;
    if (msg) toast(msg);
  } catch (e) {
    if (e.status === 409 && e.body?.case) { current = e.body.case; toast("Someone else changed this case. You're looking at the latest now; make your change again.", true); }
    else toast(e.message, true);
  }
  await refreshList();
  renderList();
  renderCase();
}

function renderCase() {
  const c = current;
  const stages = me.pipeline.filter((s) => s.id !== "cancelled");
  const at = stages.findIndex((s) => s.id === c.status);
  const appState = !c.customer.email
    ? `<span class="app-chip warn">No email yet: add one to share itineraries</span>`
    : c.customerAccount.signedIn
      ? `<span class="app-chip ok" title="Last signed in ${esc(when(c.customerAccount.lastSignIn))}">● Uses the app</span>`
      : `<span class="app-chip">Not signed in yet: shared trips appear once they sign in with ${esc(c.customer.email)}</span>`;
  $("#detail").innerHTML = `<article class="case" data-id="${c.id}">
    <a class="back" href="#/">← Cases</a>
    <header class="case-head">
      <div>
        <p class="ref num">${esc(c.ref)} · opened ${esc(ago(c.createdAt))}${c.createdBy ? ` by ${esc(staffName(c.createdBy))}` : ""}</p>
        <h2>${esc(c.customer.name || c.customer.email)}</h2>
        <p class="contact">${c.customer.email ? `<a href="mailto:${esc(c.customer.email)}">${esc(c.customer.email)}</a>` : ""}${c.customer.phone ? ` · <a href="tel:${esc(c.customer.phone.replace(/\s/g, ""))}">${esc(c.customer.phone)}</a>` : ""} ${appState}</p>
      </div>
      <div class="handling">
        <label class="field">Planner<select id="c-assignee"><option value="">Unassigned</option>${staff.map((s) => `<option value="${esc(s.email)}">${esc(s.name || s.email)}</option>`).join("")}</select></label>
        <label class="field">Priority<select id="c-priority">${me.priorities.map((p) => `<option>${p}</option>`).join("")}</select></label>
      </div>
    </header>

    <ol class="pipeline${c.status === "cancelled" ? " cancelled" : ""}" aria-label="Stage">
      ${stages.map((s, i) => `<li><button type="button" data-status="${s.id}" class="${i < at ? "past" : i === at ? "here" : ""}" aria-current="${i === at ? "step" : "false"}">${esc(s.label)}</button></li>`).join("")}
    </ol>
    <p class="pipe-extra">${c.status === "cancelled"
      ? `<b class="pill s-cancelled">Cancelled</b> <button class="btn small" data-status="new" type="button">Reopen</button>`
      : `<button class="btn small ghost" data-status="cancelled" type="button">Cancel case</button>`}${isAdmin() ? ` <button class="btn small ghost danger" id="c-delete" type="button">Delete…</button><button class="btn small danger" id="c-delete2" type="button" hidden>Delete ${esc(c.ref)} for good</button>` : ""}</p>

    <div class="case-grid">
      <div class="col-main">
        <section class="box">
          <div class="box-head"><h3>Itineraries</h3><button class="btn small primary" id="it-new" type="button">+ New itinerary</button></div>
          ${c.itineraries.length ? `<ul class="its">${c.itineraries.map(itineraryCard).join("")}</ul>`
            : `<p class="muted">Build the trip here: start from a template, one of the published trips, or a file. Share it and it appears in ${esc(c.customer.name || "the customer")}'s Mission Timeline app, under <b>From ${esc(me.studio.name)}</b>.</p>`}
        </section>
        <section class="box">
          <details class="trip-sum" ${c.trip.request || c.trip.destinations.length ? "" : "open"}>
            <summary><h3>Trip</h3><span class="muted">${esc([c.trip.destinations.join(", "), span(c.trip.start, c.trip.end), c.trip.travellers ? `${c.trip.travellers} travellers` : "", money(c.trip.budget)].filter(Boolean).join(" · "))}</span></summary>
            <form id="trip-form">${tripFields(c.trip)}<div class="row-actions"><button class="btn primary small" type="submit" disabled>Save trip</button></div></form>
          </details>
          ${c.trip.request ? `<blockquote class="request">${esc(c.trip.request)}</blockquote>` : ""}
          ${c.trip.tags.length ? `<p class="tags">${c.trip.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}${c.trip.source ? ` <span class="muted">via ${esc(c.trip.source)}</span>` : ""}</p>` : ""}
        </section>
        <section class="box">
          <details><summary><h3>Customer details</h3></summary>
            <form id="cust-form"><div class="grid3">
              <label class="field">Name<input name="name" maxlength="120" value="${esc(c.customer.name)}"></label>
              <label class="field">Email<input name="email" type="email" maxlength="254" value="${esc(c.customer.email)}"></label>
              <label class="field">Phone<input name="phone" maxlength="40" value="${esc(c.customer.phone)}"></label>
            </div>
            <p class="muted small">Changing the email moves shared itineraries to that person's app.</p>
            <div class="row-actions"><button class="btn primary small" type="submit" disabled>Save customer</button></div></form>
          </details>
        </section>
      </div>
      <aside class="col-side">
        <section class="box">
          <h3>Notes <small class="muted">internal, never shown to the customer</small></h3>
          <form id="note-form" class="note-form"><textarea name="text" maxlength="4000" placeholder="Called Aiko: prefers ryokan over hotels…" aria-label="New note"></textarea><button class="btn small primary" type="submit">Add note</button></form>
          <ul class="notes">${c.notes.slice().reverse().map((n) => `<li><p>${esc(n.text)}</p><small class="muted">${esc(staffName(n.by))} · ${esc(when(n.at))}</small></li>`).join("") || `<li class="muted">No notes yet.</li>`}</ul>
        </section>
        <section class="box">
          <h3>History</h3>
          <ol class="history">${c.history.slice().reverse().map((h) => `<li class="h-${esc(h.type)}"><span>${esc(h.text)}</span><small class="muted">${h.by === "customer" ? `${esc(c.customer.name || "Customer")} in the app` : esc(staffName(h.by))} · ${esc(when(h.at))}</small></li>`).join("")}</ol>
        </section>
      </aside>
    </div>
  </article>`;

  const pipe = $(".pipeline", $("#detail")), here = $(".pipeline .here", $("#detail"));
  if (pipe && here && pipe.scrollWidth > pipe.clientWidth) pipe.scrollLeft = here.offsetLeft - (pipe.clientWidth - here.offsetWidth) / 2;
  $("#c-assignee").value = c.assignee;
  $("#c-priority").value = c.priority;
  $("#c-assignee").onchange = (e) => patch({ assignee: e.target.value }, e.target.value ? `Assigned to ${staffName(e.target.value)}` : "Unassigned");
  $("#c-priority").onchange = (e) => patch({ priority: e.target.value }, `Priority: ${e.target.value}`);
  $$("[data-status]", $("#detail")).forEach((b) => (b.onclick = () => b.dataset.status !== c.status && patch({ status: b.dataset.status }, `Moved to ${stageLabel(b.dataset.status)}`)));
  const del = $("#c-delete");
  if (del) {
    del.onclick = () => { del.hidden = true; $("#c-delete2").hidden = false; };
    $("#c-delete2").onclick = async () => {
      try { await api("DELETE", `studio/cases/${c.id}`); toast(`Deleted ${c.ref}`); location.hash = "#/"; } catch (e) { toast(e.message, true); }
    };
  }

  dirtyForm($("#trip-form"), (f) => patch({ trip: tripFrom(f) }, "Trip saved"));
  dirtyForm($("#cust-form"), (f) => patch({ customer: { name: f.get("name"), email: f.get("email"), phone: f.get("phone") } }, "Customer saved"));
  $("#note-form").onsubmit = async (e) => {
    e.preventDefault();
    const text = new FormData(e.target).get("text").trim();
    if (!text) return;
    try { current = (await api("POST", `studio/cases/${c.id}/notes`, { text })).case; renderCase(); toast("Note added"); } catch (err) { toast(err.message, true); }
  };

  $("#it-new").onclick = () => editItinerary(null);
  $$(".history li.h-progress", $("#detail")).forEach((li) => (li.onclick = () => li.classList.toggle("full")));
  $$("[data-it]", $("#detail")).forEach((b) => (b.onclick = () => itineraryAction(b.dataset.act, b.dataset.it, b)));
}

function dirtyForm(form, onSave) {
  const btn = $("button[type=submit]", form);
  form.oninput = () => (btn.disabled = false);
  form.onsubmit = (e) => { e.preventDefault(); btn.disabled = true; onSave(new FormData(form)); };
}

function itineraryCard(it) {
  const m = it.live;
  const s = summarize(m);
  const main = m.blocks.filter((b) => !b.branch);
  const k = tally(main);
  const marked = k.done + k.changed + k.skipped;
  const range = s.start ? span(s.start.slice(0, 10), s.end.slice(0, 10)) : "No blocks yet";
  return `<li class="it${it.shared ? " shared" : ""}">
    <div class="it-top"><b>${esc(m.emoji)} ${esc(m.name)}</b>${it.shared ? `<span class="pill s-shared">Shared ${esc(ago(it.sharedAt))}</span>` : `<span class="pill">Draft</span>`}</div>
    <p class="muted it-meta">${esc(range)} · ${s.days} day${s.days === 1 ? "" : "s"}, ${s.blocks} block${s.blocks === 1 ? "" : "s"}${s.deadlines ? `, ${s.deadlines} hard deadline${s.deadlines === 1 ? "" : "s"}` : ""}${s.planB ? `, ${s.planB} Plan B` : ""}${m.tz ? ` · ${esc(m.tz)}` : ""}</p>
    ${it.shared ? `<div class="it-prog"><div class="bar"><i class="d" style="width:${pct(k.done, main.length)}%"></i><i class="c" style="width:${pct(k.changed, main.length)}%"></i><i class="s" style="width:${pct(k.skipped, main.length)}%"></i></div>
      <small class="muted">${marked ? `Customer marked ${k.done} done, ${k.changed} changed, ${k.skipped} skipped of ${main.length}` : "The customer hasn't marked anything yet"}${it.progress.at ? ` · ${esc(ago(it.progress.at))}` : ""}</small></div>` : ""}
    <div class="row-actions">
      <button class="btn small" type="button" data-act="edit" data-it="${esc(m.id)}">Edit</button>
      ${it.shared ? `<button class="btn small" type="button" data-act="unshare" data-it="${esc(m.id)}">Stop sharing</button>`
        : `<button class="btn small primary" type="button" data-act="share" data-it="${esc(m.id)}"${current.customer.email ? "" : ` disabled title="Add the customer's email first"`}>Share with ${esc(current.customer.name.split(" ")[0] || "customer")}</button>`}
      <button class="btn small" type="button" data-act="copy" data-it="${esc(m.id)}">Duplicate</button>
      <button class="btn small ghost danger" type="button" data-act="remove" data-it="${esc(m.id)}">Remove</button>
    </div>
  </li>`;
}
const pct = (n, of) => (of ? ((n / of) * 100).toFixed(1) : 0);

async function itineraryAction(act, mid, btn) {
  const c = current;
  const it = c.itineraries.find((x) => x.mission.id === mid);
  try {
    if (act === "edit") return editItinerary(it);
    if (act === "copy") return editItinerary(null, { ...it.mission, name: `${it.mission.name} (copy)`, id: undefined });
    if (act === "remove") {
      if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = it.shared ? "Remove from the customer's app too?" : "Remove for good?"; return; }
      current = (await api("DELETE", `studio/cases/${c.id}/itineraries/${mid}`)).case;
      toast("Itinerary removed");
    }
    if (act === "share" || act === "unshare") {
      current = (await api("POST", `studio/cases/${c.id}/itineraries/${mid}/share`, { shared: act === "share" })).case;
      toast(act === "share" ? `Shared with ${c.customer.email}` : "No longer shared");
    }
  } catch (e) { toast(e.message, true); }
  await refreshList(); renderList(); renderCase();
}

function editItinerary(it, seed = null) {
  openEditor({
    dialog: $("#editor"),
    mission: it?.mission || seed,
    live: it?.live || null,
    shared: !!it?.shared,
    customer: current.customer,
    trip: current.trip,
    others: current.itineraries.filter((x) => x !== it).map((x) => x.mission),
    base: new URL("../", location.href),
    onSave: async (mission) => {
      const r = it
        ? await api("PUT", `studio/cases/${current.id}/itineraries/${it.mission.id}`, { mission })
        : await api("POST", `studio/cases/${current.id}/itineraries`, { mission });
      current = r.case;
      toast(it?.shared ? "Saved. The customer's app shows the change." : "Itinerary saved");
      await refreshList(); renderList(); renderCase();
    },
  });
}

// ---------- staff ----------

async function renderStaff() {
  try { staff = (await api("GET", "studio/staff.json")).staff; } catch (e) { toast(e.message, true); }
  const admin = isAdmin();
  $("#app").innerHTML = `<section class="staff-page">
    <h1>Staff</h1>
    <p class="sub">Who can use this console. ${admin ? "Admins can add people, change roles and remove them." : "Ask an admin to make changes."} Planners work on cases; admins also manage staff and can delete cases.</p>
    <table class="staff">
      <thead><tr><th>Person</th><th>Role</th><th>Last signed in</th><th></th></tr></thead>
      <tbody>${staff.map((s) => `<tr data-email="${esc(s.email)}">
        <td><b>${esc(s.name || "Not signed in yet")}</b><br><small class="muted">${esc(s.email)}</small></td>
        <td>${admin && !s.locked && s.email !== me.email ? `<select data-role aria-label="Role for ${esc(s.email)}">${["planner", "admin"].map((r) => `<option${r === s.role ? " selected" : ""}>${r}</option>`).join("")}</select>` : esc(s.role)}${s.locked ? `<br><small class="muted">set in STUDIO_STAFF</small>` : ""}</td>
        <td class="muted">${s.lastSignIn ? esc(ago(s.lastSignIn)) : "Never"}</td>
        <td>${admin && !s.locked && s.email !== me.email ? `<button class="btn small ghost danger" data-remove type="button">Remove</button>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
    ${admin ? `<form class="add-staff" id="add-staff">
      <label class="field">Google account email<input name="email" type="email" required placeholder="name@studio.com"></label>
      <label class="field">Role<select name="role"><option>planner</option><option>admin</option></select></label>
      <button class="btn primary" type="submit">Add</button>
    </form>` : ""}
  </section>`;
  const put = async (email, role) => {
    try { staff = (await api("PUT", `studio/staff/${encodeURIComponent(email)}`, { role })).staff; toast(`${email} is a${role === "admin" ? "n" : ""} ${role}`); } catch (e) { toast(e.message, true); }
    renderStaff();
  };
  $$("[data-role]").forEach((s) => (s.onchange = () => put(s.closest("tr").dataset.email, s.value)));
  $$("[data-remove]").forEach((b) => (b.onclick = async () => {
    const email = b.closest("tr").dataset.email;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Remove access?"; return; }
    try { staff = (await api("DELETE", `studio/staff/${encodeURIComponent(email)}`)).staff; toast(`Removed ${email}`); } catch (e) { toast(e.message, true); }
    renderStaff();
  }));
  const f = $("#add-staff");
  if (f) f.onsubmit = (e) => { e.preventDefault(); const d = new FormData(f); put(String(d.get("email")).trim(), d.get("role")); };
}

start();
