# Mission Timeline

Plan anything with a date and a goal as a live, hour-by-hour timeline: a hike, an interview, a training week, a date.

The method comes from a nine-night trip across Kyushu and Shikoku that ran on a minute-by-minute timeline, rain delays and a night lost in the fog included. It worked well enough to use for everything else.

## The method

1. **Blocks.** Break the mission into timed blocks, each with a type: prep, do, move, rest, fuel or admin.
2. **Fixed or estimated.** Solid blocks for times that can't move, dashed ones for your best guess.
3. **Hard deadlines.** The one to three moments with no second chance, marked in red.
4. **Plan B.** A branch for rain, delays or nerves, decided in advance rather than on the spot.
5. **Debrief.** Mark each block done, changed or skipped, write a note on each day, and record the highlight.

## What the app does

- **Live panel:** what to do now, what's next, and a countdown to the next hard deadline. Before the mission it counts down to the start; afterwards it shows the debrief tally.
- **Timeline:** day by day, with deadlines and Plan B branches shown in place.
- **Templates:** interview prep, a training week with a turn-back time on the long hike, and a date night.
- **Debrief:** done / changed / skipped on every block, a note for every day, and a highlight for the mission.
- **Export and import:** back up your missions as JSON or move them to another device.

Missions are saved in your browser (`localStorage`). Nothing is sent anywhere.

## Run it

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
npx serve .
# or
python3 -m http.server
```

To put it online for free, turn on GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / root**.

## Tests

The date and time logic lives in `js/core.js` and runs in Node as well as the browser.

```sh
npm test
```

Requires Node 18 or later.

## Project layout

```
index.html        page shell
css/styles.css    styles, light and dark themes
js/core.js        pure logic: times, templates, live state, import/export
js/app.js         UI and localStorage
test/             node:test suite for core.js
```

## Ideas for next steps

- Sync across devices (a small backend, or a sync file in cloud storage)
- Draft a mission from a plain-language description with an LLM
- Reminders before hard deadlines (Notifications API)
- Installable as an offline app (PWA manifest and service worker)
