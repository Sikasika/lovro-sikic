// Progress → Muscles: mapping, weighted sets per week, heatmap, details, unmapped list, backups.
// Usage: node muscles-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { go } = require('./nav');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const V32 = '030a543'; // the release before this feature
const OLD_PORT = 3220 + (scheme === 'dark' ? 2 : 0) + (width === 320 ? 1 : 0);
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const up = (port) => new Promise((res) => http.get(`http://localhost:${port}/training-tracker/`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));

// The agreed mapping, written out independently of the app's table.
const AGREED = {
  'Bench Press': [['chest'], ['triceps', 'front-delts']],
  'Incline Dumbbell Press': [['chest'], ['front-delts', 'triceps']],
  'Push-up': [['chest'], ['triceps', 'front-delts']],
  'Chest Fly': [['chest'], ['front-delts']],
  'Squat': [['quads', 'glutes'], ['adductors']],
  'Deadlift': [['glutes', 'hamstrings'], ['lower-back', 'quads', 'upper-back', 'forearms']],
  'Romanian Deadlift': [['hamstrings', 'glutes'], ['lower-back']],
  'Leg Press': [['quads'], ['glutes', 'adductors']],
  'Lunge': [['quads', 'glutes'], ['hamstrings', 'adductors']],
  'Leg Curl': [['hamstrings'], []],
  'Leg Extension': [['quads'], []],
  'Calf Raise': [['calves'], []],
  'Pull-up': [['lats'], ['biceps', 'upper-back']],
  'Barbell Row': [['upper-back', 'lats'], ['biceps', 'rear-delts']],
  'Lat Pulldown': [['lats'], ['biceps', 'upper-back']],
  'Seated Cable Row': [['upper-back', 'lats'], ['biceps', 'rear-delts']],
  'Overhead Press': [['front-delts'], ['side-delts', 'triceps']],
  'Lateral Raise': [['side-delts'], []],
  'Face Pull': [['rear-delts'], ['upper-back']],
  'Barbell Curl': [['biceps'], ['forearms']],
  'Hammer Curl': [['biceps', 'forearms'], []],
  'Tricep Pushdown': [['triceps'], []],
  'Dip': [['triceps', 'chest'], ['front-delts']],
  'Plank': [['abs'], ['obliques']],
  'Hanging Leg Raise': [['abs'], []],
  'Crunch': [['abs'], []]
};
const GROUPS = ['chest', 'front-delts', 'side-delts', 'rear-delts', 'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'upper-back', 'lats', 'lower-back', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.clock.setFixedTime(new Date('2026-11-25T18:00:00+01:00')); // Wednesday
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 200) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const sheet = async () => (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  const view = async () => (await page.innerText('#view')).replace(/\s+/g, ' ');
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#view *, #sheet *')].every((el) => el.offsetParent === null || el.closest('svg') || el.closest('.mf-hidden-buttons') || el.getBoundingClientRect().right <= window.innerWidth + 1));

  await ev(() => {
    window.T = {
      reset() { localStorage.clear(); state = defaultState(); ui.mus = { days: 30, selected: null }; save(); },
      id(n) { return state.exercises.find((e) => e.name === n).id; },
      // workout on a day of Nov 2026 (or a full date), entries [[name or id, sets]]; sets: number or array of set objects
      w(day, entries, extra = {}) {
        const d = typeof day === 'string' ? day : `2026-11-${String(day).padStart(2, '0')}`;
        const w = { id: `w${Math.random().toString(36).slice(2)}`, name: 'W', notes: '', start: `${d}T08:00:00`, end: `${d}T09:00:00`,
          entries: entries.map(([n, sets]) => ({ exerciseId: state.exercises.find((e) => e.name === n)?.id || n, sets: Array.isArray(sets) ? sets : Array.from({ length: sets }, () => ({ weight: 50, reps: 8, done: true })) })), ...extra };
        state.workouts.push(w); save(); return w.id;
      },
      act(days = 30) { const { items, today } = completedWorkouts(); return muscleActivity(items, today, days); },
      m(days = 30) { const r = T.act(days); return Object.fromEntries(Object.entries(r.muscles).map(([k, v]) => [k, Math.round(v.weighted * 100) / 100])); }
    };
  });
  const reset = () => ev(() => T.reset());

  /* A. Muscle groups */
  await reset();
  check('A 17 groups, as agreed', await ev(() => MUSCLE_GROUPS.map((g) => g.id).join(',')), GROUPS.join(','));
  const drawn = await ev(() => { const d = document.createElement('div'); d.innerHTML = muscleFigureSvg({}); const f = [...d.querySelectorAll('[data-view=front].m-region')].map((p) => p.dataset.muscle), b = [...d.querySelectorAll('[data-view=back].m-region')].map((p) => p.dataset.muscle);
    return MUSCLE_GROUPS.map((g) => `${g.id}:${g.views.every((v) => (v === 'front' ? f : b).includes(g.id))}:${f.filter((x) => x === g.id).length + b.filter((x) => x === g.id).length >= 2}`); });
  check('A every group drawn on its view(s), left and right', drawn.every((x) => x.endsWith(':true:true')), true);
  check('A every group is reached by at least one built-in exercise', await ev(() => MUSCLE_GROUPS.every((g) => Object.values(EXERCISE_MUSCLES).some((m) => m.primary.includes(g.id) || m.secondary.includes(g.id)))), true);

  /* B. Every built-in mapping */
  const maps = await ev((names) => Object.fromEntries(names.map((n) => { const m = exerciseMuscles(state.exercises.find((e) => e.name === n)); return [n, m && [m.primary, m.secondary, m.source]]; })), Object.keys(AGREED));
  for (const [n, [p, s]] of Object.entries(AGREED)) check(`B ${n}: primary ${p.join('+')}; secondary ${s.join('+') || 'none'}`, JSON.stringify(maps[n]), JSON.stringify([p, s, 'built-in']));
  check('B the built-in table has exactly these 26 exercises', await ev(() => Object.keys(EXERCISE_MUSCLES).length), 26);
  check('B every non-cardio default exercise is mapped; cardio ones are excluded', await ev(() => state.exercises.map((e) => `${e.name}:${muscleExcluded(e) ? 'cardio' : exerciseMuscles(e) ? 'mapped' : 'NO'}`).filter((x) => x.endsWith(':NO')).length + '|' + state.exercises.filter((e) => muscleExcluded(e)).map((e) => e.name).sort().join(',')), '0|Cycling,Rowing,Running,Swimming,Walking');

  /* C. Weighting */
  await ev(() => T.w(24, [['Bench Press', 4]]));
  let m = await ev(() => T.m(7));
  check('C Bench Press 4 sets: chest 4 (primary ×1), triceps 2 and front delts 2 (secondary ×0.5), nothing else', `${m.chest}|${m.triceps}|${m['front-delts']}|${Object.entries(m).filter(([k, v]) => v && !['chest', 'triceps', 'front-delts'].includes(k)).length}`, '4|2|2|0');
  let r = await ev(() => { const x = T.act(7).muscles; return `${x.chest.primarySets}/${x.chest.secondarySets}|${x.triceps.primarySets}/${x.triceps.secondarySets}|${x.chest.perWeek}`; });
  check('C primary and secondary set counts kept apart; 7 days = 1 week', r, '4/0|0/4|4');

  /* D. Drop sets and warm-ups; E. incomplete sets */
  await reset();
  await ev(() => T.w(24, [['Leg Extension', [{ weight: 20, reps: 10, type: 'warmup', done: true }, { weight: 50, reps: 8, done: true }, { weight: 50, reps: 8, done: true }, { weight: 35, reps: 8, type: 'drop', done: true }]]]));
  check('D warm-up excluded; drop set counts as 1', (await ev(() => T.m(7))).quads, 3);
  await reset();
  await ev(() => T.w(24, [['Leg Extension', [{ weight: 50, reps: 8, done: true }, { weight: 50, reps: 8, done: false }, { weight: '', reps: '', done: true }, { weight: 50, reps: 8 }]]]));
  check('E unticked and empty sets excluded (a set without "done" counts, as elsewhere in the app)', (await ev(() => T.m(7))).quads, 2);

  /* F. Cardio; G. workout in progress */
  await reset();
  await ev(() => { state.exercises.push({ id: 'pad', name: 'Padel', category: 'Sports' }); T.w(24, [['Running', [{ distance: 5000, duration: 1800, done: true }]], ['Rowing', [{ distance: 2000, duration: 480, done: true }]], ['pad', 3]]); });
  r = await ev(() => { const a = T.act(7); return `${Object.values(a.muscles).every((x) => x.weighted === 0)}|${a.unmapped.length}`; });
  check('F cardio (and sports) count for no muscle and are not listed as unmapped', r, 'true|0');
  await ev(() => { state.active = { id: 'act', name: 'Now', notes: '', start: new Date().toISOString(), entries: [{ exerciseId: T.id('Squat'), sets: [{ weight: 100, reps: 5, done: true }] }] }; save(); });
  check('G a workout in progress is not counted', (await ev(() => T.m(7))).quads, 0);
  await ev(() => { state.active = null; save(); });

  /* H. Archived; I. renamed and custom; J. explicit settings */
  await reset();
  await ev(() => { T.w(24, [['Lat Pulldown', 3]]); state.exercises.find((e) => e.name === 'Lat Pulldown').archived = true; save(); });
  check('H archived exercise still counts', (await ev(() => T.m(7))).lats, 3);
  await reset();
  await ev(() => {
    T.w(24, [['Bench Press', 2], ['Squat', 2]]);
    state.exercises.find((e) => e.name === 'Bench Press').name = 'Flat Bench';
    state.exercises.find((e) => e.name === 'Squat').name = '  sQuAt  ';
    state.exercises.push({ id: 'cc', name: 'Cable Crossover', category: 'Chest' }, { id: 'bps', name: 'Bench Presses', category: 'Chest' });
    T.w(23, [['cc', 3], ['bps', 1]]);
  });
  r = await ev(() => { const a = T.act(7); return { chest: a.muscles.chest.weighted, quads: a.muscles.quads.weighted, un: a.unmapped.map((x) => `${x.name}:${x.sets}`).join(',') }; });
  check('I renamed "Flat Bench", custom "Cable Crossover" and near-miss "Bench Presses": not mapped, nothing guessed', `${r.chest}|${r.un}`, '0|Cable Crossover:3,Flat Bench:2,Bench Presses:1');
  check('I only case and extra spaces are ignored in names ("  sQuAt  " = Squat)', r.quads, 2);
  const exBefore = await ev(() => JSON.stringify(state.exercises));
  await reset();
  await ev(() => {
    state.exercises.find((e) => e.name === 'Bench Press').muscles = { primary: ['lats'], secondary: ['biceps'] };
    state.exercises.push({ id: 'cc', name: 'Cable Crossover', category: 'Chest', muscles: { primary: ['chest'], secondary: ['front-delts'] } });
    state.exercises.push({ id: 'bad', name: 'Leg Extension 2', category: 'Legs', muscles: { primary: ['quadriceps'] } });
    state.exercises.find((e) => e.name === 'Leg Curl').muscles = { primary: ['nope'] };
    T.w(24, [['Bench Press', 2], ['cc', 2], ['bad', 2], ['Leg Curl', 2]]);
  });
  r = await ev(() => { const a = T.act(7); return `${a.muscles.lats.weighted}|${a.muscles.biceps.weighted}|${a.muscles.chest.weighted}|${a.muscles['front-delts'].weighted}|${a.muscles.hamstrings.weighted}|${a.unmapped.map((x) => x.name).join(',')}`; });
  check('J explicit exercise.muscles wins over the built-in table and maps custom exercises; invalid ones fall back / stay unmapped', r, '2|1|2|1|2|Leg Extension 2');
  const exWith = await ev(() => JSON.stringify(state.exercises));
  await ev(() => { ui.tab = 'muscles'; render(); }); await wait();
  await page.click('.mus-row >> nth=0'); await wait();
  check('J the app never writes or changes exercise.muscles (or any exercise)', await ev((w) => JSON.stringify(state.exercises) === w && JSON.stringify(JSON.parse(localStorage.getItem('training-tracker.v1')).exercises) === w, exWith), true);
  await ev(() => closeSheet());

  /* K. Period boundaries; L. weekly averaging; M. heat */
  await reset();
  await ev(() => { T.w(19, [['Calf Raise', 1]]); T.w(18, [['Calf Raise', 2]]); T.w('2026-10-27', [['Calf Raise', 4]]); T.w('2026-10-26', [['Calf Raise', 8]]); T.w('2026-08-28', [['Calf Raise', 16]]); T.w('2026-08-27', [['Calf Raise', 32]]); T.w(26, [['Calf Raise', 64]]); });
  r = await ev(() => [7, 30, 90].map((d) => { const a = T.act(d); return `${d}:${a.muscles.calves.weighted}:${sKey(a.from)}`; }).join('|'));
  check('K 7 days = 19–25 Nov, 30 days = 27 Oct–25 Nov, 90 days = 28 Aug–25 Nov (today included; future workouts ignored)', r, '7:1:2026-11-19|30:7:2026-10-27|90:31:2026-08-28');
  r = await ev(() => [7, 30, 90].map((d) => Math.round(T.act(d).muscles.calves.perWeek * 1000) / 1000).join('|'));
  check('L weekly average = weighted sets ÷ (days ÷ 7): 1, 7÷4.286, 31÷12.857', r, `1|${Math.round((7 / (30 / 7)) * 1000) / 1000}|${Math.round((31 / (90 / 7)) * 1000) / 1000}`);
  check('M heat is linear to 12 and capped: 0→0, 3→0.25, 6→0.5, 12→1, 20→1', await ev(() => [0, 3, 6, 12, 20].map(muscleHeat).join(',')), '0,0.25,0.5,1,1');
  await reset();
  await ev(() => { T.w(24, [['Lateral Raise', 6], ['Calf Raise', 20], ['Leg Curl', 3]]); ui.mus = { days: 7, selected: null }; ui.tab = 'muscles'; render(); });
  await wait();
  r = await ev(() => ['side-delts', 'calves', 'hamstrings', 'abs'].map((id) => { const p = document.querySelector(`#view .m-region[data-muscle="${id}"]`); return `${id}:${p.classList.contains('m-none') ? 'none' : p.style.getPropertyValue('--t')}`; }).join('|'));
  check('M figure: 6/week → 0.5, 20/week → capped at 1, 3/week → 0.25, none → grey', r, 'side-delts:0.500|calves:1.000|hamstrings:0.250|abs:none');
  r = await ev(() => { const a = getComputedStyle(document.querySelector('#view .m-region[data-muscle="abs"]')).fill, b = getComputedStyle(document.querySelector('#view .m-region[data-muscle="hamstrings"]')).fill, c = getComputedStyle(document.querySelector('#view .m-region[data-muscle="calves"]')).fill; return `${a !== b}|${b !== c}|${!/255, 0, 0|rgb\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\)/.test(a + b + c)}`; });
  check('M grey, low and high are different colours (no reds)', r, 'true|true|true');

  /* N. The Muscles section */
  await reset();
  await ev(() => {
    T.w(24, [['Bench Press', 4], ['Overhead Press', 3], ['Dip', 2]]);
    T.w(22, [['Squat', 4], ['Romanian Deadlift', 3]]);
    T.w(20, [['Pull-up', 4], ['Barbell Row', 3]]);
    state.exercises.push({ id: 'cc', name: 'Cable Crossover', category: 'Chest' }); T.w(21, [['cc', 3]]);
    T.w('2026-10-01', [['Calf Raise', 9]]);
  });
  const dataBefore = await ev(() => localStorage.getItem('training-tracker.v1'));
  await go(page, 'progress'); await wait();
  check('N Progress has a Muscles section', JSON.stringify(await page.$$eval('.subnav button', (b) => b.map((x) => x.textContent.trim()))), JSON.stringify(['Overview', 'Insights', 'Muscles', 'Stats', 'Body']));
  check('N section names don\'t overlap', await ev(() => { const r = [...document.querySelectorAll('.subnav button')].map((b) => { const g = document.createRange(); g.selectNodeContents(b); return g.getBoundingClientRect(); }); return r.every((x, i) => i === 0 || x.left >= r[i - 1].right) && r[r.length - 1].right <= innerWidth; }), true);
  await page.click('.subnav [data-tab=muscles]'); await wait();
  let t = await view();
  check('N 30 days by default: dates, figure, legend, explanation', `${t.includes('27 Oct – 25 Nov 2026')}|${await page.$$eval('#view svg.mf-svg', (x) => x.length)}|${t.includes('No sets') && t.includes('12+') && t.includes('Weighted sets per week')}|${t.includes('Based on logged sets; not a measure of effort, recovery or muscle growth.')}`, 'true|2|true|true');
  const rows = await page.$$eval('.mus-row', (x) => x.map((b) => [b.dataset.muscle, b.querySelector('.mus-val').textContent.trim()]));
  check('N list: all 17 groups, highest first, with weighted sets/week', `${rows.length}|${rows[0][0]}|${rows[0][1]}|${rows.filter(([, v]) => v === 'None').length}`, (v) => { const [n, , , none] = v.split('|'); return n === '17' && +none >= 1; });
  check('N list values match the calculation', JSON.stringify(rows.map(([id, v]) => v)), JSON.stringify(await ev(() => { const a = T.act(30).muscles; return MUSCLE_GROUPS.map((g) => ({ g, v: a[g.id].perWeek })).sort((x, y) => y.v - x.v || MUSCLE_GROUPS.indexOf(x.g) - MUSCLE_GROUPS.indexOf(y.g)).map(({ v }) => (v > 0 ? fmtNum(v) : 'None')); })));
  check('N unmapped list shows the custom exercise with its sets', /not mapped/i.test(t) && /Cable Crossover\s*3 sets/.test(t), true);
  check('N accessible: one labelled button per group and view', await ev(() => [...document.querySelectorAll('#view .mf-hidden-buttons button')].map((b) => b.getAttribute('aria-label')).every((l) => /: (\d|no sets)/.test(l)) && document.querySelectorAll('#view .mf-hidden-buttons button').length === 21), true);
  check('N layout fits the screen', await noOverflow(), true);
  await page.click('[data-mperiod="7"]'); await wait();
  check('N 7 days: 19–25 Nov; the 1 Oct calf work is outside', `${(await view()).includes('19 Nov – 25 Nov 2026')}|${await ev(() => document.querySelector('.mus-row[data-muscle=calves] .mus-val').textContent.trim())}`, 'true|None');
  await page.click('[data-mperiod="90"]'); await wait();
  check('N 90 days includes it', await ev(() => document.querySelector('.mus-row[data-muscle=calves] .mus-val').textContent.trim()), (v) => v !== 'None');
  await page.click('[data-mperiod="7"]'); await wait();
  // Details from the list
  await page.click('.mus-row[data-muscle=chest]'); await wait();
  t = await sheet();
  check('O chest details: date range, weighted per week and total, primary/secondary sets', `${t.includes('Last 7 days · 19 Nov – 25 Nov 2026')}|${t.includes('6 Weighted sets / week')}|${t.includes('6 Weighted sets')}|${t.includes('6 / 0 Primary / secondary sets')}`, 'true|true|true|true');
  check('O contributing exercises with role, sets and weighted contribution', `${t.includes('Bench Press Primary · 4 sets × 1 4')}|${t.includes('Dip Primary · 2 sets × 1 2')}`, 'true|true');
  check('O detail sheet fits the screen', await noOverflow(), true);
  await ev(() => closeSheet()); await wait();
  check('O selected muscle outlined on the figure (outline only, colour unchanged)', await ev(() => !!document.querySelector('#view .m-outline path') && document.querySelectorAll('#view .m-region[data-muscle=chest].m-selected').length === 0), true);
  // Details from the figure
  await page.locator('#view .m-region[data-muscle="triceps"]').first().click({ force: true }); await wait();
  t = await sheet();
  check('O tapping the figure opens the same details (triceps: secondary from bench and press, primary from dip)', `${t.includes('Triceps')}|${t.includes('Dip Primary · 2 sets × 1 2')}|${t.includes('Bench Press Secondary · 4 sets × 0.5 2')}|${t.includes('Overhead Press Secondary · 3 sets × 0.5 1.5')}|${t.includes('2 / 7 Primary / secondary sets')}`, 'true|true|true|true|true');
  await ev(() => closeSheet()); await wait();
  await page.click('.mus-row[data-muscle=obliques]'); await wait();
  check('O a muscle without sets says so', (await sheet()).includes('No logged sets for obliques in the last 7 days.'), true);
  await ev(() => closeSheet());
  check('P viewing never changes saved data', await ev(() => localStorage.getItem('training-tracker.v1')) === dataBefore, true);
  await ev(() => { state.workouts = []; save(); render(); }); await wait();
  check('P empty period: all grey, message, nothing unmapped', `${(await view()).includes('No resistance sets logged in the last 7 days.')}|${await ev(() => [...document.querySelectorAll('#view .m-region')].every((p) => p.classList.contains('m-none')))}`, 'true|true');

  /* Q. Backups */
  await reset();
  await ev(() => { state.exercises.find((e) => e.name === 'Bench Press').muscles = { primary: ['chest'], secondary: [] }; T.w(24, [['Bench Press', 3]]); });
  const b = await ev(() => buildBackup());
  check('Q backup format unchanged; exercise.muscles carried as it is', `${b.format}|${Object.keys(b).join(',')}|${JSON.stringify(b.data.exercises.find((e) => e.name === 'Bench Press').muscles)}`, '1|app,kind,format,schemaVersion,exportedAt,counts,data|{"primary":["chest"],"secondary":[]}');
  r = await ev((bk) => { const v = validateBackup(bk); const s = restoredState(v, state, { source: 'file' }); return `${v.ok}|${JSON.stringify(s.exercises) === JSON.stringify(state.exercises)}|${JSON.stringify(s.workouts) === JSON.stringify(state.workouts)}`; }, b);
  check('Q restore keeps exercises (incl. muscles) and workouts exactly', r, 'true|true|true');
  r = await ev((bk) => { const x = JSON.parse(JSON.stringify(bk)); x.data.exercises.forEach((e) => delete e.muscles); const v = validateBackup(x); return `${v.ok}|${v.state.exercises.some((e) => 'muscles' in e)}`; }, b);
  check('Q older backup without muscle settings: accepted, nothing added', r, 'true|false');
  await ev((bk) => { const x = JSON.parse(JSON.stringify(bk)); x.data.exercises.forEach((e) => delete e.muscles); state = restoredState(validateBackup(x), state, { source: 'file' }); save(); }, b);
  check('Q after restoring it, the built-in mapping applies', (await ev(() => T.m(7))).triceps, 1.5);
  // The real v32 app reads a backup that has a muscle setting and keeps it
  const site = path.join(os.tmpdir(), `v32-site-${scheme}-${width}`);
  fs.rmSync(site, { recursive: true, force: true }); fs.mkdirSync(site, { recursive: true });
  execSync(`git -C "${path.join(__dirname, '..', '..')}" archive ${V32} training-tracker | tar -x -C "${site}"`);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), site, String(OLD_PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up(OLD_PORT)); i++) await new Promise((res) => setTimeout(res, 100));
  try {
    const old = await ctx.newPage();
    old.on('pageerror', (e) => errors.push(`v32: ${e.message}`));
    await old.goto(`http://localhost:${OLD_PORT}/training-tracker/`);
    r = await old.evaluate((bk) => { const v = validateBackup(bk); const s = restoredState(v, state, { source: 'file' }); return `${v.ok}|${typeof muscleActivity}|${JSON.stringify(s.exercises.find((e) => e.name === 'Bench Press').muscles)}|${s.workouts.length}`; }, b);
    check('Q real v32 app restores it and keeps the muscle setting', r, 'true|undefined|{"primary":["chest"],"secondary":[]}|1');
    await old.close();
  } finally { server.kill(); }

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
