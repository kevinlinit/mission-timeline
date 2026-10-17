# Mission Timeline

The backend for Mission Timeline: a JSON API that serves timeline metadata to the web app and the [iOS app](https://github.com/kevinlinit/mission-timeline-iOS), plus the shared timeline logic both use.

A mission is anything with a date and a goal, planned as timed blocks with hard deadlines and Plan B branches, followed live, then debriefed. The method comes from a nine-night trip across Kyushu and Shikoku, which is published here as the example mission.

It runs two ways from the same code:

- **Node server** (`npm start`): every endpoint, including the live state and templates built for a date.
- **Static export** (`npm run build`): every endpoint that doesn't depend on the clock, as `.json` files, plus the web app. GitHub Pages serves it for free.

No dependencies. Node 20 or later.

## Layout

```
src/core/          shared timeline logic, ES modules, no I/O; the server and the web app load the same files
  time.js          wall-clock ("floating") time, time zones, labels, countdowns
  model.js         the mission-timeline/v1 model: categories, cleaning and validation
  live.js          what's happening at a given moment
  timeline.js      day-by-day structure, block details, summaries
  templates.js     starter missions
  format.js        export and import files
src/api/
  repository.js    loads and validates data/
  router.js        the API as pure functions: request in, status and JSON out
src/server.js      node:http server: the API, the web app and /core/
scripts/build.js   static export to dist/
data/
  missions/*.json  published missions (one per file, or an export file)
  ios/latest.json  the iOS app's update feed
web/               the web app, a client of the API
test/              node:test: core, API, server, build
```

## Run it

```sh
npm start                 # http://127.0.0.1:8080, API at /api/v1.json
npm run dev               # the same, restarting on changes
npm test
npm run build             # static export in dist/
```

The server reads `PORT` (default 8080), `HOST` (default 127.0.0.1; use 0.0.0.0 in a container) and `DATA_DIR` (default `./data`).

## API

Base path `/api/v1`. Every route answers with or without a `.json` suffix. The static export only has the `.json` files, so clients should use that form; it works against both. Add `?pretty` on the server for indented JSON.

| Endpoint | Static | What it returns |
| --- | --- | --- |
| `GET /api/v1.json` | ✓ | Index: API version, data format, data revision, endpoint list |
| `GET /api/v1/missions.json` | ✓ | `{ missions: [summary] }`: id, name, emoji, goal, highlight, tz, start, end, days, block/deadline/Plan B counts, status tally |
| `GET /api/v1/missions/:id.json` | ✓ | The mission in the `mission-timeline/v1` format |
| `GET /api/v1/missions/:id/timeline.json` | ✓ | `{ id, tz, days: [{ date, label, memo, blocks, deadlines, items }] }`. Items are `deadline`, `block` or `planB` in drawing order; blocks include `emoji`, `category`, `minutes`, `endsNextDay` |
| `GET /api/v1/missions/:id/live.json?at=&tz=` | server | The live state at `at` (ISO time or ms, default now) on the mission's wall clock (`tz`, default the mission's, else UTC): `phase` is `before`, `during` or `after`, with the current block and progress, next block, next hard deadline, Plan B running, or the debrief tally |
| `GET /api/v1/export.json` | ✓ | Every mission as one export file the web and iOS apps can import |
| `GET /api/v1/templates.json` | ✓ | `{ templates: [{ id, label, emoji, blurb }] }` |
| `GET /api/v1/templates/:id.json?from=&tz=` | server | A template built into a mission starting from `from` (YYYY-MM-DD, default today in `tz`) |
| `GET /api/v1/ios/latest.json` | ✓ | The iOS update feed: `{ version, notes, url }`; also at `/ios/latest.json`, the URL the app uses |

Errors are JSON, `{ "error": { "code", "message" } }`, with 400 (bad `at`, `tz` or `from`), 404 (unknown endpoint, mission or template) or 405 (anything but GET, HEAD or OPTIONS: the API is read-only).

The server sends CORS headers (`*`), an `ETag` on every response (send `If-None-Match` for a 304), gzip for larger responses, and `Cache-Control: public, max-age=60` (static routes) or `no-cache` (live).

