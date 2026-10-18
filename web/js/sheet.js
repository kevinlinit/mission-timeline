/*
 * The block details sheet: tap a block to see what matters for that kind of block, with one main action.
 * A side panel on wide screens, a bottom sheet on phones. The content comes from blockDetails() in the
 * shared core; this file only draws it.
 */
import { CATS, blockDetails, countdown, dur, hhmm, pad } from "../core/index.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CHECKS_KEY = "mission-timeline:checks";

const KIND_LABEL = { deadline: "Hard deadline", planB: "Plan B" };
const kindLabel = (d) => d.kind === "planB" ? `Plan B · ${d.block.branch}` : KIND_LABEL[d.kind] || CATS[d.kind][0];

/**
 * @param host  { mission(), now(m), editMode(), canEditBlocks(m), onStatus(m, id, status), onEdit(id), onSwitchPlanB(m, d) }
 */
export function createSheet(host) {
  const root = document.createElement("div");
  root.className = "sheet";
  root.hidden = true;
  root.innerHTML = `<div class="sheet-backdrop" data-sheet-close></div>
    <section class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"></section>`;
  document.body.appendChild(root);
  const panel = root.querySelector(".sheet-panel");
  let openId = null, returnFocus = null;

  function open(id) {
    const m = host.mission();
    const d = m && blockDetails(m, id, host.now(m));
    if (!d) return;
    if (!openId) returnFocus = document.activeElement;
    openId = id;
    draw(m, d);
    root.hidden = false;
    document.body.classList.add("sheet-open");
    panel.focus({ preventScroll: true });
    // A small buzz where supported (Android); iPhones use the app.
    navigator.vibrate?.(d.kind === "deadline" ? [0, 25] : 8);
  }

  function close() {
    if (!openId) return;
    openId = null;
    root.hidden = true;
    document.body.classList.remove("sheet-open");
    returnFocus?.focus?.({ preventScroll: true });
  }

  /** Redraw everything (after an action) or just the live part (every second). */
  function refresh(liveOnly = false) {
    if (!openId) return;
    const m = host.mission();
    const d = m && blockDetails(m, openId, host.now(m));
    if (!d) return close();
    if (liveOnly) { const el = panel.querySelector("[data-live]"); if (el) el.innerHTML = liveHTML(d); }
    else draw(m, d);
  }

  function draw(m, d) {
    const b = d.block;
    panel.style.setProperty("--c", `var(--${d.kind === "deadline" ? "hard" : b.cat})`);
    panel.dataset.kind = d.kind;
    panel.innerHTML = `
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head">
        <p class="sheet-kind">${esc(kindLabel(d))}</p>
        <h2 id="sheet-title"><span aria-hidden="true">${esc(b.emoji)}</span> ${esc(b.title)}</h2>
        <button class="sheet-x" type="button" data-sheet-close aria-label="Close">×</button>
      </header>
      <p class="sheet-when num">${esc(d.timing.day)}, ${esc(b.s)}–${esc(b.e)}${b.endsNextDay ? " (next day)" : ""} · ${dur(d.timing.minutes)}${b.fixed ? " · fixed time" : " · estimate"}</p>
      <div class="sheet-live" data-live aria-live="polite">${liveHTML(d)}</div>
      ${kindHTML(m, d)}
      ${actionsHTML(m, d)}
      <nav class="sheet-nav">
        ${d.prev ? `<button type="button" class="btn small" data-sheet-go="${esc(d.prev.id)}">← ${esc(d.prev.emoji)} ${esc(d.prev.title)}</button>` : "<span></span>"}
        ${d.next ? `<button type="button" class="btn small" data-sheet-go="${esc(d.next.id)}">${esc(d.next.emoji)} ${esc(d.next.title)} →</button>` : ""}
      </nav>`;
  }

  // ---------- pieces ----------

  function liveHTML(d) {
    const t = d.timing;
    if (t.phase === "now") {
      return `<p class="lbl">Now</p>
        <div class="prog"><i style="width:${(t.progress * 100).toFixed(1)}%"></i></div>
        <p class="progtxt num"><span>Started ${countdown(-t.startsInMs)} ago</span><span>${countdown(t.endsInMs)} left</span></p>`;
    }
    if (t.phase === "upcoming") {
      const big = d.kind === "deadline" || d.kind === "move";
      return `<p class="lbl">${d.kind === "move" ? "Leave in" : "Starts in"}</p><p class="${big ? "sheet-big" : "sheet-mid"} num">${countdown(t.startsInMs)}</p>`;
    }
    const st = d.block.status;
    return `<p class="lbl">Ended ${countdown(-t.endsInMs)} ago</p>${st ? `<p class="sheet-mid">${st === "done" ? "✓ Done" : st === "changed" ? "~ Changed" : "✕ Skipped"}</p>` : ""}`;
  }

  function line(label, value) { return `<div class="sheet-row"><dt>${label}</dt><dd>${value}</dd></div>`; }
  const at = (b) => `${esc(b.emoji)} ${esc(b.title)} <span class="muted num">${esc(b.s)}</span>`;
  function slack(d) {
    if (d.slackMs === null) return "";
    const min = Math.round(d.slackMs / 60000);
    return line("Slack", min > 0 ? `${dur(min)} before ${esc(d.next.title)}` : min === 0 ? `None: ${esc(d.next.title)} starts right after` : `Overlaps ${esc(d.next.title)} by ${dur(-min)}`);
  }

  function kindHTML(m, d) {
    const b = d.block, rows = [];
    switch (d.kind) {
      case "move":
        rows.push(line("Leave", `<span class="num">${esc(b.s)}</span>`), line("Arrive", `<span class="num">${esc(b.e)}</span>`));
        if (d.next) rows.push(line("Then", at(d.next)));
        break;
      case "rest":
        rows.push(line("Wake up", `<span class="num">${esc(b.e)}</span>`));
        if (d.next) rows.push(line("First up", at(d.next)));
        break;
      case "deadline":
        rows.push(`<p class="sheet-warn">No second chance. Plan to be early.</p>`);
        if (d.next) rows.push(line("Then", at(d.next)));
        break;
      case "planB":
        rows.push(line("Use it if", esc(b.branch)));
        if (d.replaces.length) rows.push(line("Instead of", d.replaces.map(at).join("<br>")));
        break;
      default: // do, fuel, admin, prep
        if (d.next) rows.push(line("Next", at(d.next)));
        rows.push(slack(d));
    }
    if (d.planB.length) rows.push(line("Plan B ready", d.planB.map((x) => `🔀 ${esc(x.title)} <span class="muted">(${esc(x.branch)})</span>`).join("<br>")));

    let body = "";
    if (d.checklist.length > 1 || (d.checklist.length === 1 && ["admin", "prep"].includes(b.cat))) {
      const done = readChecks(m.id, b.id);
      body = `<ul class="sheet-check">${d.checklist.map((s, i) => `<li><label><input type="checkbox" data-check="${i}"${done.includes(i) ? " checked" : ""}> ${esc(s)}</label></li>`).join("")}</ul>`;
    } else if (b.note) {
      body = `<p class="sheet-note">${esc(b.note)}</p>`;
    }
    return `${body}<dl class="sheet-rows">${rows.join("")}</dl>`;
  }

  function actionsHTML(m, d) {
    const b = d.block, out = [];
    if (d.place) {
      const q = encodeURIComponent(d.place.query);
      const href = d.place.directions ? `https://www.google.com/maps/dir/?api=1&destination=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
      out.push(`<a class="btn primary" href="${href}" target="_blank" rel="noopener">${d.place.directions ? "Directions to" : "Find"} ${esc(d.place.query)} ↗</a>`);
    }
    if (d.reminder) out.push(`<button type="button" class="btn" data-sheet-ics>⏰ Remind me ${d.reminder.minutesBefore} min before</button>`);
    if (host.editMode()) {
      if (d.kind === "planB" && d.replaces.some((x) => x.status !== "changed")) out.push(`<button type="button" class="btn" data-sheet-switch>🔀 Switch to Plan B</button>`);
      const st = (s, label) => `<button type="button" class="btn" data-sheet-status="${s}" aria-pressed="${b.status === s}">${label}</button>`;
      out.push(`<div class="sheet-status">${st("done", "✓ Done")}${st("changed", "~ Changed")}${st("skipped", "✕ Skipped")}${host.canEditBlocks?.(m) === false ? "" : `<button type="button" class="btn" data-sheet-edit>Edit</button>`}</div>`);
    }
    return out.length ? `<div class="sheet-actions">${out.join("")}</div>` : "";
  }

  // ---------- events ----------

  root.addEventListener("click", (e) => {
    const m = host.mission();
    if (e.target.closest("[data-sheet-close]")) return close();
    const go = e.target.closest("[data-sheet-go]"); if (go) return open(go.dataset.sheetGo);
    if (!m || !openId) return;
    const d = blockDetails(m, openId, host.now(m));
    if (e.target.closest("[data-sheet-ics]")) return downloadReminder(m, d);
    const st = e.target.closest("[data-sheet-status]"); if (st) { host.onStatus(m, openId, st.dataset.sheetStatus); return refresh(); }
    if (e.target.closest("[data-sheet-switch]")) { host.onSwitchPlanB(m, d); return refresh(); }
    if (e.target.closest("[data-sheet-edit]")) { const id = openId; close(); host.onEdit(id); }
  });
  root.addEventListener("change", (e) => {
    const box = e.target.closest("[data-check]");
    const m = host.mission();
    if (box && m) writeCheck(m.id, openId, Number(box.dataset.check), box.checked);
  });
  document.addEventListener("keydown", (e) => {
    if (!openId) return;
    if (e.key === "Escape") close();
    if (e.key === "Tab") { // keep focus inside the sheet
      const f = [...panel.querySelectorAll("button, a[href], input")].filter((x) => !x.disabled);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  });

  return { open, close, refresh, get openId() { return openId; } };
}

// ---------- checklist ticks (this browser only) ----------

function readAll() { try { return JSON.parse(localStorage.getItem(CHECKS_KEY) || "{}"); } catch { return {}; } }
function readChecks(missionId, blockId) { return readAll()[missionId]?.[blockId] || []; }
function writeCheck(missionId, blockId, i, on) {
  const all = readAll();
  const list = new Set(all[missionId]?.[blockId] || []);
  on ? list.add(i) : list.delete(i);
  all[missionId] = { ...(all[missionId] || {}), [blockId]: [...list] };
  try { localStorage.setItem(CHECKS_KEY, JSON.stringify(all)); } catch { /* not saved */ }
}

// ---------- calendar reminder (.ics) ----------

/** A calendar event for the block with an alert before it. Times are the mission's wall clock. */
export function reminderICS(m, d, stamp = new Date()) {
  const b = d.block;
  const local = (t) => { const x = new Date(t); return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T${hhmm(t).replace(":", "")}00`; };
  const zone = m.tz ? `;TZID=${m.tz}` : "";
  const text = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mission Timeline//EN", "BEGIN:VEVENT",
    `UID:${b.id}.${m.id}@mission-timeline`,
    `DTSTAMP:${stamp.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART${zone}:${local(d.timing.start)}`,
    `DTEND${zone}:${local(Math.max(d.timing.end, d.timing.start + 60000))}`,
    `SUMMARY:${text(`${b.emoji} ${b.title}`)}`,
    `DESCRIPTION:${text([m.name, b.note].filter(Boolean).join("\n"))}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(b.title)}`, `TRIGGER:-PT${d.reminder?.minutesBefore || 10}M`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

function downloadReminder(m, d) {
  const blob = new Blob([reminderICS(m, d)], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${d.block.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
