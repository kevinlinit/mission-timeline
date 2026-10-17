/**
 * Client for the Mission Timeline API. Uses the ".json" form of each route, which both the Node server
 * and the static export on GitHub Pages answer. Paths are relative, so the app works wherever it's hosted.
 */
const BASE = new URL("api/v1/", document.baseURI);

export class ApiError extends Error {}

export async function apiGet(path) {
  let res;
  try {
    res = await fetch(new URL(`${path}.json`, BASE), { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError("Couldn't reach the Mission Timeline API.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error?.message || `The API answered ${res.status}.`);
  return body;
}

/** Summaries of every published mission. */
export async function listPublished() {
  const { missions } = await apiGet("missions");
  return missions;
}

/** A published mission in the mission-timeline/v1 format. */
export const getMission = (id) => apiGet(`missions/${encodeURIComponent(id)}`);
