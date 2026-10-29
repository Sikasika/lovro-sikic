# Training Tracker tests

Browser tests for `training-tracker/` (Playwright + Chromium, iPhone viewports). They are not
part of the app: nothing here is loaded by the app or cached by its service worker.

## Run

    cd tests && npm install        # once: installs Playwright (see package.json)
    npx playwright install chromium  # once, if Chromium isn't installed
    node run.js                    # full run: light + dark, several widths (~30–40 min)
    node run.js --quick            # light only, one width each (a few minutes)
    node run.js --only=hist-test,prog-test
    node update-test.js HEAD~1     # update from an older commit to the working tree

`run.js` serves the repo with `server.js` on port 3000 (or uses whatever already serves
`/training-tracker/` there) and sets `TZ=Europe/Zagreb`, which some suites rely on.
Screenshots, generated backup files and `summary.txt` go to `tests/out/` (git-ignored).

## Suites (`suites/`)

| Suite | Covers |
|---|---|
| nav-test | Today screen, five tabs, Progress sections, Settings gear, workout in progress |
| wk-test | Train tab: start flow, set ticking, finish summary, discard, rest timer |
| logging-test, tpl-test, cardio-test | set types, notes, supersets, templates, cardio logging |
| wedit-test, hist-test | History list and review, editing saved workouts, previous-session comparison |
| plan-test | plan core: snapshots, session statuses, no automatic shifting, links, one strength + one sport plan, backup/restore of plans |
| prog-test | progression trend and next-weight recommendation |
| bw-test, bwi-test | body weight (Progress, Statistics, Insights) incl. backup rules |
| exlib-test, units-test | exercise library, kg/lb and data upgrades |
| backup-test | export, validation, restore, undo |
| ps-test, stats-test(-ny), insights-test | Progress, Statistics, Insights |
| crawl-test | every screen at narrow widths: no sideways scrolling, no inputs under 16px, no errors |

Shared helpers: `nav.js` (`go(page, tab)` reaches any tab or Progress section), `flow.js` (start/finish helpers), `*-seed.js` (fixture data).
