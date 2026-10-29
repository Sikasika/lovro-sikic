# parcijalni-ispit
To start the project:
   - run `npm install`, then `node app.js` in your terminal
   - go to `localhost:3000`

## Training Tracker (iPhone app)

`training-tracker/` is an installable web app (PWA) for logging workouts on iPhone.
It has no build step, no dependencies and no server: GitHub Pages serves the folder
as-is from the `claude/iphone-training-tracker-ioob77` branch at
https://sikasika.github.io/lovro-sikic/training-tracker/ (locally: `node app.js`, then
`localhost:3000/training-tracker/`).

**Install on iPhone:** open the URL in Safari → Share → **Add to Home Screen**.
It then launches full-screen like a native app and works offline.

Features:
- Workout: Start Workout → pick a template or recent workout → review → Begin (the clock
  starts only then), or start empty. Live session with a sticky bar (clock, progress,
  rest timer, Finish), large ✓ targets, "previous" column, planned targets, warm-up/working/drop
  sets, exercise notes, supersets. Finish shows a summary before saving.
- History: list with duration, exercises, sets and volume; workout review with every set
  (types, not-done sets, notes, supersets, cardio) compared with the previous session of each
  exercise; edit any past workout, repeat, save as template
- Progression: trend vs last time (↑ ↓ →) and next-weight recommendation (8–12 reps;
  increase at 13+ or all 12+, decrease when all below 8; weight step in Settings), in
  History and in each exercise of the live workout (with "Use" to fill empty weights)
- Progress: body weight (quick entry for today, 7-day average, target progress, 30-day chart,
  edit/delete weigh-ins), streaks, this week vs last week, recent records, per-exercise chart
- Insights: weekly observations and report, body-weight overview (latest, 7-day average,
  7- and 30-day change, target, 30-day chart, observations), strength, cardio, balance
- Statistics: activity heatmap, summaries, frequency, performance charts and records,
  cardio (distance, pace, speed), body-weight chart, breakdowns by activity type, weekday and category
- Settings: metric/imperial units, exercise library (rename, categories incl. Sports,
  archive), backup export, validated restore with undo

Files: `index.html`, `styles.css`, `stats.css`, `calc.js` (shared data rules and
calculations), `backup.js` (backup format and restore), `workout.js` (Workout tab: start,
live session, finishing, rest timer), `bodyweight.js` (weigh-ins, target, weight charts), `app.js` (other screens, editors, events), `stats.js`
(Statistics tab), `sw.js` (offline cache), `manifest.webmanifest`, `icons/`.

Releasing a change: bump `CACHE` in `training-tracker/sw.js` (and add any new file to
its `ASSETS` list), otherwise installed apps keep running the previous version.

Data is stored only on the device (localStorage). Export a backup from Settings now and then.
