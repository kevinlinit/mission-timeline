/**
 * Dates and times.
 *
 * Mission times are wall-clock times ("09:00 on 2026-10-02"), not instants. Core code works in
 * *floating time*: milliseconds as if the wall clock were UTC. That makes every result the same on any
 * machine, whatever its time zone, and free of DST jumps. To compare with "now", convert the real
 * instant to the mission's wall clock with `floatingNow()`.
 */

export const DAY = 86400000;
export const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const pad = (n) => String(n).padStart(2, "0");

/** Floating ms -> "YYYY-MM-DD". */
export function isoDate(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Floating ms -> "HH:MM". */
export function hhmm(t) {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export const addDays = (t, n) => t + n * DAY;

/** Midnight (floating) of the day containing t. */
export const startOfDay = (t) => Math.floor(t / DAY) * DAY;

/** Day of week of floating t, 0 = Sunday. */
export const weekday = (t) => new Date(t).getUTCDay();

/** "HH:MM" -> minutes since midnight, or null if malformed. 24:00 and later are rejected. */
export function toMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Floating ms for a "YYYY-MM-DD" date plus minutes after midnight. */
export function at(date, min) {
  const [y, mo, d] = date.split("-").map(Number);
  return Date.UTC(y, mo - 1, d) + min * 60000;
}

/** [start, end] in floating ms. An end at or before the start runs into the next day (e.g. sleep 23:00-07:00). */
export function blockTimes(b) {
  const s = toMin(b.s), e = toMin(b.e);
  const t0 = at(b.date, s);
  let t1 = at(b.date, e);
  if (t1 < t0 || (t1 === t0 && e !== s)) t1 += DAY;
  return [t0, t1];
}

/** 105 -> "1h 45m" */
export const dur = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };

/** "2026-10-15" -> "Thu 15 Oct" */
export function dayLabel(date) {
  const t = at(date, 0);
  return `${WD[weekday(t)]} ${new Date(t).getUTCDate()} ${MO[new Date(t).getUTCMonth()]}`;
}

/** ms -> "3d 20h 52m", "1h 05m 09s" or "4m 00s" */
export function countdown(ms) {
  ms = Math.max(0, ms);
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  return d ? `${d}d ${h}h ${pad(m)}m` : h ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}

export function isTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/**
 * The wall clock of a real instant, as floating ms.
 * With a time zone (IANA name, e.g. "Asia/Tokyo"), the wall clock there; without one, the local clock
 * of the machine running the code (the browser's, for the web app).
 */
export function floatingNow(instant = Date.now(), tz = "") {
  if (!tz) return instant - new Date(instant).getTimezoneOffset() * 60000;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) + (instant % 1000 + 1000) % 1000;
}
