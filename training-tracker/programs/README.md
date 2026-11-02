# Program definitions

Each structured strength program lives in its own file here and registers itself with
`registerStrengthProgram(definition)` (see the format at the top of `../programs.js`).
Scheduling, the Plans screens, the workout logger, History and Statistics are shared;
nothing program-specific goes into them.

To add a program:

1. Create `programs/<id>.js` with one `registerStrengthProgram({ … })` call.
2. Load it in `index.html` right after `programs.js`:
   `<script src="programs/<id>.js"></script>`
3. Add `'./programs/<id>.js'` to `ASSETS` in `sw.js` and bump `CACHE`, so it works offline.
4. Add a test that checks every week of the definition against the source
   (`tests/suites/structured-test.js` shows how a program is checked end to end).

A definition with a mistake (wrong number of workouts in a week, unknown workout or exercise,
bad sets/reps/rest) is refused when it loads: the error names the week and exercise.
Starting a program saves its full schedule in the plan, so editing a definition later never
changes a program someone is already following.
