# Mission Timeline

The backend for Mission Timeline: a JSON API that serves timeline metadata to the web app and the [iOS app](https://github.com/kevinlinit/mission-timeline-iOS), plus the shared timeline logic both use.

It's also the studio's back office: staff manage customer cases in the **studio console** (`/studio`) and send each customer a tailored itinerary that appears in their app ([Customer cases](#customer-cases-the-studio-console)).

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
  account-routes.js sign-in and your own missions (/auth, /me)
  studio-routes.js the studio's cases (/studio) and the customer's side (/me/studio)
src/auth/          Google ID tokens, session tokens, accounts
src/studio/        customer cases: the model (model.js) and their storage (store.js)
src/server.js      node:http server: the API, the web app and /core/
scripts/build.js   static export to dist/
data/
  missions/*.json  published missions (one per file, or an export file)
  ios/latest.json  the iOS app's update feed
web/               the web app, a client of the API
web/studio/        the studio console for staff
test/              node:test: core, API, server, auth, studio, build
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

## Sign in with Google and sync

Signing in keeps your own missions on the server, so the web app and the iPhone app share them. Published missions (`data/missions`) stay public and need no account.

- **Sign-in**: the app gets a Google ID token (Google's button on the web, Google's sign-in page in Apple's secure sheet on iOS). The server checks its signature against Google's public keys, its audience (your client IDs), issuer and expiry (`src/auth/google.js`, no dependencies), then issues its own session token: signed with `SESSION_SECRET`, valid 30 days, sent as `Authorization: Bearer …` (`src/auth/session.js`).
- **Sync**: `GET /api/v1/me/missions` and `PUT /api/v1/me/missions` with the revision you based your changes on. If another device saved first you get `409` with the current state; the app merges and saves again. Merging (`mergeMissions` in `src/core/sync.js`): newest edit of each mission wins (`updatedAt`), deletions are remembered for 180 days so they don't come back.
- **Sign out** on a device just forgets its token; `POST /api/v1/auth/signout` signs out every device.
- **Storage**: accounts and their missions are JSON files in `STATE_DIR` (default `./var`), written atomically, one write at a time per file. Good for one server; swap `src/auth/accounts.js` for a database to scale out.

Sign-in is off until it's configured; the apps then hide it and everything else works as before.

### Set it up

**1. Google Cloud: OAuth client IDs** ([console.cloud.google.com](https://console.cloud.google.com/))

1. Create a project, then **APIs & Services → OAuth consent screen**: External, app name "Mission Timeline", your support email, scopes `openid`, `email`, `profile`. While it's in testing, add your Google account under **Test users**.
2. **Credentials → Create credentials → OAuth client ID → Web application.** Under **Authorized JavaScript origins** add `https://kevinlinit.github.io`, your server's URL, and `http://localhost:8080` for local testing. Copy the **client ID**.
3. **Create credentials → OAuth client ID → iOS.** Bundle ID `com.kevinlinit.missiontimeline`. Copy the **client ID** (and note its "iOS URL scheme", the reversed ID, for the iOS app).

**2. Run the server somewhere** (Render, Fly.io, Railway or a VPS: any Node 20+ host)

Start command `npm start` (no install or build step). Environment:

| Variable | Value |
| --- | --- |
| `HOST` | `0.0.0.0` |
| `GOOGLE_WEB_CLIENT_ID` | the web client ID |
| `GOOGLE_IOS_CLIENT_ID` | the iOS client ID |
| `SESSION_SECRET` | 32+ random characters: `openssl rand -base64 48` |
| `STATE_DIR` | a folder on a persistent disk (e.g. Render disk at `/var/data`), or accounts are lost on redeploy |

Check it: `https://<server>/api/v1/auth/config.json` should say `"enabled": true`.

**3. Point the apps at it**

- **Web on GitHub Pages**: repo **Settings → Secrets and variables → Actions → Variables → New variable** `PUBLIC_SERVER_URL` = the server's URL. The next publish writes it into `js/config.js`. (The web app served by the server itself needs nothing.)
- **iOS**: see the iOS repo's README ("Sign in with Google").

## Customer cases: the studio console

Mission Timeline is the customer's trip assistant; the studio behind it plans each trip. Staff work on customer cases at **`/studio`** on the Node server (it needs sign-in set up, above).

**Who gets in.** Staff sign in with Google. The server lets in the emails on its staff list, each an **admin** or a **planner**:

| Variable | Value |
| --- | --- |
| `STUDIO_STAFF` | `admin:you@studio.com,planner:mei@studio.com` (a bare email is a planner). These can't be removed in the console, so the studio can't lock itself out. |
| `STUDIO_NAME` | Shown to customers as "From *name*". Default "Your studio". |

Admins add, re-role and remove other staff on the console's **Staff** page; planners can do everything else. Anyone else who signs in is told they're not on the list.

**A case** is one customer's trip, from first contact to home again:

- **Pipeline**: New inquiry → Planning → Proposal sent → Confirmed → Travelling → Completed, or Cancelled. Click a stage to move the case; sharing the first itinerary moves an early case to Proposal sent.
- **Handling**: planner (assignee) and priority (low, normal, high, urgent). The list puts urgent first, then the most recently touched.
- **Customer and trip**: name, email (how the itinerary reaches their app), phone; dates, destinations, travellers, budget, where the inquiry came from, tags, and what they asked for in their words.
- **Notes**: internal, never shown to the customer.
- **History**: every change, by whom and when, including what the customer marked in the app.
- **Itineraries**: one or more missions in the mission-timeline/v1 shape. The editor starts from a blank page, a template, a published trip, an export file or another itinerary on the case, moves all dates to the trip's start, and previews the timeline the way the customer sees it, with their marks.

The case list filters by stage (with counts), planner (Mine, Unassigned, anyone), priority and a search across name, email, places, tags and the request. Two planners editing the same case can't overwrite each other: a change based on an old revision gets `409` and the console reloads the latest.

**Delivery to the customer.** **Share** an itinerary and it appears in the customer's web and iOS app once they sign in with Google using the case's email, under **From *studio***. Changes the planner saves show up on their next sync. The customer can't edit the plan, but their done / changed / skipped marks and day notes go back to the case (its history and a progress bar on the itinerary). **Stop sharing**, cancelling or deleting the case takes it out of their app; signing out removes it from the device.

**API.** Everything needs a session token; staff routes also need the staff list.

| Route | |
| --- | --- |
| `GET /api/v1/studio/me` | you, your role, the pipeline |
| `GET /api/v1/studio/cases?status=&assignee=&priority=&q=&open=1` | case summaries and counts per stage |
| `POST /api/v1/studio/cases` | open a case `{ customer, trip, priority, assignee, note }` |
| `GET` / `PATCH /api/v1/studio/cases/{id}` | a case; change `status`, `priority`, `assignee`, `customer`, `trip` (send `baseRevision`) |
| `DELETE /api/v1/studio/cases/{id}` | admins only |
| `POST /api/v1/studio/cases/{id}/notes` | `{ text }` |
| `POST /api/v1/studio/cases/{id}/itineraries` | add `{ mission }` |
| `PUT` / `DELETE /api/v1/studio/cases/{id}/itineraries/{missionId}` | replace or remove one |
| `POST /api/v1/studio/cases/{id}/itineraries/{missionId}/share` | `{ shared: true \| false }` |
| `GET /api/v1/studio/staff`, `PUT` / `DELETE /api/v1/studio/staff/{email}` | the staff list; changes are admins only |
| `GET /api/v1/me/studio` | the customer's shared trips |
| `PUT /api/v1/me/studio/trips/{missionId}/progress` | the customer's marks `{ blocks: { id: { status, at } }, memos }` |

**Storage**: `STATE_DIR/studio/cases.json` and `staff.json`, written the same way as accounts.

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

- Email the customer when an itinerary is shared or changes.
- Attach files to cases (tickets, vouchers) and show them on the matching block.

- Push updates for the iOS Live Activity (APNs) from the server.
- An OpenAPI description generated from the route table in `src/api/router.js`.
