import { cleanMission } from "./model.js";

/** The file format shared by the web app, the iOS app and the API. */
export const FORMAT = "mission-timeline/v1";

export function exportData(missions, now = new Date()) {
  return JSON.stringify({ format: FORMAT, exportedAt: now.toISOString(), missions }, null, 2);
}

export class ImportError extends Error {}

/** Parse an export file: the wrapped format or a bare array of missions. Throws on bad input. */
export function importData(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("That file isn't valid JSON. Choose a file exported from Mission Timeline.");
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.missions) ? data.missions : null;
  if (!list) throw new ImportError("This file doesn't contain any missions.");
  return list.map(cleanMission);
}
