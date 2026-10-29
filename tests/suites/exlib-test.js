const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], scheme = process.argv[3] || 'light';
const KEY = 'training-tracker.v1';
const L = (s) => new Date(s).toISOString();
const seed = {
  schemaVersion: 2, cardioExercisesAdded: true, active: null, settings: { unit: 'kg', rest: 90 },
  exercises: [
    { id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'run', name: 'Running', category: 'Cardio' },
    { id: 'tennis', name: 'Tennis', category: 'Other' }, { id: 'zer', name: 'Zercher Squat', category: 'Legs' },
    { id: 'snatch', name: 'Snatch', category: 'Olympic' } // custom category from older data
  ],
  templates: [{ id: 't1', name: 'Push', location: '', entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: 8 }] }] }],
  workouts: [
    { id: 'w1', name: 'Mixed', location: '', notes: '', start: L('2026-10-27T10:00:00'), end: L('2026-10-27T11:00:00'),
      entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: '8', done: true }] }, { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 5000, duration: 1500, done: true }] }] },
    { id: 'w2', name: 'Tennis', location: '', notes: '', start: L('2026-10-26T10:00:00'), end: L('2026-10-26T11:30:00'),
      entries: [{ exerciseId: 'tennis', sets: [{ weight: '', reps: '1', done: true }] }] }
  ]
};
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.clock.setFixedTime(new Date('2026-10-28T18:00:00+01:00'));
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(seed)]);
  await page.goto('http://localhost:3000/training-tracker/');
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const wait = (ms = 300) => page.waitForTimeout(ms);
  const tab = async (t) => { await go(page, t); await wait(100); };
  const sheet = async () => (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  const openManager = async () => { await tab('settings'); await page.click('[data-action=manage-exercises]'); await wait(); };
  const editEx = async (id) => { await page.click(`[data-action=exm-edit][data-id="${id}"]`); await wait(); };
  const history = async (wid) => { await tab('history'); await page.click(`[data-action=open-workout][data-id="${wid}"]`); await wait(); const t = await sheet(); await page.click('#sheet [data-action=close-sheet]'); return t; };
  const workoutsBefore = JSON.stringify(seed.workouts);

  /* Manager: groups, usage, custom category, search and chips */
  await openManager();
  let t = await sheet();
  check('usage: bench', t.includes('Bench Press Used in 1 workout, 1 template'), true);
  check('usage: unused', t.includes('Zercher Squat Not used yet'), true);
  check('custom category kept as group + chip', t.includes('OLYMPIC') && await page.$('[data-action=exm-cat][data-v="Olympic"]') !== null, true);
  check('Sports chip available', await page.$('[data-action=exm-cat][data-v="Sports"]') !== null, true);
  await page.fill('#exm-search', 'zer');
  check('search filters', await page.$$eval('#exm-list [data-action=exm-edit]', (r) => r.map((x) => x.dataset.id).join()), 'zer');
  await page.fill('#exm-search', '');
  await page.click('[data-action=exm-cat][data-v="Cardio"]');
  check('category chip filters', (await page.$$eval('#exm-list [data-action=exm-edit]', (r) => r.map((x) => x.dataset.id))).every((id) => !['bench', 'zer', 'tennis', 'snatch'].includes(id)), true);
  await page.click('[data-action=exm-cat][data-v="all"]');

  /* Rename: same id, history/templates/statistics show the new name, records unchanged */
  await editEx('bench');
  check('used exercise offers Archive, not Delete', `${!!(await page.$('[data-action=exd-archive]'))}|${!!(await page.$('[data-action=exd-delete]'))}`, 'true|false');
  check('explains why', (await sheet()).includes("can't be deleted without breaking those records"), true);
  await page.fill('#exd-name', 'Flat Bench Press');
  await page.click('[data-action=exd-save]'); await wait();
  let s = await stored();
  check('renamed in place', JSON.stringify(s.exercises.find((e) => e.id === 'bench')), JSON.stringify({ id: 'bench', name: 'Flat Bench Press', category: 'Chest' }));
  check('workout records unchanged by rename', JSON.stringify(s.workouts), workoutsBefore);
  await page.click('#sheet [data-action=close-sheet]');
  check('history shows new name', (await history('w1')).includes('Flat Bench Press Chest'), true);
  await tab('workout');
  check('template shows new name', (await page.innerText('#view .tpl-row')).includes('Flat Bench Press'), true);
  await tab('statistics');
  check('statistics shows new name', await page.$eval('#stats-perf-ex', (e) => [...e.options].map((o) => o.textContent).includes('Flat Bench Press')), true);

  /* Validation */
  await openManager(); await editEx('zer');
  await page.fill('#exd-name', 'running');
  let n = dialogs.length;
  await page.click('[data-action=exd-save]'); await wait(100);
  check('duplicate name refused', dialogs.slice(n).some((d) => d.includes('already an exercise called “Running”')), true);
  await page.fill('#exd-name', '   ');
  n = dialogs.length;
  await page.click('[data-action=exd-save]'); await wait(100);
  check('empty name refused', dialogs.slice(n).some((d) => d.includes('enter a name')), true);
  await page.click('[data-action=exd-cancel]'); await wait();
  check('cancel keeps original', (await stored()).exercises.find((e) => e.id === 'zer').name, 'Zercher Squat');

  /* Recategorize Other → Sports: Statistics follows */
  await editEx('tennis');
  await page.click('[data-action=exd-cat][data-v="Sports"]');
  await page.click('[data-action=exd-save]'); await wait();
  await page.click('#sheet [data-action=close-sheet]');
  await tab('statistics');
  await page.click('[data-saction=period][data-v="7d"]');
  const bd = await page.$$eval('.hbar', (els) => els.map((e) => e.querySelector('.hbar-top').innerText.replace(/\s+/g, ' ').trim()));
  check('breakdown counts Sports', bd.find((x) => x.startsWith('Sports')), 'Sports 1 · 50%');
  await page.click('[data-saction=filter][data-v="sports"]');
  check('Sports filter finds the workout', await page.$$eval('.stats-grid .stat', (els) => els.find((e) => e.querySelector('.lbl').textContent === 'Workouts').querySelector('.num').textContent.trim()), 1);
  await page.click('[data-saction=filter][data-v="all"]');
  check('workouts untouched by recategorizing', JSON.stringify((await stored()).workouts), workoutsBefore);

  /* Moving a cardio exercise out of Cardio warns and keeps its logged distance/time visible */
  await openManager(); await editEx('run');
  await page.click('[data-action=exd-cat][data-v="Other"]');
  check('warning about logged distance/time', (await sheet()).includes('Distance and time already logged stay in your history'), true);
  await page.click('[data-action=exd-save]'); await wait();
  await page.click('#sheet [data-action=close-sheet]');
  check('history still shows distance/time', (await history('w1')).includes('5.00 km · 25:00 · 5:00 /km · 12 km/h'), true);
  await tab('statistics');
  await page.selectOption('#stats-perf-ex', 'run');
  check('statistics still offers distance', (await page.$$eval('#stats-perf-metric option', (o) => o.map((x) => x.value))).includes('distance'), true);
  await openManager(); await editEx('run');
  await page.click('[data-action=exd-cat][data-v="Cardio"]');
  await page.click('[data-action=exd-save]'); await wait();
  await page.click('#sheet [data-action=close-sheet]');

  /* Create custom exercises (manager and picker), with categories */
  await openManager();
  await page.click('[data-action=exm-new]'); await wait();
  await page.fill('#exd-name', '  Hip   Thrust ');
  await page.click('[data-action=exd-cat][data-v="Legs"]');
  await page.click('[data-action=exd-save]'); await wait();
  check('created with tidy name + category', JSON.stringify((await stored()).exercises.filter((e) => e.name === 'Hip Thrust').map((e) => e.category)), '["Legs"]');
  await page.click('#sheet [data-action=close-sheet]');
  await tab('workout');
  await F.startEmpty();
  await page.click('[data-action=add-exercise]'); await wait();
  await page.fill('#exercise-search', 'Padel');
  await page.click('[data-action=create-exercise]'); await wait();
  check('picker category list has Sports', await page.$('[data-action=choose-category][data-category="Sports"]') !== null, true);
  await page.click('[data-action=choose-category][data-category="Sports"]'); await wait();
  check('created from picker into workout', await page.innerText('.ex-card .ex-name'), 'Padel');
  check('sports colour in workout', await page.$eval('.ex-card .act-dot', (d) => d.classList.contains('act-sports')), true);
  await page.click('[data-action=add-exercise]'); await wait();
  await page.click('[data-action=pick-cat][data-v="Legs"]');
  check('picker chip filter', await page.$$eval('#exercise-list [data-action=pick-exercise]', (r) => r.map((x) => x.textContent.trim()).join()), 'Hip Thrust,Zercher Squat');
  await page.fill('#exercise-search', 'hip');
  check('chip + search', await page.$$eval('#exercise-list [data-action=pick-exercise]', (r) => r.map((x) => x.textContent.trim()).join()), 'Hip Thrust');
  await page.click('#sheet [data-action=close-sheet]');
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));

  /* Delete unused; archive used; restore */
  await openManager(); await editEx('zer');
  await page.click('[data-action=exd-delete]'); await wait();
  check('unused exercise deleted', (await stored()).exercises.some((e) => e.id === 'zer'), false);
  await editEx('bench');
  await page.click('[data-action=exd-archive]'); await wait();
  check('archive confirm explains', dialogs[dialogs.length - 1].includes('Used in 1 workout, 1 template, and those records stay as they are'), true);
  s = await stored();
  check('archived, not deleted', `${s.exercises.find((e) => e.id === 'bench').archived}|${s.workouts.length}|${s.templates[0].entries[0].exerciseId}`, 'true|2|bench');
  check('archived listed separately', (await sheet()).includes('ARCHIVED Flat Bench Press'), true);
  await page.click('#sheet [data-action=close-sheet]');
  await tab('workout');
  await F.startEmpty();
  await page.click('[data-action=add-exercise]'); await wait();
  check('archived hidden from picker', await page.$('#exercise-list [data-id="bench"]'), null);
  await page.fill('#exercise-search', 'flat bench press');
  check('archived exact match explains', (await page.innerText('#exercise-list')).includes('is archived'), true);
  check('no duplicate create offered', await page.$('[data-action=create-exercise]'), null);
  await page.click('#sheet [data-action=close-sheet]');
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));
  check('history keeps archived exercise', /Flat Bench Press Chest .*?Set 1 60 kg × 8/.test(await history('w1')), true);
  await tab('workout');
  await F.startTemplate();
  check('template with archived exercise still starts', await page.innerText('.ex-card .ex-name'), 'Flat Bench Press');

  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));
  await tab('statistics');
  check('statistics lists archived exercise', await page.$eval('#stats-perf-ex', (e) => [...e.options].map((o) => o.textContent).includes('Flat Bench Press (archived)')), true);
  await openManager(); await editEx('bench');
  await page.click('[data-action=exd-restore]'); await wait();
  check('restored', 'archived' in (await stored()).exercises.find((e) => e.id === 'bench'), false);
  await page.screenshot({ path: `${SP}/exlib-${scheme}-manager.png` });
  await editEx('run'); await page.screenshot({ path: `${SP}/exlib-${scheme}-editor.png` });
  check('final: workouts never modified', JSON.stringify((await stored()).workouts), workoutsBefore);
  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => r.startsWith('FAIL')).length);
  await browser.close();
})();
