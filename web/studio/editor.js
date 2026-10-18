/*
 * The itinerary editor in the studio console: a full-screen dialog with the blocks on the left and the
 * timeline as the customer will see it on the right. New itineraries start from a blank page, a
 * template, a published trip, a mission-timeline/v1 file or another itinerary on the case.
 */
import {
  CATS, TEMPLATES, blockTimes, cleanBlock, cleanMission, dayLabel, floatingNow, importData, isDate, rid, timelineDays, toMin,
} from "../core/index.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DAY = 86400000;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const ZONES = ["", "Asia/Tokyo", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Seoul", "Asia/Taipei", "Asia/Singapore", "Asia/Bangkok", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];

/** Move every block (and day note) so the itinerary starts on `first`. */
export function shiftTo(m, first) {
  const dates = m.blocks.map((b) => b.date).sort();
  if (!dates.length || !isDate(first)) return m;
  const n = daysBetween(dates[0], first);
  return {
    ...m,
    blocks: m.blocks.map((b) => ({ ...b, date: addDays(b.date, n) })),
    memos: Object.fromEntries(Object.entries(m.memos || {}).map(([d, v]) => [addDays(d, n), v])),
  };
}

/**
 * @param dialog   the <dialog>
 * @param mission  the itinerary to edit, or null for a new one
 * @param live     the same mission with the customer's marks, to preview
 * @param others   other itineraries on the case, to copy from
 * @param base     the site root, for the published trips
 * @param onSave   async (mission) => void
 */
