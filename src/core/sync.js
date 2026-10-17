import { cleanMission } from "./model.js";

/**
 * Merging two copies of a user's missions (this device and the server), used by every client and
 * by the server's tests. A "set" is { missions: Mission[], tombstones: { [missionId]: deletedAtMs } }.
 *
 * Rules:
 *   - a mission on only one side is kept;
 *   - on both sides, the one edited last (updatedAt) wins, whole;
 *   - a deletion wins over any edit made before it, and is remembered (tombstone) so the mission
 *     doesn't come back from a device that hasn't heard about it.
 * Order: this device's order first, then missions only the other side has.
 */
export function mergeMissions(local, remote) {
  const tombstones = { ...(remote?.tombstones || {}) };
  for (const [id, at] of Object.entries(local?.tombstones || {})) tombstones[id] = Math.max(at, tombstones[id] || 0);

  const stamp = (m) => Number(m.updatedAt) || Number(m.createdAt) || 0;
  const byId = new Map();
  const order = [];
  for (const m of [...(local?.missions || []), ...(remote?.missions || [])]) {
    const prev = byId.get(m.id);
    if (!prev) { byId.set(m.id, m); order.push(m.id); }
    else if (stamp(m) > stamp(prev)) byId.set(m.id, m);
  }
  const missions = order
    .map((id) => byId.get(id))
    .filter((m) => !(tombstones[m.id] >= stamp(m)))
    .map(cleanMission);
  return { missions, tombstones };
}

/** Drop tombstones older than `maxAgeMs` (default 180 days) so they don't pile up forever. */
export function pruneTombstones(tombstones, now = Date.now(), maxAgeMs = 180 * 86400000) {
  return Object.fromEntries(Object.entries(tombstones || {}).filter(([, at]) => now - at < maxAgeMs));
}
