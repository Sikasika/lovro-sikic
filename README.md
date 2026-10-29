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

Tabs: **Today** · **Train** · **Plans** · **Progress** (Overview, Insights, Stats, Body) ·
**History**. Settings opens from the gear on Today.

Features:
- Today: the workout in progress (Continue) or Start Workout, this week Mon–Sun, the latest
  workout with up to two insights, and the body-weight trend
- Plans: built-in strength programs (Full Body 3×/week, Upper/Lower 4×/week). Set up start
  date, training days, length and lighter weeks; review the whole schedule; start. The schedule
  is saved as a snapshot (app updates never change it). Program card with week n of N, done /
  missed / skipped counts, this week's sessions, full schedule, same-day conflict warnings.
  Each session can be started (opens the normal logger), skipped, moved (only that session;
  nothing shifts automatically) or marked done; stop or delete a program. Today shows today's
  planned session; Train's Start Workout lists it first.
- Running plans (5K, 10K): questions about the goal (optional target time), race date or
  length, a recent race/time trial, current weekly distance, runs and longest run, running
  days, experience, injuries and (optional) measured max heart rate. Partial answers are
  filled in conservatively and labelled. Fitness is estimated from the recent result (Riegel);
  training paces come from it, never from the target, which is only checked (realistic /
  ambitious / unlikely, with the numbers). No result: an effort-based plan. Schedules build
  from current volume (≤10% or 1.5 km a week, recovery every 4th week, long run 30–50% of
  the week and capped, hard sessions only with enough base), taper and race on the race day,
  or end with an optional time trial. Full review before starting; runs open the logger with
  their steps, paces/effort and a distance/time target; planned vs actual distance, time and
  (easy runs) pace. One running plan alongside one strength program; same-day warnings
- Planned workouts: per-exercise targets (sets × rep range), swap an exercise for the day
  (recorded as "instead of …"), planned vs actual on the Finish screen and in History. The
  next-weight recommendation uses the program's rep range; 8–12 everywhere else
- Train: Start Workout → pick a template or recent workout → review → Begin (the clock
  starts only then), or start empty. Live session with a sticky bar (clock, progress,
  rest timer, Finish), large ✓ targets, "previous" column, planned targets, warm-up/working/drop
  sets, exercise notes, supersets. Finish shows a summary before saving.
- History: list with duration, exercises, sets and volume; workout review with every set
  (types, not-done sets, notes, supersets, cardio) compared with the previous session of each
  exercise; edit any past workout, repeat, save as template
- Progression: trend vs last time (↑ ↓ →) and next-weight recommendation (8–12 reps;
  increase at 13+ or all 12+, decrease when all below 8; weight step in Settings), in
  History and in each exercise of the live workout (with "Use" to fill empty weights)
- Progress › Overview: streaks, this week vs last week, recent records, per-exercise chart
- Progress › Body: body weight (quick entry for today, 7-day average, target progress,
  30-day chart, edit/delete weigh-ins)
- Progress › Insights: weekly observations and report, body-weight overview (latest, 7-day average,
  7- and 30-day change, target, 30-day chart, observations), strength, cardio, balance
- Progress › Stats: activity heatmap, summaries, frequency, performance charts and records,
  cardio (distance, pace, speed), body-weight chart, breakdowns by activity type, weekday and category
- Settings: metric/imperial units, exercise library (rename, categories incl. Sports,
  archive), backup export, validated restore with undo

Files: `index.html`, `styles.css`, `stats.css`, `calc.js` (shared data rules and
calculations), `backup.js` (backup format and restore), `workout.js` (Train tab: start,
live session, finishing, rest timer), `bodyweight.js` (weigh-ins, target, weight charts), `plans.js` (plan data, session
statuses, links), `programs.js` (built-in programs, schedules, planned workouts), `run-plan.js`
(running fitness, paces and plan generator),
`plans-ui.js` (Plans tab), `home.js` (Today, Plans, Progress sections), `app.js` (other screens, editors, events), `stats.js`
(Statistics tab), `sw.js` (offline cache), `manifest.webmanifest`, `icons/`.

Releasing a change: bump `CACHE` in `training-tracker/sw.js` (and add any new file to
its `ASSETS` list), otherwise installed apps keep running the previous version.

Tests (Playwright, outside the app folder): `cd tests && npm install`, then
`node tests/run.js` (all suites, light and dark, several phone widths; `--quick` for a short
run) and `node tests/update-test.js [ref]` (installed-app update over an older version).
See `tests/README.md`.

Backups that contain plans are format 2 (older app versions refuse them rather than drop the
plans); backups without plans stay format 1 and restore in any version.

Data is stored only on the device (localStorage). Export a backup from Settings now and then.
