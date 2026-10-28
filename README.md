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
- Workout: templates with planned sets (weight/reps or distance/time), warm-up/working/drop
  sets, exercise notes, supersets, rest timer, "last time" values, location
- History: workout details, edit any past workout, repeat, save as template
- Progress: streaks, this week vs last week, recent records, per-exercise chart
- Statistics: activity heatmap, summaries, frequency, performance charts and records,
  cardio (distance, pace, speed), breakdowns by activity type, weekday and category
- Settings: metric/imperial units, exercise library (rename, categories incl. Sports,
  archive), backup export, validated restore with undo

Files: `index.html`, `styles.css`, `stats.css`, `calc.js` (shared data rules and
calculations), `backup.js` (backup format and restore), `app.js` (screens), `stats.js`
(Statistics tab), `sw.js` (offline cache), `manifest.webmanifest`, `icons/`.

Releasing a change: bump `CACHE` in `training-tracker/sw.js` (and add any new file to
its `ASSETS` list), otherwise installed apps keep running the previous version.

Data is stored only on the device (localStorage). Export a backup from Settings now and then.