export function openEditor({ dialog, mission, live, shared, customer, trip, others = [], base, onSave }) {
  let m = mission ? cleanMission(structuredClone(mission)) : null;
  let dirty = false;
  let open = null; // the block whose details are expanded
  const marks = new Map((live?.blocks || []).map((b) => [b.id, b.status]));

  const close = () => { dialog.close(); dialog.innerHTML = ""; document.body.classList.remove("sheet-open"); };
  dialog.oncancel = (e) => { e.preventDefault(); tryClose(); };
  function tryClose() {
    const btn = $("#ed-close", dialog);
    if (!dirty || btn?.dataset.confirm === "1") return close();
    btn.dataset.confirm = "1";
    btn.textContent = "Discard changes?";
    btn.classList.add("danger");
  }

  if (!dialog.open) dialog.showModal();
  document.body.classList.add("sheet-open");
  m ? renderEdit() : renderChoose();

  // ---------- step 1: where to start ----------

  async function renderChoose() {
    dialog.innerHTML = `<div class="ed-shell">
      <header class="ed-bar"><h2 id="ed-heading">New itinerary for ${esc(customer.name || customer.email || "this case")}</h2><button class="btn" id="ed-close" type="button">Cancel</button></header>
      <div class="ed-choose">
        <p class="muted">Start from something close, then tailor it. ${trip.start ? `Dates move to start on <b>${esc(dayLabel(trip.start))}</b>, the trip's first day; you can change that in the editor.` : "Add the trip's dates on the case and new itineraries will start on them."}</p>
        <h3>Blank</h3>
        <div class="tpls"><button class="tpl" data-src="blank"><b>📄 Blank itinerary</b><span>Name it and add the blocks yourself.</span></button>
          <label class="tpl" for="ed-file"><b>📥 From a file</b><span>A mission-timeline/v1 export, from the app's Export.</span></label><input id="ed-file" type="file" accept="application/json,.json" hidden></div>
        ${others.length ? `<h3>Another itinerary on this case</h3><div class="tpls">${others.map((o, i) => `<button class="tpl" data-src="other" data-i="${i}"><b>${esc(o.emoji)} ${esc(o.name)}</b><span>${o.blocks.length} blocks</span></button>`).join("")}</div>` : ""}
        <h3>The studio's published trips</h3><div class="tpls" id="ed-published"><p class="muted">Loading…</p></div>
        <h3>Templates</h3><div class="tpls">${Object.entries(TEMPLATES).map(([k, t]) => `<button class="tpl" data-src="tpl" data-k="${k}"><b>${t.emoji} ${esc(t.label)}</b><span>${esc(t.blurb)}</span></button>`).join("")}</div>
        <p class="err" id="ed-err" role="alert"></p>
      </div></div>`;
    $("#ed-close", dialog).onclick = close;
    const begin = (src) => {
      m = cleanMission({ ...src, id: undefined, example: false, createdAt: Date.now(), updatedAt: Date.now() });
      m.blocks = m.blocks.map((b) => ({ ...b, status: "" }));
      if (trip.start && m.blocks.length) m = shiftTo(m, trip.start);
      dirty = true;
      renderEdit();
    };
    $$("[data-src]", dialog).forEach((b) => (b.onclick = () => {
      const s = b.dataset.src;
      if (s === "blank") begin({ name: trip.destinations.length ? `${trip.destinations.join(" & ")}` : "New itinerary", emoji: "🧭", blocks: [] });
      if (s === "other") begin({ ...others[+b.dataset.i], name: `${others[+b.dataset.i].name} (copy)` });
      if (s === "tpl") begin(TEMPLATES[b.dataset.k].build(trip.start ? Date.parse(`${trip.start}T09:00:00Z`) : floatingNow()));
    }));
    $("#ed-file", dialog).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const list = importData(await file.text());
        if (!list.length) throw new Error("That file has no missions in it.");
        begin(list[0]);
      } catch (err) { $("#ed-err", dialog).textContent = err.message; }
    };
    try {
      const { missions } = await fetch(new URL("api/v1/missions.json", base)).then((r) => r.json());
      const el = $("#ed-published", dialog);
      if (!el) return;
      el.innerHTML = missions.map((x) => `<button class="tpl" data-pub="${esc(x.id)}"><b>${esc(x.emoji)} ${esc(x.name)}</b><span>${x.days} days, ${x.blocks} blocks${x.goal ? ` · ${esc(x.goal)}` : ""}</span></button>`).join("") || `<p class="muted">None published.</p>`;
      $$("[data-pub]", el).forEach((b) => (b.onclick = async () => {
        const doc = await fetch(new URL(`api/v1/missions/${encodeURIComponent(b.dataset.pub)}.json`, base)).then((r) => r.json());
        begin(doc.missions?.[0] || doc.mission || doc);
      }));
    } catch {
      const el = $("#ed-published", dialog);
      if (el) el.innerHTML = `<p class="muted">Couldn't load the published trips.</p>`;
    }
  }

  // ---------- step 2: edit ----------

  function renderEdit() {
    const first = m.blocks.map((b) => b.date).sort()[0] || trip.start || "";
    dialog.innerHTML = `<div class="ed-shell">
      <header class="ed-bar">
        <h2 id="ed-heading">${mission ? "Edit itinerary" : "New itinerary"}${shared ? ` <span class="pill s-shared">Shared: saving updates ${esc(customer.name.split(" ")[0] || "the customer")}'s app</span>` : ""}</h2>
        <div class="ed-bar-actions"><button class="btn" id="ed-close" type="button">Cancel</button><button class="btn primary" id="ed-save" type="button">Save itinerary</button></div>
      </header>
      <div class="ed-body">
        <section class="ed-form" aria-label="Itinerary">
          <div class="grid ed-meta">
            <label class="field ed-name">Name<input id="em-name" maxlength="80" value="${esc(m.name)}"></label>
            <label class="field">Emoji<input id="em-emoji" maxlength="4" value="${esc(m.emoji)}"></label>
            <label class="field">Time zone<select id="em-tz">${[...new Set([m.tz, ...ZONES])].map((z) => `<option value="${esc(z)}"${z === m.tz ? " selected" : ""}>${z ? esc(z.replace(/_/g, " ")) : "Traveller's own"}</option>`).join("")}</select></label>
            <label class="field wide">Goal, in a line the customer will read<input id="em-goal" maxlength="300" value="${esc(m.goal)}" placeholder="Autumn colours in Kyoto at an easy pace."></label>
          </div>
          <div class="ed-shift"><label class="field">Starts on<input id="em-first" type="date" value="${esc(first)}"></label><button class="btn small" id="em-shift" type="button" disabled>Move all dates</button>
            <span class="muted small">${m.blocks.length} block${m.blocks.length === 1 ? "" : "s"}</span></div>
          <div id="ed-blocks"></div>
          <div class="row-actions"><button class="btn small" id="ed-add" type="button">+ Add block</button><button class="btn small" id="ed-add-day" type="button">+ Add a day</button></div>
          <p class="err" id="ed-err" role="alert"></p>
        </section>
        <section class="ed-preview" aria-label="Preview">
          <p class="lbl">What ${esc(customer.name.split(" ")[0] || "the customer")} sees${live ? ", with their marks" : ""}</p>
          <div id="ed-pv"></div>
        </section>
      </div></div>`;

    const meta = () => { m.name = $("#em-name", dialog).value; m.emoji = $("#em-emoji", dialog).value; m.goal = $("#em-goal", dialog).value; m.tz = $("#em-tz", dialog).value; touch(); };
    ["#em-name", "#em-emoji", "#em-goal"].forEach((s) => ($(s, dialog).oninput = meta));
    $("#em-tz", dialog).onchange = meta;
    $("#em-first", dialog).oninput = (e) => ($("#em-shift", dialog).disabled = !isDate(e.target.value) || e.target.value === first || !m.blocks.length);
    $("#em-shift", dialog).onclick = () => { m = shiftTo(m, $("#em-first", dialog).value); dirty = true; renderEdit(); };
    $("#ed-add", dialog).onclick = () => addBlock();
    $("#ed-add-day", dialog).onclick = () => {
      const last = m.blocks.map((b) => b.date).sort().at(-1);
      addBlock(last ? addDays(last, 1) : trip.start || null, "09:00");
    };
    $("#ed-close", dialog).onclick = tryClose;
    $("#ed-save", dialog).onclick = save;
    renderBlocks();
    renderPreview();
  }

  function touch() { dirty = true; schedulePreview(); }
  let pvTimer;
  function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, 150); }

  function sortedBlocks() {
    return m.blocks.map((b, i) => ({ b, i })).sort((x, y) => blockTimes(x.b)[0] - blockTimes(y.b)[0] || x.i - y.i).map((x) => x.b);
  }

  function renderBlocks() {
    const el = $("#ed-blocks", dialog);
    if (!m.blocks.length) { el.innerHTML = `<p class="muted ed-none">No blocks yet. Start with the fixed points (flights, check-ins, bookings), then fill the days around them.</p>`; return; }
    let day = "";
    el.innerHTML = sortedBlocks().map((b) => {
      const head = b.date !== day ? `<h4 class="ed-day">${esc(dayLabel((day = b.date)))}</h4>` : "";
      const mark = marks.get(b.id);
      return `${head}<div class="ed-b${b.branch ? " planb" : ""}${open === b.id ? " open" : ""}" data-id="${esc(b.id)}" style="--c:var(--${b.cat})">
        <div class="ed-line">
          <input class="ed-date" type="date" value="${esc(b.date)}" data-k="date" aria-label="Date">
          <input class="ed-time ed-s num" value="${esc(b.s)}" data-k="s" aria-label="Start" inputmode="numeric" maxlength="5" placeholder="09:00">
          <input class="ed-time ed-e num" value="${esc(b.e)}" data-k="e" aria-label="End" inputmode="numeric" maxlength="5" placeholder="10:00">
          <select class="ed-cat" data-k="cat" aria-label="Type">${Object.entries(CATS).map(([k, [n, e]]) => `<option value="${k}"${k === b.cat ? " selected" : ""}>${e} ${n}</option>`).join("")}</select>
          <input class="ed-title" value="${esc(b.title)}" data-k="title" maxlength="120" aria-label="Title">
          <button type="button" class="ico ico-dl${b.dl ? " on" : ""}" data-flag="dl" title="Hard deadline" aria-pressed="${b.dl}">⚠</button>
          <button type="button" class="ico ico-more" data-more title="More: note, fixed time, Plan B" aria-expanded="${open === b.id}">⋯</button>
          <button type="button" class="ico del ico-del" data-del title="Remove block">✕</button>
        </div>
        ${mark ? `<span class="tag ${mark}">${esc(mark)} by customer</span>` : ""}
        ${open === b.id ? `<div class="ed-more">
          <label class="field">Note for the customer<textarea data-k="note" maxlength="600" placeholder="Booking refs, what to bring, where to meet…">${esc(b.note)}</textarea></label>
          <div class="grid">
            <label class="field">Plan B label <small>(empty = main plan)</small><input data-k="branch" maxlength="80" value="${esc(b.branch)}" placeholder="If it rains"></label>
            <label class="field">Emoji<input data-k="em" maxlength="4" value="${esc(b.em)}"></label>
          </div>
          <div class="checks"><label><input type="checkbox" data-k="fixed"${b.fixed ? " checked" : ""}> Fixed time (booked, can't move)</label><label><input type="checkbox" data-k="opt"${b.opt ? " checked" : ""}> Optional</label></div>
        </div>` : b.note ? `<p class="ed-note muted">${esc(b.note)}</p>` : ""}
      </div>`;
    }).join("");

    $$(".ed-b", el).forEach((row) => {
      const b = m.blocks.find((x) => x.id === row.dataset.id);
      $$("[data-k]", row).forEach((inp) => {
        const k = inp.dataset.k;
        const set = () => {
          if (inp.classList.contains("ed-time")) {
            // 24-hour times, like the app: "930" or "9:30" become 09:30.
            const v = inp.value.trim().replace(/^(\d{1,2})(\d{2})$/, "$1:$2").replace(/^(\d):/, "0$1:");
            const ok = toMin(v) !== null && /^\d{2}:\d{2}$/.test(v);
            inp.classList.toggle("bad", !ok);
            if (!ok) return;
            b[k] = v;
            touch();
            return;
          }
          b[k] = inp.type === "checkbox" ? inp.checked : inp.value; if (k === "cat") row.style.setProperty("--c", `var(--${b.cat})`); touch(); };
        inp.oninput = set;
        // Moving a block in time re-sorts the list once you leave the field.
        if (["date", "s", "e", "cat", "branch"].includes(k)) inp.onchange = () => { set(); if (["date", "s", "branch"].includes(k) && !inp.classList.contains("bad")) renderBlocks(); };
      });
      $("[data-flag]", row).onclick = (e) => { b.dl = !b.dl; if (b.dl) b.fixed = true; e.currentTarget.classList.toggle("on", b.dl); e.currentTarget.setAttribute("aria-pressed", b.dl); touch(); };
      $("[data-more]", row).onclick = () => { open = open === b.id ? null : b.id; renderBlocks(); };
      $("[data-del]", row).onclick = (e) => {
        const btn = e.currentTarget;
        if (btn.dataset.confirm !== "1" && (b.note || marks.get(b.id))) { btn.dataset.confirm = "1"; btn.textContent = "Sure?"; btn.classList.add("confirm"); return; }
        m.blocks = m.blocks.filter((x) => x !== b);
        touch(); renderBlocks();
      };
    });
  }

  function addBlock(date = null, s = null) {
    const last = sortedBlocks().at(-1);
    const d = date || last?.date || trip.start || new Date().toISOString().slice(0, 10);
    const start = s || (last && last.date === d && toMin(last.e) !== null ? last.e : "09:00");
    const endMin = Math.min((toMin(start) ?? 540) + 60, 23 * 60 + 59);
    const b = cleanBlock({ id: rid(), date: d, s: start, e: `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`, cat: "do", title: "" });
    b.title = "";
    m.blocks.push(b);
    open = b.id;
    touch(); renderBlocks();
    const row = $(`.ed-b[data-id="${CSS.escape(b.id)}"] .ed-title`, dialog);
    row?.focus();
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function renderPreview() {
    const el = $("#ed-pv", dialog);
    if (!el) return;
    const view = cleanMission({ ...m, blocks: m.blocks.map((b) => ({ ...b, title: b.title || "Untitled", status: marks.get(b.id) || "" })) });
    if (!view.blocks.length) { el.innerHTML = `<p class="muted">The timeline appears here as you add blocks.</p>`; return; }
    const row = (b) => {
      const [t0, t1] = blockTimes(b);
      const min = Math.round((t1 - t0) / 60000);
      return `<li class="row b${b.fixed ? "" : " est"}${b.status === "skipped" ? " skipped" : ""}" style="--c:var(--${b.cat})"><div class="tm num">${esc(b.s)}<small>${min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`}</small></div><div class="rail"><div class="seg"></div></div>
        <div class="card"><div class="t"><span class="em" aria-hidden="true">${esc(b.emoji)}</span>${esc(b.title)}${b.fixed ? "" : '<span class="tag">Estimated</span>'}${b.status ? `<span class="tag ${b.status}">${b.status[0].toUpperCase() + b.status.slice(1)}</span>` : ""}</div>
        <div class="m num">${esc(b.category)}, ${esc(b.s)} to ${esc(b.e)}${b.endsNextDay ? " (next day)" : ""}</div>${b.note ? `<div class="n">${esc(b.note)}</div>` : ""}</div></li>`;
    };
    el.innerHTML = `<p class="pv-title">${esc(view.emoji)} <b>${esc(view.name)}</b></p>${view.goal ? `<p class="muted pv-goal">${esc(view.goal)}</p>` : ""}` +
      timelineDays(view).map((d) => `<section class="day"><div class="dayhead"><h3>${esc(d.label)}</h3><small>${d.blocks} block${d.blocks === 1 ? "" : "s"}${d.deadlines ? `, <span style="color:var(--hard)">${d.deadlines} deadline${d.deadlines > 1 ? "s" : ""}</span>` : ""}</small></div>
        ${d.memo ? `<p class="memo">${esc(d.memo)}</p>` : ""}
        <ol class="rows">${d.items.map((it) => it.type === "deadline"
          ? `<li class="row dl"><div class="tm num">${esc(it.block.s)}</div><div class="rail"><span></span></div><div class="card">${esc(it.block.title)}</div></li>`
          : it.type === "planB" ? `<li class="branchgrp"><div class="bh">🔀 Plan B · ${esc(it.label)}</div><ol>${it.blocks.map(row).join("")}</ol></li>`
          : row(it.block)).join("")}</ol></section>`).join("");
  }

  async function save() {
    const err = $("#ed-err", dialog);
    err.textContent = "";
    if (!m.name.trim()) { err.textContent = "Give the itinerary a name."; $("#em-name", dialog).focus(); return; }
    const untitled = m.blocks.find((b) => !b.title.trim());
    if (untitled) { open = untitled.id; renderBlocks(); err.textContent = "Every block needs a title."; $(`.ed-b[data-id="${CSS.escape(untitled.id)}"] .ed-title`, dialog)?.focus(); return; }
    const btn = $("#ed-save", dialog);
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await onSave(cleanMission({ ...m, blocks: sortedBlocks() }));
      close();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "Save itinerary";
    }
  }
}