```sh
curl 'http://127.0.0.1:8080/api/v1/missions/example-japan-trip/live.json?at=2026-10-02T07:20:00%2B09:00&pretty'
# phase "during", current "Lost at a junction", 43 minutes left, next "剣山 → 次郎笈 ridge in the fog"
```

### Times

Block times are wall-clock times: "09:00 on 2026-10-02" in whatever time zone the mission happens in. The core computes in *floating time* (milliseconds as if that wall clock were UTC), so results are the same on any machine, and a night across a DST change is still eight hours. A mission can name its zone in `tz` (an IANA name such as `Asia/Tokyo`); the live endpoint uses it, and so does the web app's live panel, so the example trip shows Japan time wherever you open it. Missions without `tz` follow the viewer's clock in the apps and UTC on the server.

## The data format

`mission-timeline/v1`, shared by the API, the web app and the iOS app:

```
Mission  { id, name, emoji, goal, highlight, createdAt, example, tz, blocks: Block[], memos: { "YYYY-MM-DD": text } }
Block    { id, date: "YYYY-MM-DD", s: "HH:MM", e: "HH:MM", cat: do|prep|move|rest|fuel|admin,
           title, note, em, fixed, opt, dl, branch, status: ""|done|changed|skipped }
```

An end at or before the start runs into the next day. `branch` names a Plan B (empty for the main plan). `tz` is optional; older clients ignore it.

### Publishing data

Add a mission as `data/missions/<id>.json` (ids are lowercase letters, digits and dashes), or update `data/ios/latest.json` to announce an iOS release. Data is validated when the server starts and when the export builds, so a bad file fails there rather than on a request.

## Web app

`web/` is a client of the API. Missions you make are kept in your browser (`localStorage`). Every mission published in `data/missions/` is added to the mission list the first time the app sees it (from `/api/v1/missions.json`); after that it's yours to mark and edit, and if you delete it, it isn't added back (it stays offered under **New mission**). The iOS app does the same. It imports the shared core from `/core/`, so it needs to be served (by `npm start` or from the static export), not opened as a file.

### Block details

Tap a block to open its details: a side panel on wide screens, a bottom sheet on phones. Every sheet shows the time, how long until it starts or ends (or how far through it you are), the note, and arrows to the previous and next block. The rest depends on the kind of block, worked out by `blockDetails()` in `src/core/details.js`:

| Kind | Shows | Main action |
| --- | --- | --- |
| Move | leave and arrive times, what's after | directions to the destination |
| Do, Fuel | what's next and the slack before it | find the place in Maps |
| Rest | wake-up time, first thing next | |
| Admin, Prep | the note as a checklist you can tick | |
| Hard deadline | big countdown, "no second chance", its Plan B | reminder 30 minutes before |
| Plan B | when to use it, what it replaces | in Edit mode, switch to it (marks the replaced blocks changed) |

The place is guessed from the title ("Metro to Futian" → Futian, "Dinner: Chaoshan beef hotpot" → Chaoshan beef hotpot, generic titles like "Lunch" → none). Reminders download as a calendar event (`.ics`) with an alert. In Edit mode the sheet also has Done, Changed, Skipped and Edit.

## Deploying

**GitHub Pages (static).** On every push to `main`, the `publish` workflow runs the tests, builds `dist/` and pushes it to the `gh-pages` branch. It also pushes the same build to `japan-trip-demo`, the branch Pages currently deploys, so the live site updates either way (the old demo is kept on the branch `japan-trip-demo-archive`). The site and the static API are then at `https://kevinlinit.github.io/mission-timeline/`, with the iOS feed staying at `/ios/latest.json`.

**Node server.** Any Node 20+ host (Render, Fly.io, Railway, a VPS): run `npm start` with `HOST=0.0.0.0` and `PORT` set by the host. No build step or install is needed.

## Next steps

- Writes: `POST`/`PUT` missions with accounts, so the web and iOS apps sync through the API.
- Push updates for the iOS Live Activity (APNs) from the server.
- An OpenAPI description generated from the route table in `src/api/router.js`.
