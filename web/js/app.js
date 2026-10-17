/*
 * Mission Timeline web client. Missions are kept in this browser (localStorage). Every mission published
 * by the Mission Timeline API is added to the list the first time the app sees it. Time logic is the shared core the API uses.
 */
import {
  CATS, MO, TEMPLATES, WD, blockTimes, cleanBlock, cleanMission, countdown, dayLabel, dur, emojiOf, exportData,
  floatingNow, hhmm, importData, isoDate, pad, rid, sorted, liveState, timelineDays, toMin,
} from "../core/index.js";
import { listPublished, getMission } from "./api.js";
import { createSheet } from "./sheet.js";
import { createAccount } from "./account.js";

{
  const KEY = "mission-timeline:v1";
  const SEL_KEY = "mission-timeline:selected";
  const MODE_KEY = "mission-timeline:mode";
  /** Published mission ids this browser has already been offered, so a deleted one isn't added back. */
  const SEEN_KEY = "mission-timeline:published-seen";
  /** Deleted mission ids and when, so sync doesn't bring them back from another device. */
  const TOMB_KEY = "mission-timeline:tombstones";
  const readTombs = () => { try { return JSON.parse(localStorage.getItem(TOMB_KEY) || "{}"); } catch { return {}; } };
  const writeTombs = (t) => { try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch { /* not saved */ } };
  /** "Now" on a mission's wall clock: in its time zone if it has one, otherwise this browser's. */
  const nowFor = (m) => floatingNow(Date.now(), m?.tz || "");
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- storage ----------
  let canSave = true;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw).map(cleanMission) : [];
    } catch (e) {
      canSave = false;
      return [];
    }
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(missions));
      localStorage.setItem(SEL_KEY, selId || "");
      localStorage.setItem(MODE_KEY, editMode ? "edit" : "read");
    } catch (e) {
      canSave = false;
      setStatus("This browser won't let the page save. Export your missions before you close it.", true);
    }
  }

  // ---------- state ----------
  let missions = load();
  let selId = (() => { try { return localStorage.getItem(SEL_KEY); } catch (e) { return null; } })();
  // Read mode (the default) shows the plan without any controls; Edit mode adds them.
  let editMode = (() => { try { return localStorage.getItem(MODE_KEY) === "edit"; } catch (e) { return false; } })();
  let editing = null; // {blockId}
  let memoEditing = null; // date
  let panel = null; // "new" | null
  let published = []; // summaries of every mission the API publishes

  function setStatus(t, err) { const el = $("#status"); el.textContent = t || ""; el.classList.toggle("err", !!err); }
  const current = () => missions.find((m) => m.id === selId) || null;
  let scrolledFor = null; // the mission the timeline was last scrolled to "now" for
  function commit(m) {
    m.updatedAt = Date.now();
    const i = missions.findIndex((x) => x.id === m.id);
    if (i >= 0) missions[i] = m; else missions.push(m);
    persist(); render(); account.schedule();
  }
  function createMission(data) {
    const m = cleanMission({ ...data, id: rid(), createdAt: Date.now(), updatedAt: Date.now() });
    missions.push(m); selId = m.id; panel = null; editMode = true;
    persist(); render(); setStatus("Mission created."); account.schedule();
    return m;
  }
  const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); } };
  const writeSeen = (set) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set])); } catch { /* not saved */ } };

  /** Add published missions by id (skipping ones already here). Returns how many were added. */
  async function addPublished(ids, { select = false } = {}) {
    const fetched = await Promise.all(ids.map((id) => getMission(id).then(cleanMission).catch(() => null)));
    const fresh = fetched.filter((m) => m && !missions.some((x) => x.id === m.id));
    if (!fresh.length) return 0;
    missions.push(...fresh);
    if (select || !selId || !missions.some((x) => x.id === selId)) selId = fresh[0].id;
    panel = null;
    persist(); render(); account.schedule();
    return fresh.length;
  }

  /** Fetch the published list and add any mission this browser hasn't been offered before. */
  async function syncPublished() {
    published = await listPublished();
    const seen = readSeen();
    const isNew = published.filter((p) => !seen.has(p.id) && !missions.some((m) => m.id === p.id));
    published.forEach((p) => seen.add(p.id));
    writeSeen(seen);
    if (!isNew.length) { render(); return; }
    // Examples first, so a first visit opens on the example trip.
    isNew.sort((a, b) => b.example - a.example);
    const n = await addPublished(isNew.map((p) => p.id));
    if (n) setStatus(`${n} published mission${n === 1 ? "" : "s"} added. Pick one above.`);
  }
  function removeMission(id) {
    missions = missions.filter((m) => m.id !== id);
    writeTombs({ ...readTombs(), [id]: Date.now() });
    if (selId === id) selId = missions[0]?.id || null;
    persist(); render(); setStatus("Mission deleted."); account.schedule();
  }

  // ---------- account: sign in with Google, sync ----------
  const account = createAccount({
    local: {
      get: () => ({ missions, tombstones: readTombs() }),
      set: (list, tombstones) => {
        writeTombs(tombstones);
        if (JSON.stringify(list) === JSON.stringify(missions)) return;
        missions = list;
        if (!missions.some((m) => m.id === selId)) selId = missions[0]?.id || null;
        persist(); render();
      },
    },
    onChange: renderAccount,
  });

  function renderAccount(st) {
    const el = $("#account");
    if (!st.available) { el.hidden = true; return; }
    el.hidden = false;
    if (!st.account) {
      if (!el.querySelector("#gsi-btn")) {
        el.innerHTML = `<div id="gsi-btn"></div><span class="muted">Sign in to keep your missions in sync on every device.</span>`;
        account.renderButton($("#gsi-btn")).catch((e) => setStatus(e.message, true));
      }
      if (st.error) setStatus(st.error, true);
      return;
    }
    const a = st.account;
    const when = st.syncing ? "Syncing…" : st.error ? st.error : st.lastSynced ? `Synced ${ago(st.lastSynced)}` : "Not synced yet";
    el.innerHTML = `${a.picture ? `<img src="${esc(a.picture)}" alt="" width="28" height="28" referrerpolicy="no-referrer">` : ""}
      <span><b>${esc(a.name || a.email)}</b> <span class="muted">${esc(a.email)}</span><br><small class="${st.error ? "err" : "muted"}">${esc(when)}</small></span>
      <button class="btn small" id="sync-now" type="button"${st.syncing ? " disabled" : ""}>Sync now</button>
      <button class="btn small" id="sign-out" type="button">Sign out</button>`;
    $("#sync-now").onclick = () => account.syncNow();
    $("#sign-out").onclick = () => { account.signOut(); setStatus("Signed out. Your missions stay in this browser."); };
  }
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

  // ---------- render ----------
  function setMode(on) {
    editMode = on; editing = null; memoEditing = null; if (!on) panel = null;
    persist(); render(); setStatus(on ? "Edit mode: change blocks, notes and the mission." : "");
  }

  function render() {
    document.body.classList.toggle("reading", !editMode);
    $("#import-btn").hidden = !editMode && missions.length > 0; // a first visit can still import a backup
    renderChips();
    const main = $("#main");
    if (!missions.length || panel) { main.innerHTML = renderStart(!missions.length); bindStart(); return; }
    let m = current();
    if (!m) { selId = missions[0].id; m = missions[0]; }
    main.innerHTML = `<section class="live" id="live" aria-live="polite"></section>
      <ul class="legend">${Object.entries(CATS).map(([k, [n]]) => `<li><span class="sw" style="--c:var(--${k})"></span>${n}</li>`).join("")}
        <li><span class="sw" style="border:2px dashed var(--ink-2);background:none"></span>Estimated</li>
        <li><span class="sw" style="--c:var(--hard);transform:rotate(45deg) scale(.8)"></span>Hard deadline</li>
        <li><span class="sw" style="border:1.5px dashed var(--do);background:none"></span>Plan B</li></ul>
      <div id="timeline">${renderTimeline(m)}</div>
      ${editMode ? renderEditor(m) + renderMissionSettings(m) : ""}`;
    bindMission(m);
    tick();
    // Opening a mission (not every re-render) scrolls the timeline to what's happening now.
    if (scrolledFor !== m.id) {
      scrolledFor = m.id;
      requestAnimationFrame(() => scrollToNow(m, "auto"));
    }
  }

  function renderChips() {
    const el = $("#missions");
    el.innerHTML = missions.map((m) => `<button class="chip" data-id="${esc(m.id)}" aria-pressed="${m.id === selId && !panel}">${esc(m.emoji)} ${esc(m.name)}</button>`).join("") +
      (editMode ? `<button class="btn small primary" id="new-mission">+ New mission</button>` : "") +
      (missions.length ? `<button class="btn small mode" id="mode" aria-pressed="${editMode}">${editMode ? "✓ Done editing" : "✏️ Edit"}</button>` : "");
    el.querySelectorAll(".chip").forEach((b) => (b.onclick = () => { sheet.close(); selId = b.dataset.id; panel = null; editing = null; memoEditing = null; persist(); render(); }));
    const nm = $("#new-mission"); if (nm) nm.onclick = () => { panel = "new"; editing = null; render(); };
    const md = $("#mode"); if (md) md.onclick = () => setMode(!editMode);
  }

  function renderStart(first) {
    return `<section class="empty">
      <h2>${first ? "No missions yet" : "Start a new mission"}</h2>
      <p class="muted" style="margin:0;max-width:60ch">${first ? "A mission is anything with a date and a goal: a hike, an interview, a training week, a date. " : ""}Start from a template or build it yourself.</p>
      <div class="tpls">${published.filter((x) => !missions.some((m) => m.id === x.id)).map((x) => `<button class="tpl" data-published="${esc(x.id)}"><b>${esc(x.emoji)} ${x.example ? "Example: " : ""}${esc(x.name)}</b><span>${esc(x.goal)}</span></button>`).join("")}${Object.entries(TEMPLATES).map(([k, t]) => `<button class="tpl" data-tpl="${k}"><b>${t.emoji} ${esc(t.label)}</b><span>${esc(t.blurb)}</span></button>`).join("")}</div>
      <div class="panel">
        <h2>Build it yourself</h2>
        <div class="grid">
          <label class="field" for="nm-name">Mission name<input id="nm-name" maxlength="80" placeholder="Lantau Peak sunrise"></label>
          <label class="field" for="nm-emoji">Emoji<input id="nm-emoji" maxlength="4" value="🎯"></label>
          <label class="field wide" for="nm-goal">Goal<input id="nm-goal" maxlength="300" placeholder="Summit before sunrise and get down safely."></label>
        </div>
        <div class="row-actions"><button class="btn primary" id="nm-go">Create mission</button>${first ? "" : `<button class="btn" id="nm-cancel">Cancel</button>`}</div>
      </div>
    </section>`;
  }
  function bindStart() {
    document.querySelectorAll(".tpl[data-tpl]").forEach((b) => (b.onclick = () => createMission(TEMPLATES[b.dataset.tpl].build(floatingNow()))));
    document.querySelectorAll(".tpl[data-published]").forEach((b) => (b.onclick = () => addPublished([b.dataset.published], { select: true }).then((n) => n && setStatus("Mission added."))));
    $("#nm-go").onclick = () => {
      const name = $("#nm-name").value.trim();
      if (!name) { $("#nm-name").focus(); setStatus("Give the mission a name.", true); return; }
      createMission({ name, emoji: $("#nm-emoji").value.trim() || "🎯", goal: $("#nm-goal").value.trim(), blocks: [] });
    };
    const c = $("#nm-cancel"); if (c) c.onclick = () => { panel = null; render(); };
  }

  function rowHTML(b) {
    const [t0, t1] = blockTimes(b);
    const em = emojiOf(b);
    const tags = (b.fixed ? "" : '<span class="tag">Estimated</span>') + (b.opt && !b.branch ? '<span class="tag">Optional</span>' : "") +
      (b.status ? `<span class="tag ${b.status}">${b.status[0].toUpperCase() + b.status.slice(1)}</span>` : "");
    const st = (s) => `<button class="btn" data-act="${s}" data-id="${esc(b.id)}" aria-pressed="${b.status === s}">${s === "done" ? "✓ Done" : s === "changed" ? "~ Changed" : "✕ Skipped"}</button>`;
    const nextDay = t1 > t0 && isoDate(t1) !== isoDate(t0);
    return `<li class="row b${b.fixed ? "" : " est"}${b.status === "skipped" ? " skipped" : ""}" data-id="${esc(b.id)}" data-t0="${t0}" data-t1="${t1}" style="--c:var(--${b.cat})">
      <div class="tm num">${esc(b.s)}<small>${dur(Math.round((t1 - t0) / 60000))}</small></div><div class="rail"><div class="seg"></div></div>
      <div class="card"><div class="t"><span class="em" aria-hidden="true">${esc(em)}</span><button type="button" class="open" data-open="${esc(b.id)}" aria-haspopup="dialog">${esc(b.title)}</button><span class="tag now" hidden>Now</span>${tags}</div>
        <div class="m num">${CATS[b.cat][0]}, ${esc(b.s)} to ${esc(b.e)}${nextDay ? " (next day)" : ""}</div>
        ${b.note ? `<div class="n">${esc(b.note)}</div>` : ""}
        ${editMode ? `<div class="acts">${st("done")}${st("changed")}${st("skipped")}<button class="btn" data-act="edit" data-id="${esc(b.id)}">Edit</button></div>` : ""}</div></li>`;
  }

  function renderTimeline(m) {
    if (!m.blocks.length) return `<p class="muted" style="margin-top:18px">${editMode ? "No blocks yet. Add the first one below: start with the hard deadline, then work backwards." : "No blocks yet. Switch to Edit to add the first one."}</p>`;
    return timelineDays(m).map(({ date, label, memo, blocks: nMain, deadlines: nDl, items }) => {
      const memoHTML = !editMode ? (memo ? `<p class="memo">${esc(memo)}</p>` : "")
        : memoEditing === date
        ? `<div class="memo-edit"><label class="field" for="memo-in">What happened on this day<textarea id="memo-in" maxlength="600">${esc(memo)}</textarea></label>
            <div class="row-actions"><button class="btn primary small" id="memo-save" data-date="${date}">Save note</button><button class="btn small" id="memo-cancel">Cancel</button></div></div>`
        : memo ? `<p class="memo">${esc(memo)}</p><button class="btn small" data-memo="${date}">Edit note</button>`
        : `<button class="btn small" data-memo="${date}" style="margin-top:8px">Write what happened</button>`;
      return `<section class="day"><div class="dayhead"><h3>${esc(label)}</h3><small>${nMain} block${nMain === 1 ? "" : "s"}${nDl ? `, <span style="color:var(--hard)">${nDl} deadline${nDl > 1 ? "s" : ""}</span>` : ""}</small></div>
        ${memoHTML}
        <ol class="rows">${items.map((it) => it.type === "deadline"
          ? `<li class="row dl" data-id="${esc(it.block.id)}" data-t="${blockTimes(it.block)[0]}"><div class="tm num">${esc(it.block.s)}</div><div class="rail"><span></span></div><div class="card"><button type="button" class="open" data-open="${esc(it.block.id)}" aria-haspopup="dialog">${esc(it.block.title)}</button></div></li>`
          : it.type === "planB" ? `<li class="branchgrp"><div class="bh">🔀 Plan B · ${esc(it.label)}</div><ol>${it.blocks.map(rowHTML).join("")}</ol></li>`
          : rowHTML(it.block)).join("")}</ol></section>`;
    }).join("");
  }

  function renderEditor(m) {
    const b = editing && editing.blockId ? m.blocks.find((x) => x.id === editing.blockId) : null;
    const last = sorted(m).filter((x) => !x.branch).pop();
    const d = b || { date: last ? last.date : isoDate(nowFor(m)), s: last ? last.e : "09:00", e: "", cat: "do", title: "", note: "", em: "", fixed: false, opt: false, dl: false, branch: "" };
    if (!b) { const s = toMin(d.s) ?? 540; const e = (s + 60) % 1440; d.e = `${pad(Math.floor(e / 60))}:${pad(e % 60)}`; }
    return `<section class="panel" id="editor"><h2>${b ? "Edit block" : "Add a block"}</h2>
      <div class="grid">
        <label class="field wide" for="ed-title">Title<input id="ed-title" maxlength="120" value="${esc(d.title)}" placeholder="Mock interview out loud"></label>
        <label class="field" for="ed-date">Date<input id="ed-date" type="date" value="${esc(d.date)}"></label>
        <label class="field" for="ed-s">Start<input id="ed-s" type="time" value="${esc(d.s)}"></label>
        <label class="field" for="ed-e">End<input id="ed-e" type="time" value="${esc(d.e)}"></label>
        <label class="field" for="ed-cat">Type<select id="ed-cat">${Object.entries(CATS).map(([k, [n, e]]) => `<option value="${k}"${k === d.cat ? " selected" : ""}>${e} ${n}</option>`).join("")}</select></label>
        <label class="field" for="ed-em">Emoji (optional)<input id="ed-em" maxlength="4" value="${esc(d.em)}"></label>
        <label class="field wide" for="ed-note">Note<textarea id="ed-note" maxlength="600">${esc(d.note)}</textarea></label>
        <label class="field wide" for="ed-branch">Plan B label (leave empty for the main plan)<input id="ed-branch" maxlength="80" value="${esc(d.branch)}" placeholder="If it rains"></label>
      </div>
      <div class="checks" style="margin-top:10px">
        <label for="ed-fixed"><input type="checkbox" id="ed-fixed"${d.fixed ? " checked" : ""}> Fixed time</label>
        <label for="ed-dl"><input type="checkbox" id="ed-dl"${d.dl ? " checked" : ""}> Hard deadline</label>
        <label for="ed-opt"><input type="checkbox" id="ed-opt"${d.opt ? " checked" : ""}> Optional</label>
      </div>
      <div class="row-actions"><button class="btn primary" id="ed-save">${b ? "Save block" : "Add block"}</button>
        ${b ? `<button class="btn" id="ed-cancel">Cancel</button><button class="btn danger" id="ed-del">Delete block</button>` : ""}</div></section>`;
  }

  function renderMissionSettings(m) {
    return `<section class="panel"><h2>Mission</h2>
      <div class="grid">
        <label class="field" for="ms-name">Name<input id="ms-name" maxlength="80" value="${esc(m.name)}"></label>
        <label class="field" for="ms-emoji">Emoji<input id="ms-emoji" maxlength="4" value="${esc(m.emoji)}"></label>
        <label class="field wide" for="ms-goal">Goal<input id="ms-goal" maxlength="300" value="${esc(m.goal)}"></label>
        <label class="field wide" for="ms-hl">Highlight, after it's done<textarea id="ms-hl" maxlength="400" placeholder="The moment you'll remember.">${esc(m.highlight)}</textarea></label>
      </div>
      <div class="row-actions"><button class="btn primary" id="ms-save">Save mission</button><button class="btn danger" id="ms-del">Delete mission</button><button class="btn danger" id="ms-del2" hidden>Yes, delete it for good</button></div></section>`;
  }

  function bindMission(m) {
    document.querySelectorAll("[data-act]").forEach((btn) => (btn.onclick = () => {
      const b = m.blocks.find((x) => x.id === btn.dataset.id); if (!b) return;
      if (btn.dataset.act === "edit") { editing = { blockId: b.id }; render(); $("#editor").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      b.status = b.status === btn.dataset.act ? "" : btn.dataset.act;
      commit(m);
    }));
    document.querySelectorAll("[data-memo]").forEach((btn) => (btn.onclick = () => { memoEditing = btn.dataset.memo; render(); $("#memo-in")?.focus(); }));
    const ms = $("#memo-save");
    if (ms) ms.onclick = () => { const v = $("#memo-in").value.trim(); if (v) m.memos[ms.dataset.date] = v; else delete m.memos[ms.dataset.date]; memoEditing = null; commit(m); };
    const mc = $("#memo-cancel"); if (mc) mc.onclick = () => { memoEditing = null; render(); };

    if (!editMode) return;
    $("#ed-save").onclick = () => {
      const title = $("#ed-title").value.trim(), date = $("#ed-date").value, s = $("#ed-s").value, e = $("#ed-e").value;
      if (!title || !date || toMin(s) === null || toMin(e) === null) { setStatus("A block needs a title, a date, a start and an end.", true); return; }
      const prev = m.blocks.find((x) => x.id === (editing && editing.blockId));
      const data = cleanBlock({
        id: prev ? prev.id : rid(), date, s, e, cat: $("#ed-cat").value, title, note: $("#ed-note").value.trim(), em: $("#ed-em").value.trim(),
        fixed: $("#ed-fixed").checked, dl: $("#ed-dl").checked, opt: $("#ed-opt").checked, branch: $("#ed-branch").value.trim(), status: prev ? prev.status : "",
      });
      const i = m.blocks.findIndex((x) => x.id === data.id);
      if (i >= 0) m.blocks[i] = data; else m.blocks.push(data);
      editing = null; commit(m); setStatus(prev ? "Block saved." : "Block added.");
    };
    const ec = $("#ed-cancel"); if (ec) ec.onclick = () => { editing = null; render(); };
    const ed = $("#ed-del"); if (ed) ed.onclick = () => { m.blocks = m.blocks.filter((x) => x.id !== editing.blockId); editing = null; commit(m); setStatus("Block deleted."); };

    $("#ms-save").onclick = () => {
      m.name = $("#ms-name").value.trim() || m.name; m.emoji = $("#ms-emoji").value.trim() || m.emoji;
      m.goal = $("#ms-goal").value.trim(); m.highlight = $("#ms-hl").value.trim(); m.example = false;
      commit(m); setStatus("Mission saved.");
    };
    $("#ms-del").onclick = () => { $("#ms-del").hidden = true; $("#ms-del2").hidden = false; };
    $("#ms-del2").onclick = () => removeMission(m.id);
  }

  // ---------- scroll to now ----------
  /** The block to show for "now": the current block, or the next one if nothing is running. Null before or after the mission. */
  function nowBlock(m) {
    const st = liveState(m, nowFor(m));
    return st.phase === "during" ? st.current || st.next : null;
  }

  /** Scroll the timeline so the current (or next) block is in the middle of the screen. */
  function scrollToNow(m, behavior = "smooth") {
    const b = m && nowBlock(m);
    const row = b && document.querySelector(`.row.b[data-id="${CSS.escape(b.id)}"]`);
    if (!row) return false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "center", behavior: reduce ? "auto" : behavior });
    row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
    return true;
  }

  // ---------- live panel ----------
  function tick() {
    const live = $("#live"); if (!live) return;
    const m = current(); if (!m) return;
    const t = nowFor(m), now = new Date(t); // floating: read it with the UTC getters
    const st = liveState(m, t);
    const head = `<div class="live-top"><div><p class="mtitle">${esc(m.emoji)} ${esc(m.name)}</p>${m.goal ? `<p class="mgoal">${esc(m.goal)}</p>` : ""}</div>
      <div class="clock num">${hhmm(t)}:${pad(now.getUTCSeconds())} <span class="muted" style="font-family:var(--sans);font-weight:400;font-size:13px">${WD[now.getUTCDay()]} ${now.getUTCDate()} ${MO[now.getUTCMonth()]}${m.tz ? ` · ${esc(m.tz.split("/").pop().replace(/_/g, " "))} time` : ""}</span></div></div>`;
    const card = (lab, b, hard) => `<div class="nx${hard ? " hard" : ""}" style="${hard ? "" : `--c:var(--${b.cat})`}"><div class="t">${lab}</div><b>${esc(emojiOf(b))} ${esc(b.title)}</b>
      <div class="t num">${b.date !== isoDate(now) ? esc(dayLabel(b.date)) + ", " : ""}${esc(b.s)}</div><div class="cd num">in ${countdown(blockTimes(b)[0] - t)}</div></div>`;
    const big = (ms) => countdown(ms).replace(/(\d+)([dhms])/g, "$1<span>$2</span>");
    let body = "";
    if (st.phase === "empty") {
      body = `<p class="muted" style="margin:0">Add blocks below and this panel will tell you what to do now, what's next, and how long until the next hard deadline.</p>`;
    } else if (st.phase === "before") {
      body = `<p class="lbl">Mission starts in</p><div class="big num">${big(st.start - t)}</div>
        <p class="muted" style="margin:0">First up: ${esc(st.first.title)}, ${esc(dayLabel(st.first.date))} at ${esc(st.first.s)}.</p>` +
        (st.nextDeadline ? `<div class="nexts">${card("First hard deadline", st.nextDeadline, true)}</div>` : "");
    } else if (st.phase === "after") {
      const k = st.tally;
      body = `<p class="lbl">Debrief</p><p class="nowtitle">${m.highlight ? esc(m.highlight) : "Mission over. How did it go?"}</p>
        <div class="debrief num"><div><b>${k.done}</b><span>Done</span></div><div><b>${k.changed}</b><span>Changed</span></div><div><b>${k.skipped}</b><span>Skipped</span></div><div><b>${k.unmarked}</b><span>Not marked yet</span></div></div>
        ${editMode ? `<p class="muted" style="margin:0;font-size:14px">Mark each block below, write a note on each day, and add the highlight in the Mission section.</p>` : ""}`;
    } else {
      const c = st.current;
      if (c) {
        const [a, z] = blockTimes(c);
        body = `<p class="lbl">Now, ${CATS[c.cat][0].toLowerCase()}</p><p class="nowtitle">${esc(emojiOf(c))} ${esc(c.title)}</p>${c.note ? `<p style="margin:0 0 6px;max-width:62ch">${esc(c.note)}</p>` : ""}
          <div class="prog" style="--c:var(--${c.cat})"><i style="width:${(((t - a) / (z - a)) * 100).toFixed(1)}%"></i></div>
          <div class="progtxt num"><span>Started ${countdown(t - a)} ago</span><span>${countdown(z - t)} left</span></div>`;
      } else {
        body = `<p class="lbl">Now</p><p class="nowtitle">Free time</p><p class="muted" style="margin:0">Nothing planned until ${st.next ? esc(st.next.s) : "the end"}.</p>`;
      }
      body += `<button class="btn small jump-now" type="button" data-jump-now>↓ Show in timeline</button>`;
      if (st.planB.length) body += `<p class="planb-now">🔀 Plan B running now: <b>${st.planB.map((b) => esc(b.title)).join(", ")}</b> (${esc(st.planB[0].branch)})</p>`;
      body += `<div class="nexts">${st.next ? card("Next up", st.next, false) : ""}${st.nextDeadline ? card("Next hard deadline", st.nextDeadline, true) : ""}</div>`;
    }
    live.innerHTML = head + body;
    sheet.refresh(true);
    document.querySelectorAll(".row.b").forEach((r) => {
      const a = +r.dataset.t0, z = +r.dataset.t1, on = a <= t && t < z;
      r.classList.toggle("cur", on); r.classList.toggle("past", z <= t);
      const n = r.querySelector(".tag.now"); if (n) n.hidden = !on;
    });
    document.querySelectorAll(".row.dl").forEach((r) => r.classList.toggle("past", +r.dataset.t <= t));
  }

  // ---------- export / import ----------
  $("#export").onclick = () => {
    const blob = new Blob([exportData(missions)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `missions-${isoDate(floatingNow())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus(`Exported ${missions.length} mission${missions.length === 1 ? "" : "s"}.`);
  };
  $("#import").onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    try {
      const incoming = importData(await file.text());
      const ids = new Set(missions.map((m) => m.id));
      let added = 0, updated = 0;
      incoming.forEach((m) => { m.updatedAt = Date.now(); if (ids.has(m.id)) { missions[missions.findIndex((x) => x.id === m.id)] = m; updated++; } else { missions.push(m); added++; } });
      account.schedule();
      if (!selId && missions.length) selId = missions[0].id;
      panel = null; persist(); render();
      setStatus(`Imported ${added} new mission${added === 1 ? "" : "s"}${updated ? ` and updated ${updated}` : ""}.`);
    } catch (err) {
      setStatus(err.message, true);
    }
  };

  // ---------- block details ----------
  // Tap a block (anywhere on its row except its own buttons) to open its details.
  const sheet = createSheet({
    mission: current,
    now: nowFor,
    editMode: () => editMode,
    onStatus: (m, id, st) => { const b = m.blocks.find((x) => x.id === id); if (b) { b.status = b.status === st ? "" : st; commit(m); } },
    onEdit: (id) => { editing = { blockId: id }; render(); $("#editor")?.scrollIntoView({ behavior: "smooth", block: "start" }); },
    onSwitchPlanB: (m, d) => {
      d.replaces.forEach((r) => { const b = m.blocks.find((x) => x.id === r.id); if (b) b.status = "changed"; });
      commit(m);
      setStatus(`Switched to Plan B: ${d.block.title}.`);
    },
  });
  document.getElementById("main").addEventListener("click", (e) => {
    const row = e.target.closest(".row.b, .row.dl");
    if (!row || (e.target.closest("button, a, input, textarea, select") && !e.target.closest("[data-open]"))) return;
    sheet.open(row.dataset.id);
  });

  // ---------- boot ----------
  if (!canSave) setStatus("This browser won't let the page save. Export your missions before you close it.", true);
  render();
  setInterval(tick, 1000);
  // The live panel is redrawn every second, so its button is handled here.
  document.addEventListener("click", (e) => { if (e.target.closest("[data-jump-now]")) scrollToNow(current()); });

  syncPublished().catch(() => {}); // offline or opened as a file: your own missions and templates still work
  account.init();
}
