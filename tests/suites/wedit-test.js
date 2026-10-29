const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], scheme = process.argv[3] || 'light';
const KEY = 'training-tracker.v1';
const L = (s) => new Date(s).toISOString();
const st = (w, r) => ({ weight: w, reps: String(r), done: true });
const exercises = [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'squat', name: 'Squat', category: 'Legs' },
  { id: 'row', name: 'Barbell Row', category: 'Back' }];
const seed = {
  schemaVersion: 2, exercises, templates: [], active: null, settings: { unit: 'kg', rest: 90 },
  workouts: [
    { id: 'w1', name: 'Push', location: 'Gym A', notes: 'ok', templateId: 't9', start: L('2026-10-27T10:00:00'), end: L('2026-10-27T11:00:00'),
      entries: [{ exerciseId: 'bench', sets: [st(60, 8), st(70, 5)] }] },
    { id: 'w2', name: 'Legs', location: '', notes: '', start: L('2026-10-20T10:00:00'), end: L('2026-10-20T11:00:00'),
      entries: [{ exerciseId: 'squat', sets: [st(100, 5)] }] },
    { id: 'w3', name: 'Old bench', location: '', notes: '', start: '2026-10-13T08:00:37.123Z', end: '2026-10-13T09:01:05.456Z',
      entries: [{ exerciseId: 'bench', sets: [st('50', 10)] }] }
  ]
};
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const close = (a, b) => Math.abs(a - b) < 1e-9;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  const errors = [], dialogs = [];
  let answer = true;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await page.clock.setFixedTime(new Date('2026-10-28T18:00:00+01:00'));
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(seed)]);
  await page.goto('http://localhost:3000/training-tracker/');
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const wait = (ms = 350) => page.waitForTimeout(ms);
  const wf = (e, s, f) => `#sheet input[data-wfield=${f}][data-entry="${e}"][data-set="${s}"]`;
  const tab = async (t) => { await go(page, t); await wait(100); };
  const openDetail = async (id) => { await tab('history'); await page.click(`[data-action=open-workout][data-id=${id}]`); await wait(); };
  const openEditor = async (id) => { await openDetail(id); await page.click('[data-action=edit-workout]'); await wait(); };
  const historyNames = () => page.$$eval('[data-action=open-workout] .hist-name', (d) => d.map((x) => x.textContent.trim()));
  const pstat = (l) => page.$$eval('.stats .stat', (els, l) => els.find((e) => e.querySelector('.lbl').textContent === l)?.querySelector('.num').textContent, l);
  const sstat = (l) => page.$$eval('.stats-grid .stat', (els, l) => els.find((e) => e.querySelector('.lbl').textContent === l)?.querySelector('.num').textContent.trim(), l);

  // Baseline in Progress / Statistics
  await tab('progress');
  check('before: progress this week', await page.$eval('.compare tbody tr:first-child td', (td) => td.textContent.trim()), 1);
  check('before: progress heaviest', await pstat('Heaviest (kg)'), 70);

  /* 1/2. Edit button and prefilled editor */
  await openEditor('w1');
  check('editor open', await page.isVisible('#sheet .workout-editor'), true);
  check('prefilled date/start/end', `${await page.inputValue('#wedit-date')} ${await page.inputValue('#wedit-start')} ${await page.inputValue('#wedit-end')}`, '2026-10-27 10:00 11:00');
  check('duration shown', await page.textContent('#wedit-duration'), 'Duration 1:00:00');
  check('prefilled sets', `${await page.inputValue(wf(0, 0, 'weight'))}x${await page.inputValue(wf(0, 0, 'reps'))},${await page.inputValue(wf(0, 1, 'weight'))}x${await page.inputValue(wf(0, 1, 'reps'))}`, '60x8,70x5');
  check('no location field; notes prefilled', `${await page.$('#wedit-location')}|${await page.inputValue('#wedit-notes')}`, 'null|ok');

  /* 6. Cancel without changes: no prompt, back to details */
  let n = dialogs.length;
  await page.click('[data-action=cancel-wedit]'); await wait();
  check('cancel unchanged: no prompt', dialogs.length, n);
  check('cancel returns to details', await page.isVisible('#sheet [data-action=edit-workout]'), true);

  /* 6. Cancel with changes asks; discarding keeps the original */
  const original = JSON.stringify((await stored()).workouts);
  await page.click('[data-action=edit-workout]'); await wait();
  await page.fill(wf(0, 0, 'weight'), '999');
  await page.fill('#wedit-notes', 'not saved');
  answer = false;
  await page.click('[data-action=cancel-wedit]'); await wait(100);
  check('cancel with changes asks, stays open when declined', await page.isVisible('#sheet .workout-editor'), true);
  await page.click('#sheet-backdrop', { position: { x: 20, y: 20 } }); await wait(100);
  check('backdrop also asks', await page.isVisible('#sheet .workout-editor'), true);
  answer = true;
  await page.click('[data-action=cancel-wedit]'); await wait();
  check('discarded: storage unchanged', JSON.stringify((await stored()).workouts), original);
  check('discarded: details show original', (await page.textContent('#sheet')).includes('60 kg × 8') && !(await page.textContent('#sheet')).includes('999'), true);

  /* 2/3. Real edit: date, times, location, notes, sets, exercises */
  await page.click('[data-action=edit-workout]'); await wait();
  await page.fill('#wedit-name', 'Push (edited)');
  await page.fill('#wedit-date', '2026-10-19');
  await page.fill('#wedit-start', '18:15');
  await page.fill('#wedit-end', '19:45');
  check('duration updates live', await page.textContent('#wedit-duration'), 'Duration 1:30:00');

  await page.fill('#wedit-notes', 'Heavy day');
  await page.fill(wf(0, 0, 'weight'), '90'); await page.fill(wf(0, 0, 'reps'), '2');      // new PR
  await page.click('[data-action=wedit-add-set][data-entry="0"]');                         // copy of 70×5
  await page.fill(wf(0, 2, 'weight'), '75'); await page.fill(wf(0, 2, 'reps'), '4');
  await page.click('[data-action=wedit-move-set][data-entry="0"][data-set="2"]');          // 75×4 before 70×5
  await page.click('[data-action=wedit-remove-set][data-entry="0"][data-set="2"]');        // remove 70×5
  await page.click('[data-action=wedit-add-exercise]');
  await page.fill('#exercise-search', 'row'); await page.click('[data-action=pick-exercise]');
  check('added exercise has 3 empty sets', await page.$$eval('#sheet input[data-wfield=weight][data-entry="1"]', (x) => x.length), 3);
  await page.fill(wf(1, 0, 'weight'), '50'); await page.fill(wf(1, 0, 'reps'), '10');       // sets 2 and 3 left empty
  await page.click('[data-action=wedit-move-ex][data-entry="1"][data-dir="-1"]');          // row first
  await page.screenshot({ path: `${SP}/wedit-${scheme}-editor.png` });
  await page.click('[data-action=save-wedit]'); await wait();
  let s = await stored();
  const w1 = s.workouts.find((w) => w.id === 'w1');
  check('saved in place: still 3 workouts', s.workouts.length, 3);
  check('same id kept, extra fields kept', `${w1.id}|${w1.templateId}`, 'w1|t9');
  check('saved name/notes; old location kept in data', `${w1.name}|${w1.location}|${w1.notes}`, 'Push (edited)|Gym A|Heavy day');
  check('saved start/end (local)', `${w1.start}|${w1.end}`, `${L('2026-10-19T18:15:00')}|${L('2026-10-19T19:45:00')}`);
  check('saved exercise order', w1.entries.map((e) => e.exerciseId).join(), 'row,bench');
  check('empty sets dropped', w1.entries[0].sets.length, 1);
  check('saved bench sets', JSON.stringify(w1.entries[1].sets), JSON.stringify([{ weight: 90, reps: '2', done: true }, { weight: 75, reps: '4', done: true }]));
  check('history sorted by new date', JSON.stringify(await historyNames()), JSON.stringify(['Legs', 'Push (edited)', 'Old bench']));
  check('workout appears once in History', (await historyNames()).filter((x) => x.startsWith('Push')).length, 1);
  check('details show update (no location shown)', (await page.textContent('#sheet')).includes('90 kg × 2') && !(await page.textContent('#sheet')).includes('Gym'), true);
  await page.click('#sheet [data-action=close-sheet]');

  /* 5. Progress and Statistics reflect the edit */
  await tab('progress');
  check('progress this week now 0 (moved to last week)', await page.$eval('.compare tbody tr:first-child td', (td) => td.textContent.trim()), 0);
  check('progress total unchanged', await pstat('Total workouts'), 3);
  check('progress heaviest 90', await pstat('Heaviest (kg)'), 90);
  check('progress best e1RM 96 (90×2)', await pstat('Best est. 1RM'), 96);
  await tab('statistics');
  check('stats heatmap: Oct 19 now has workouts, Oct 27 empty', `${!!(await page.getAttribute('[data-day="2026-10-19"]', 'style'))?.includes('heat-')}|${await page.getAttribute('[data-day="2026-10-27"]', 'class')}`, 'true|heat-cell empty');
  await page.click('[data-saction=period][data-v="all"]');
  check('stats total 3', await sstat('Workouts'), 3);
  check('stats this week 0', await sstat('This week'), 0);
  check('stats time 3.5 h (1.5 + 1 + 1)', await sstat('Training time'), '3.5 h');
  await page.selectOption('#stats-perf-ex', 'bench');
  const sv = await page.textContent('#view');
  check('stats PR heaviest 90 kg × 2', sv.includes('90 kg × 2'), true);
  check('stats PR volume stays 500 (Old bench 50×10 beats 480)', sv.includes('500 kg'), true);
  await page.click('[data-day="2026-10-19"]'); await wait();
  check('stats day sheet shows edited workout + volume 980 (row 500 + bench 480)', (await page.textContent('#sheet')).includes('Push (edited)') && (await page.textContent('#sheet')).includes('980 kg volume'), true);
  await page.click('#sheet [data-action=close-sheet]');

  /* Midnight crossing, removing end time, untouched timestamps */
  await openEditor('w2');
  await page.fill('#wedit-start', '22:00'); await page.fill('#wedit-end', '00:30');
  check('past midnight shown', await page.textContent('#wedit-duration'), 'Duration 2:30:00 · ends the next day');
  await page.click('[data-action=save-wedit]'); await wait();
  s = await stored();
  check('end on next day', s.workouts.find((w) => w.id === 'w2').end, L('2026-10-21T00:30:00'));
  await page.click('[data-action=edit-workout]'); await wait();
  await page.fill('#wedit-end', '');
  check('no end time text', await page.textContent('#wedit-duration'), 'No end time · duration unknown');
  await page.click('[data-action=save-wedit]'); await wait();
  s = await stored();
  check('end removed', 'end' in s.workouts.find((w) => w.id === 'w2'), false);
  check('details show – duration', await page.$eval('#sheet .hist-metrics .bw-metric-v', (e) => e.textContent), '–');
  await page.click('#sheet [data-action=close-sheet]');
  check('no NaN in History', (await page.textContent('#view')).includes('NaN'), false);
  await openEditor('w3');
  await page.fill('#wedit-notes', 'note only');
  await page.click('[data-action=save-wedit]'); await wait();
  s = await stored();
  const w3 = s.workouts.find((w) => w.id === 'w3');
  check('untouched times keep exact original timestamps', `${w3.start}|${w3.end}`, '2026-10-13T08:00:37.123Z|2026-10-13T09:01:05.456Z');
  check('untouched set values unchanged', `${w3.entries[0].sets[0].weight}x${w3.entries[0].sets[0].reps}`, '50x10');
  await page.click('#sheet [data-action=close-sheet]');

  /* Validation: future date, all sets empty */
  const w3Before = JSON.stringify((await stored()).workouts.find((w) => w.id === 'w3'));
  await openEditor('w3');
  await page.fill('#wedit-date', '2026-11-05');
  n = dialogs.length;
  await page.click('[data-action=save-wedit]'); await wait(100);
  check('future date blocked', dialogs.slice(n).some((d) => d.includes('future')) && (await page.isVisible('#sheet .workout-editor')), true);
  await page.fill('#wedit-date', '2026-10-13');
  await page.fill(wf(0, 0, 'weight'), ''); await page.fill(wf(0, 0, 'reps'), '');
  n = dialogs.length;
  await page.click('[data-action=save-wedit]'); await wait(100);
  check('all-empty workout blocked', dialogs.slice(n).some((d) => d.includes('at least one set')), true);
  await page.click('[data-action=cancel-wedit]'); await wait();
  check('blocked edits not saved', JSON.stringify((await stored()).workouts.find((w) => w.id === 'w3')), w3Before);
  await page.click('#sheet [data-action=close-sheet]');

  /* Units: editing in lb */
  await tab('settings'); await page.click('[data-action=unit][data-unit=lb]');
  await openEditor('w1');
  check('editor shows lb', await page.inputValue(wf(1, 0, 'weight')), '198.42');
  await page.fill(wf(1, 0, 'weight'), '200');
  await page.click('[data-action=save-wedit]'); await wait();
  check('200 lb stored as kg', (await stored()).workouts.find((w) => w.id === 'w1').entries[1].sets[0].weight, (v) => close(v, 200 * 0.45359237));
  await page.click('#sheet [data-action=close-sheet]');
  await tab('settings'); await page.click('[data-action=unit][data-unit=kg]');

  /* 7. Repeat and delete still work */
  await openDetail('w1');
  await page.click('[data-action=repeat]'); await F.begin();

  check('repeat starts workout with edited exercises', JSON.stringify(await page.$$eval('.ex-name', (e) => e.map((x) => x.textContent))), JSON.stringify(['Barbell Row', 'Bench Press']));
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));
  await openDetail('w2');
  await page.click('[data-action=delete-workout]'); await wait();
  s = await stored();
  check('delete still works', s.workouts.map((w) => w.id).join(), 'w1,w3');
  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => r.startsWith('FAIL')).length);
  await browser.close();
})();
