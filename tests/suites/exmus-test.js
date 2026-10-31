// Manual muscle groups in Add/Edit Exercise. Usage: node exmus-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const V34 = 'baf999a'; // the release before this feature
const OLD_PORT = 3230 + (scheme === 'dark' ? 2 : 0) + (width === 320 ? 1 : 0);
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const up = (port) => new Promise((res) => http.get(`http://localhost:${port}/training-tracker/`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  let dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.clock.setFixedTime(new Date('2026-11-25T18:00:00+01:00'));
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 150) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const sheet = async () => (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  const exNamed = (n) => ev((n) => JSON.parse(JSON.stringify(state.exercises.find((e) => e.name === n) || null)), n);
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#sheet *, #view *')].every((el) => el.offsetParent === null || el.closest('svg') || el.closest('.mf-hidden-buttons') || el.getBoundingClientRect().right <= window.innerWidth + 1));
  const chip = (role, id) => `#sheet [data-action=exd-mus][data-role=${role}][data-v="${id}"]`;
  const pressed = (role, id) => page.getAttribute(chip(role, id), 'aria-pressed');
  const sel = () => ev(() => ({ p: ui.exdraft.primary.join(','), s: ui.exdraft.secondary.join(',') }));
  const openNew = async () => { await ev(() => { openExerciseManager(); openExerciseEditor(null); }); await wait(); };
  const openEdit = async (n) => { await ev((n) => { openExerciseManager(); openExerciseEditor(state.exercises.find((e) => e.name === n).id); }, n); await wait(); };
  const saveEd = async () => { await page.click('#sheet [data-action=exd-save]'); await wait(); };
  const addWorkout = (entries, day = 24) => ev(([entries, day]) => { state.workouts.push({ id: `w${Math.random()}`, name: 'W', notes: '', start: `2026-11-${day}T08:00:00`, end: `2026-11-${day}T09:00:00`,
    entries: entries.map(([n, k]) => ({ exerciseId: state.exercises.find((e) => e.name === n).id, sets: Array.from({ length: k }, () => ({ weight: 50, reps: 8, done: true })) })) }); save(); }, [entries, day]);
  const act = () => ev(() => { const { items, today } = completedWorkouts(); const a = muscleActivity(items, today, 7); return { m: Object.fromEntries(Object.entries(a.muscles).map(([k, v]) => [k, v.weighted])), un: a.unmapped.map((x) => x.name) }; });
  const reset = () => ev(() => { localStorage.clear(); state = defaultState(); ui.mus = { days: 7, selected: null }; save(); closeSheet(); });

  /* A. The editor section */
  await reset();
  await openNew();
  let t = await sheet();
  check('A New Exercise has Muscle Groups with Primary and Secondary, all 17 groups each, the explanation', `${/muscle groups/i.test(t)}|${await page.$$eval('#sheet [data-role=p]', (x) => x.length)}|${await page.$$eval('#sheet [data-role=s]', (x) => x.length)}|${t.includes('Primary muscles receive full credit; secondary muscles receive half credit in the muscle activity overview.')}`, 'true|17|17|true');
  check('A same labels as the Muscles view', JSON.stringify(await page.$$eval('#sheet [data-role=p]', (x) => x.map((b) => b.textContent))), JSON.stringify(await ev(() => MUSCLE_GROUPS.map((g) => g.label))));
  check('A nothing selected for a new exercise; says it would be not mapped', `${(await sel()).p}|${(await sel()).s}|${t.includes('this exercise is not mapped')}`, '||true');
  check('A editor fits the screen', await noOverflow(), true);

  /* B. Selecting, deselecting, never both */
  await page.click(chip('p', 'chest')); await wait();
  check('B tap selects (visibly: pressed + highlighted)', `${await pressed('p', 'chest')}|${await ev(() => document.querySelector('#sheet [data-role=p][data-v=chest]').classList.contains('on'))}`, 'true|true');
  await page.click(chip('p', 'chest')); await wait();
  check('B tap again deselects', `${await pressed('p', 'chest')}|${(await sel()).p}`, 'false|');
  await page.click(chip('p', 'chest')); await page.click(chip('p', 'triceps')); await wait();
  await page.click(chip('s', 'triceps')); await wait();
  check('B choosing secondary removes it from primary', `${(await sel()).p}|${(await sel()).s}|${await pressed('p', 'triceps')}`, 'chest|triceps|false');
  await page.click(chip('p', 'triceps')); await wait();
  check('B and primary removes it from secondary', `${(await sel()).p}|${(await sel()).s}`, 'chest,triceps|');
  await page.click(chip('p', 'triceps')); await page.click(chip('s', 'front-delts')); await page.click(chip('s', 'triceps')); await wait();
  check('B multiple selections in both', `${(await sel()).p}|${(await sel()).s}`, 'chest|front-delts,triceps');

  /* C. Add with primary and secondary */
  await page.fill('#exd-name', 'Cable Crossover');
  await page.click('#sheet [data-action=exd-cat][data-v="Chest"]'); await wait();
  check('C category change keeps the selection', `${(await sel()).p}|${(await sel()).s}`, 'chest|front-delts,triceps');
  await saveEd();
  let ex = await exNamed('Cable Crossover');
  check('C saved on the exercise as { primary, secondary }', JSON.stringify(ex.muscles), JSON.stringify({ primary: ['chest'], secondary: ['front-delts', 'triceps'] }));
  const ccId = ex.id;

  /* D. Leaving an exercise unmapped; secondary only refused */
  await openNew();
  await page.fill('#exd-name', 'Landmine Press'); await saveEd();
  ex = await exNamed('Landmine Press');
  check('D saved without muscles: no assignment stored', `${!!ex}|${'muscles' in ex}`, 'true|false');
  await openNew();
  await page.fill('#exd-name', 'Sled Push'); await page.click(chip('s', 'quads')); await wait();
  t = await sheet();
  check('D secondary only: explained in the editor', t.includes('Choose at least one primary muscle'), true);
  dialogs = [];
  await saveEd();
  check('D secondary only: not saved, message shown', `${await exNamed('Sled Push')}|${dialogs[0] || ''}`, (v) => v.startsWith('null|Choose at least one primary muscle'));
  await ev(() => closeSheet());

  /* E. Muscles screen follows the assignment */
  await addWorkout([['Cable Crossover', 3], ['Landmine Press', 2]]);
  let a = await act();
  check('E assigned exercise counts right away: chest 3, front delts 1.5, triceps 1.5; unassigned one is not mapped', `${a.m.chest}|${a.m['front-delts']}|${a.m.triceps}|${a.un.join(',')}`, '3|1.5|1.5|Landmine Press');
  await openEdit('Landmine Press');
  await page.click(chip('p', 'front-delts')); await page.click(chip('s', 'upper-back')); await saveEd();
  a = await act();
  check('E after assigning it: counts, and leaves Not mapped', `${a.m['front-delts']}|${a.m['upper-back']}|${a.un.length}`, '3.5|1|0');
  await ev(() => { closeSheet(); ui.tab = 'muscles'; render(); }); await wait();
  check('E Muscles screen shows it immediately (no Not mapped entries)', `${await ev(() => document.querySelectorAll('.mus-unmapped').length)}|${await ev(() => document.querySelector('.mus-row[data-muscle=front-delts] .mus-val').textContent.trim())}`, '0|3.5');

  /* F. Editing existing assignments */
  await openEdit('Cable Crossover');
  check('F editor opens with the saved assignment', `${(await sel()).p}|${(await sel()).s}|${await pressed('p', 'chest')}|${await pressed('s', 'triceps')}`, 'chest|front-delts,triceps|true|true');
  await page.click(chip('s', 'triceps')); await page.click(chip('p', 'front-delts')); await saveEd();
  check('F edited assignment saved', JSON.stringify((await exNamed('Cable Crossover')).muscles), JSON.stringify({ primary: ['chest', 'front-delts'], secondary: [] }));

  /* G. Rename and recategorise keep the assignment; id unchanged */
  await openEdit('Cable Crossover');
  await page.fill('#exd-name', 'Cable Fly (high)'); await page.click('#sheet [data-action=exd-cat][data-v="Other"]'); await saveEd();
  ex = await exNamed('Cable Fly (high)');
  check('G rename + new category: assignment and id unchanged', `${ex.id === ccId}|${ex.category}|${JSON.stringify(ex.muscles)}`, `true|Other|${JSON.stringify({ primary: ['chest', 'front-delts'], secondary: [] })}`);
  // An assignment the app doesn't recognise is left exactly as it is when the editor doesn't touch it
  await ev(() => { state.exercises.find((e) => e.name === 'Leg Curl').muscles = { primary: ['hamstrings', 'calf-muscle'], note: 'kept' }; save(); });
  await openEdit('Leg Curl');
  await page.fill('#exd-name', 'Lying Leg Curl'); await saveEd();
  check('G an unrecognised stored assignment is never overwritten by editing other fields', JSON.stringify((await exNamed('Lying Leg Curl')).muscles), JSON.stringify({ primary: ['hamstrings', 'calf-muscle'], note: 'kept' }));

  /* H. Override and revert of built-in mappings */
  await addWorkout([['Bench Press', 2]]);
  await openEdit('Bench Press');
  t = await sheet();
  check('H Bench Press editor: nothing selected; shows that the built-in mapping applies', `${(await sel()).p}|${t.includes('the built-in mapping for “Bench Press” applies (Chest; secondary Triceps, Front delts)')}`, '|true');
  await page.click(chip('p', 'lats')); await wait();
  check('H selecting says it replaces the built-in mapping', (await sheet()).includes('This replaces the built-in mapping.'), true);
  await saveEd();
  a = await act();
  check('H manual assignment overrides the built-in one (Bench Press → lats only)', `${a.m.lats}|${a.m.chest}|${a.m.triceps}`, '2|3|0');
  await openEdit('Bench Press');
  await page.click('#sheet [data-action=exd-mus-clear]'); await wait();
  check('H clearing selects nothing and shows the built-in mapping again', `${(await sel()).p}|${(await sheet()).includes('the built-in mapping for “Bench Press” applies')}`, '|true');
  await saveEd();
  ex = await exNamed('Bench Press');
  a = await act();
  check('H after removing: no assignment stored; built-in mapping counts again', `${'muscles' in ex}|${a.m.chest}|${a.m.triceps}|${a.m.lats}`, 'false|5|1|0');
  await openEdit('Cable Fly (high)');
  await page.click('#sheet [data-action=exd-mus-clear]'); await saveEd();
  a = await act();
  check('H removing a custom exercise\'s assignment makes it not mapped again', `${'muscles' in (await exNamed('Cable Fly (high)'))}|${a.un.join(',')}`, 'false|Cable Fly (high)');

  /* I. Archived exercises keep their assignment */
  await ev(() => { state.exercises.find((e) => e.name === 'Landmine Press').archived = true; save(); });
  await openEdit('Landmine Press');
  await page.click('#sheet [data-action=exd-restore]'); await wait();
  await openEdit('Landmine Press');
  await page.click('#sheet [data-action=exd-archive]'); await wait();
  ex = await exNamed('Landmine Press');
  a = await act();
  check('I archive / restore / archive: assignment kept, still counts (front delts 2 from it + 1 from Bench Press)', `${ex.archived}|${JSON.stringify(ex.muscles)}|${a.m['front-delts']}|${a.m['upper-back']}`, `true|${JSON.stringify({ primary: ['front-delts'], secondary: ['upper-back'] })}|3|1`);

  /* J. Data safety */
  const workoutsBefore = await ev(() => JSON.stringify(state.workouts));
  await openEdit('Squat'); await page.click(chip('p', 'quads')); await saveEd();
  check('J editing exercises never changes workouts', await ev(() => JSON.stringify(state.workouts)) === workoutsBefore, true);
  check('J only exercises edited here have an assignment', await ev(() => state.exercises.filter((e) => 'muscles' in e).map((e) => e.name).sort().join(',')), 'Landmine Press,Lying Leg Curl,Squat');

  /* K. Backups */
  const b = await ev(() => buildBackup());
  check('K backup format unchanged; assignments exported as stored', `${Object.keys(b).join(',')}|${JSON.stringify(b.data.exercises.find((e) => e.name === 'Squat').muscles)}|${JSON.stringify(b.data.exercises.find((e) => e.name === 'Lying Leg Curl').muscles)}`,
    `app,kind,format,schemaVersion,exportedAt,counts,data|{"primary":["quads"],"secondary":[]}|{"primary":["hamstrings","calf-muscle"],"note":"kept"}`);
  let r = await ev((bk) => { const v = validateBackup(bk); const s = restoredState(v, state, { source: 'file' }); return `${v.ok}|${JSON.stringify(s.exercises) === JSON.stringify(state.exercises)}`; }, b);
  check('K restore keeps every exercise exactly (assignments, archived flag, ids)', r, 'true|true');
  // Real v34 app: makes a backup (one exercise with a hand-set assignment), which restores here; and it reads ours
  const site = path.join(os.tmpdir(), `v34-site-${scheme}-${width}`);
  fs.rmSync(site, { recursive: true, force: true }); fs.mkdirSync(site, { recursive: true });
  execSync(`git -C "${path.join(__dirname, '..', '..')}" archive ${V34} training-tracker | tar -x -C "${site}"`);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), site, String(OLD_PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up(OLD_PORT)); i++) await new Promise((res) => setTimeout(res, 100));
  let v34backup;
  try {
    const old = await ctx.newPage();
    old.on('pageerror', (e) => errors.push(`v34: ${e.message}`));
    await old.clock.setFixedTime(new Date('2026-11-25T18:00:00+01:00'));
    await old.goto(`http://localhost:${OLD_PORT}/training-tracker/`);
    v34backup = await old.evaluate(() => {
      state.exercises.find((e) => e.name === 'Dip').muscles = { primary: ['chest'], secondary: ['triceps'] };
      state.workouts.push({ id: 'old1', name: 'Old', notes: '', start: '2026-11-23T08:00:00', end: '2026-11-23T09:00:00', entries: [{ exerciseId: state.exercises.find((e) => e.name === 'Dip').id, sets: [{ weight: 0, reps: 10, done: true }, { weight: 0, reps: 10, done: true }] }] });
      save(); return buildBackup();
    });
    r = await old.evaluate((bk) => { const v = validateBackup(bk); const s = restoredState(v, state, { source: 'file' }); return `${v.ok}|${JSON.stringify(s.exercises.find((e) => e.name === 'Squat').muscles)}|${s.exercises.find((e) => e.name === 'Landmine Press').archived}`; }, b);
    check('K real v34 app restores a backup with assignments and keeps them', r, 'true|{"primary":["quads"],"secondary":[]}|true');
    await old.close();
  } finally { server.kill(); }
  r = await ev((bk) => { const v = validateBackup(bk); state = restoredState(v, state, { source: 'file' }); save(); const { items, today } = completedWorkouts(); const a = muscleActivity(items, today, 7); return `${v.ok}|${JSON.stringify(state.exercises.find((e) => e.name === 'Dip').muscles)}|${a.muscles.chest.weighted}|${a.muscles.triceps.weighted}|${state.exercises.filter((e) => 'muscles' in e).length}`; }, v34backup);
  check('K a v34 backup restores here: its assignment kept and used (Dip → chest 2, triceps 1); nothing added', r, 'true|{"primary":["chest"],"secondary":["triceps"]}|2|1|1');
  const plain = JSON.parse(JSON.stringify(v34backup)); plain.data.exercises.forEach((e) => delete e.muscles);
  r = await ev((bk) => { const v = validateBackup(bk); const s = restoredState(v, state, { source: 'file' }); return `${v.ok}|${s.exercises.some((e) => 'muscles' in e)}`; }, plain);
  check('K a backup without any assignments restores normally; none added', r, 'true|false');
  await openEdit('Dip');
  check('K restored assignment opens in the editor', `${(await sel()).p}|${(await sel()).s}`, 'chest|triceps');
  await ev(() => closeSheet());

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
