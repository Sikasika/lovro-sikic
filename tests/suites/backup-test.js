const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const fs = require('fs');
const SP = process.argv[2], scheme = process.argv[3] || 'light';
const DIR = `${SP}/backup-files`;
const KEY = 'training-tracker.v1';
const L = (s) => new Date(s).toISOString();
// Current data using every field added so far.
const rich = {
  schemaVersion: 2, cardioExercisesAdded: true, settings: { unit: 'lb', rest: 120 },
  exercises: [
    { id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'run', name: 'Running', category: 'Cardio' },
    { id: 'row', name: 'Barbell Row', category: 'Back' }, { id: 'padel', name: 'Padel', category: 'Sports' },
    { id: 'old', name: 'Old Machine', category: 'Legs', archived: true }, { id: 'sn', name: 'Snatch', category: 'Olympic' }],
  workouts: [
    { id: 'w2', name: 'Mixed', location: 'Gym A', notes: 'Good', templateId: 't1', start: L('2026-10-27T10:00:00'), end: L('2026-10-27T11:10:00'),
      entries: [
        { exerciseId: 'bench', note: 'Seat 4', superset: 's1', sets: [{ weight: 40, reps: '10', type: 'warmup', done: true }, { weight: 102.0582, reps: '5', target: { weight: 100, reps: 5 }, done: true }, { weight: 80, reps: '8', type: 'drop', done: true }] },
        { exerciseId: 'row', superset: 's1', sets: [{ weight: 60, reps: '10', done: true }] },
        { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 5000, duration: 1500, done: true }] }] },
    { id: 'w1', name: 'Legacy', location: '', notes: '', start: L('2026-10-20T10:00:00'), end: L('2026-10-20T11:00:00'),
      entries: [{ exerciseId: 'old', sets: [{ weight: '50', reps: '10', done: true }] }, { exerciseId: 'padel', sets: [{ weight: '', reps: '1', done: true }] }] }],
  templates: [
    { id: 't1', name: 'Push', location: 'Gym A', entries: [{ exerciseId: 'bench', note: 'Belt', superset: 'a', sets: [{ weight: 60, reps: 5, type: 'warmup' }, { weight: 100, reps: 5 }] }, { exerciseId: 'row', superset: 'a', sets: [{ weight: '', reps: 10 }] }] },
    { id: 't0', name: 'Old style', location: '', entries: [{ exerciseId: 'bench', sets: 3 }] }],
  active: { id: 'act', name: 'In progress', location: '', notes: '', start: L('2026-10-28T17:30:00'), entries: [{ exerciseId: 'bench', sets: [{ weight: 50, reps: '5', done: true }] }] }
};
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got).slice(0, 300)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
// Settings gain defaults for newer options (theme, plateau period) when the app loads older data.
const pick = (s) => JSON.stringify({ exercises: s.exercises, workouts: s.workouts, templates: s.templates, active: s.active, settings: { theme: 'system', plateauWeeks: 6, weightStepKg: 2.5, weightStepLb: 5, keepAwake: true, restSound: true, ...s.settings } });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.clock.setFixedTime(new Date('2026-10-28T18:00:00+01:00'));
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(rich)]);
  await page.goto('http://localhost:3000/training-tracker/');
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const wait = (ms = 300) => page.waitForTimeout(ms);
  const toSettings = async () => { await go(page, 'settings'); await wait(100); };
  const sheetText = async () => (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  const lastToast = () => page.evaluate(() => [...document.querySelectorAll('.toast')].pop()?.textContent || '');
  const chooseFile = async (path) => { await toSettings(); await page.setInputFiles('#import-file', path); await wait(400); };
  const write = (name, obj) => { const p = `${DIR}/${name}`; fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };

  const original = await stored();

  /* 1. Export a complete backup */
  await toSettings();
  check('settings shows not exported yet', (await page.innerText('#view')).includes('No backup from this device yet'), true);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
  const exportPath = `${DIR}/exported.json`;
  await dl.saveAs(exportPath);
  const exp = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  check('filename', dl.suggestedFilename(), 'training-backup-2026-10-28.json');
  check('format header', `${exp.app}|${exp.kind}|${exp.format}|${exp.schemaVersion}|${!!exp.exportedAt}`, 'training-tracker|backup|1|2|true');
  check('counts', JSON.stringify(exp.counts), JSON.stringify({ workouts: 2, templates: 2, exercises: 6, bodyweights: 0, plans: 0 }));
  check('backup holds everything (incl. new fields + workout in progress)', pick(exp.data), pick(original));
  await wait(200);
  check('success message', await lastToast(), 'Backup exported · 2 workouts');
  check('last exported shown', (await page.innerText('#view')).includes('Last successful backup 28 Oct 2026 (today)'), true);

  /* 2. Change data, then restore the exported file */
  page.removeAllListeners('dialog'); page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.click('[data-action=reset]'); await wait();
  check('erased', (await stored()).workouts.length, 0);
  check('undo available after erase', await page.$('[data-action=undo-restore]') !== null, true);
  await chooseFile(exportPath);
  let t = await sheetText();
  check('confirm shows backup contents', t.includes('2 workouts · 20 Oct 2026 – 27 Oct 2026') && t.includes('2 templates · 6 exercises') && t.includes('Units: lb · mi · Rest timer 120 s · includes a workout in progress'), true);
  check('confirm explains replacement', t.includes('0 workouts, 0 templates, 31 exercises and your settings on this device will be replaced'), true);
  check('copy toggle off when nothing to save', await page.getAttribute('[data-action=restore-toggle-copy]', 'aria-checked'), 'false');
  await page.click('[data-action=restore-confirm]'); await wait(500);
  let s = await stored();
  check('restored exactly', pick(s), pick(original));
  check('restore message', await lastToast(), 'Restored 2 workouts, 2 templates');
  for (const tab of ['workout', 'history', 'progress', 'statistics', 'settings']) { await go(page, tab); await wait(150); }
  await go(page, 'history'); await page.click('[data-action=open-workout][data-id="w2"]'); await wait();
  t = await sheetText();
  check('restored details render (lb, types, plan, note, superset, cardio)', ['Warm-up', 'Drop set', 'plan 220.5×5', 'Seat 4', 'SUPERSET A', '3.11 mi'].every((x) => t.toUpperCase().includes(x.toUpperCase())), true);
  await page.click('#sheet [data-action=close-sheet]');

  /* 3. Restoring over existing data: copy exported first, undo works */
  const older = { app: 'training-tracker', version: 1, exportedAt: '2026-01-05T10:00:00.000Z',  // legacy flat export, no schemaVersion (v1), lb
    exercises: [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'sq', name: 'Squat', category: 'Legs' }],
    workouts: [{ id: 'v1', name: 'Old days', start: '2026-01-04T10:00:00.000Z', end: '2026-01-04T11:00:00.000Z', entries: [{ exerciseId: 'bench', sets: [{ weight: '135', reps: '5', done: true }, { weight: '', reps: '8', done: true }] }] }],
    templates: [{ id: 'tt', name: 'Old tpl', location: '', entries: [{ exerciseId: 'sq', sets: 3 }] }],
    settings: { unit: 'lb', rest: 90 } };
  await chooseFile(write('older-v1.json', older));
  t = await sheetText();
  check('older backup accepted, labelled', t.includes('older-v1.json · exported 5 Jan 2026'), true);
  check('lb conversion explained', t.includes('stored weights in lb'), true);
  check('in-progress warning', t.includes('Your workout in progress will be replaced too'), true);
  check('copy toggle on when data exists', await page.getAttribute('[data-action=restore-toggle-copy]', 'aria-checked'), 'true');
  const [copy] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=restore-confirm]')]);
  await wait(500);
  const copyData = JSON.parse(fs.readFileSync(await copy.path(), 'utf8'));
  check('copy of current data exported before restore', `${copy.suggestedFilename()}|${pick(copyData.data) === pick(original)}`, 'training-before-restore-2026-10-28.json|true');
  s = await stored();
  check('older: weights converted to kg', s.workouts[0].entries[0].sets[0].weight, (v) => Math.abs(v - 135 * 0.45359237) < 1e-9);
  check('older: missing optional fields fine', `${s.templates.length}|${s.templates[0].entries[0].sets}|${s.active}|${s.settings.unit}`, '1|3|null|lb');
  check('older: Walking/Swimming added', ['Walking', 'Swimming'].every((n) => s.exercises.some((e) => e.name === n)), true);
  for (const tab of ['workout', 'history', 'progress', 'statistics', 'settings']) { await go(page, tab); await wait(150); }
  await go(page, 'workout'); await F.startTemplate(); await wait();
  check('old template still starts (3 sets)', await page.$$eval('#view .set-row', (r) => r.length), 3);

  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));
  await toSettings();
  await page.click('[data-action=undo-restore]'); await wait();
  check('undo confirm', (await sheetText()).toLowerCase().includes('data from before the last restore'), true);
  await page.click('[data-action=restore-toggle-copy]');
  await page.click('[data-action=restore-confirm]'); await wait(500);
  check('undo brings original back', pick(await stored()), pick(original));

  /* 4. Invalid files are rejected completely, with specific errors */
  const before = JSON.stringify(await stored());
  const bad = [
    ['not-json.json', 'this is not json {', 'not a backup file'],
    ['array.json', '[1,2,3]', 'does not contain Training Tracker data'],
    ['other-app.json', { app: 'something-else', exercises: [], workouts: [] }, 'different app'],
    ['newer.json', { app: 'training-tracker', format: 99, data: { exercises: [], workouts: [] } }, 'newer version'],
    ['no-workouts.json', { exercises: [] }, 'workout list is missing'],
    ['bad-date.json', { exercises: [{ id: 'a', name: 'A' }], workouts: [{ id: 'w', name: 'Broken', start: 'yesterday', entries: [] }] }, 'Workout 1 (“Broken”) has no valid date'],
    ['bad-number.json', { exercises: [{ id: 'a', name: 'A' }], workouts: [{ id: 'w', start: L('2026-10-01T10:00:00'), entries: [{ exerciseId: 'a', sets: [{ weight: 'heavy', reps: '5' }] }] }] }, 'set 1 has a value that isn\'t a number'],
    ['dupe.json', { exercises: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], workouts: [] }, 'appears twice'],
    ['truncated.json', { app: 'training-tracker', format: 1, schemaVersion: 2, counts: { workouts: 5, templates: 0, exercises: 1 }, data: { exercises: [{ id: 'a', name: 'A' }], workouts: [] } }, 'looks incomplete']
  ];
  for (const [name, content, msg] of bad) {
    await chooseFile(write(name, content));
    t = await sheetText();
    check(`rejects ${name}`, t.includes("Can't restore this file") && t.includes(msg) && t.includes('Nothing was changed'), true);
    await page.click('#sheet [data-action=close-sheet]');
  }
  check('nothing changed by invalid files', JSON.stringify(await stored()), before);

  /* 5. Cancel and warnings */
  await chooseFile(exportPath);
  await page.click('[data-action=restore-cancel]'); await wait(200);
  check('cancel: nothing changed + message', `${JSON.stringify(await stored()) === before}|${await lastToast()}`, 'true|Restore cancelled. Nothing was changed.');
  const orphan = { exercises: [{ id: 'a', name: 'A', category: 'Chest' }], workouts: [{ id: 'w', name: 'Orphan', start: L('2026-10-02T10:00:00'), end: L('2026-10-02T11:00:00'), entries: [{ exerciseId: 'gone', sets: [{ weight: 50, reps: '5', done: true }] }] }] };
  await chooseFile(write('orphan.json', orphan));
  check('missing exercise warned, not rejected', (await sheetText()).includes('will show as “Deleted exercise”'), true);
  await page.click('[data-action=restore-toggle-copy]');
  await page.click('[data-action=restore-confirm]'); await wait(500);
  await go(page, 'history'); await page.click('[data-action=open-workout]'); await wait();
  check('orphan shows as Deleted exercise', (await sheetText()).includes('Deleted exercise'), true);
  await page.click('#sheet [data-action=close-sheet]');
  await toSettings();
  await page.screenshot({ path: `${SP}/backup-${scheme}-settings.png` });
  await chooseFile(exportPath);
  await page.screenshot({ path: `${SP}/backup-${scheme}-confirm.png` });
  await page.click('[data-action=restore-cancel]');
  await chooseFile(`${DIR}/bad-date.json`);
  await page.screenshot({ path: `${SP}/backup-${scheme}-error.png` });
  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((x) => x.startsWith('FAIL')).length);
  await browser.close();
})();
