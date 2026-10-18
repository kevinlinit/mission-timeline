/*
 * Trips your travel studio planned for you. When the studio shares an itinerary with your Google email,
 * it appears here after you sign in, under "From <studio>". The plan itself is the studio's (you can't
 * edit its blocks); your done / changed / skipped marks and day notes are yours, and go back to your
 * planner. Kept in this browser apart from your own missions, and never mixed into their sync.
 */
import { cleanMission } from "../core/index.js";

const KEY = "mission-timeline:studio";

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
const write = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* not kept */ } };

/**
 * @param account   from createAccount(): request(method, path, body)
 * @param onChange  called when the trips change, to redraw
 */
export function createStudioTrips({ account, onChange }) {
  // { studio: { name }, trips: [{ caseId, ref, status, planner, sharedAt, mission }], pending: { [missionId]: { blocks, memos } } }
  let state = read() || { studio: null, trips: [], pending: {} };
  state.trips = state.trips.map((t) => ({ ...t, mission: cleanMission(t.mission) }));
  let timer = null, running = null;

  const save = () => write(state.trips.length || Object.keys(state.pending).length ? state : null);
  const find = (id) => state.trips.find((t) => t.mission.id === id) || null;

  /** Your marks that haven't reached the server yet, on top of the studio's latest. */
  function withPending(mission) {
    const p = state.pending[mission.id];
    if (!p) return mission;
    return {
      ...mission,
      blocks: mission.blocks.map((b) => (p.blocks[b.id] ? { ...b, status: p.blocks[b.id].status } : b)),
      memos: Object.fromEntries(Object.entries({ ...mission.memos, ...p.memos }).filter(([, v]) => v)),
    };
  }

  /** Fetch the trips, after sending any marks made offline. */
  function sync() {
    if (running) return running;
    running = (async () => {
      try {
        for (const [id, body] of Object.entries(state.pending)) {
          const r = await account.request("PUT", `me/studio/trips/${encodeURIComponent(id)}/progress`, body);
          if (!r) return;
          if (r.status === 200 || r.status === 404) delete state.pending[id]; // 404: the studio took it back
        }
        const r = await account.request("GET", "me/studio.json");
        if (!r || r.status !== 200) return;
        state.studio = r.data.studio;
        state.trips = r.data.trips.map((t) => ({ ...t, mission: withPending(cleanMission(t.mission)) }));
        save();
        onChange();
      } catch { /* offline: try again later */ } finally { running = null; }
    })();
    return running;
  }

  /**
   * The app changed a trip (a mark or a day note): keep it, and send what changed to the studio soon.
   * Anything else about the trip is the studio's and is left as it was.
   */
  function update(m) {
    const t = find(m.id);
    if (!t) return;
    const at = Date.now();
    const p = (state.pending[m.id] ||= { blocks: {}, memos: {} });
    for (const b of m.blocks) {
      const before = t.mission.blocks.find((x) => x.id === b.id);
      if (before && before.status !== b.status) p.blocks[b.id] = { status: b.status, at };
    }
    for (const d of new Set([...Object.keys(m.memos), ...Object.keys(t.mission.memos)])) {
      if ((m.memos[d] || "") !== (t.mission.memos[d] || "")) p.memos[d] = m.memos[d] || "";
    }
    t.mission = cleanMission({
      ...t.mission,
      updatedAt: at,
      blocks: t.mission.blocks.map((b) => ({ ...b, status: m.blocks.find((x) => x.id === b.id)?.status ?? b.status })),
      memos: Object.fromEntries(Object.entries(m.memos).filter(([, v]) => v)),
    });
    save();
    clearTimeout(timer);
    timer = setTimeout(sync, 1200);
  }

  /** Signed out: these trips belong to the account, so they go. */
  function clear() {
    state = { studio: null, trips: [], pending: {} };
    save();
    onChange();
  }

  return {
    sync, update, clear,
    /** Copies: the app marks blocks on its copy, then hands it to update(). */
    missions: () => state.trips.map((t) => structuredClone(t.mission)),
    trip: find,
    studioName: () => state.studio?.name || "your studio",
    has: (id) => !!find(id),
  };
}
