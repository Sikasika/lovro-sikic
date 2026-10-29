const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], scheme = process.argv[3] || 'light';
const KEY = 'training-tracker.v1';
const L = (s) => new Date(s).toISOString();
// Existing v2 user data from before this change: no Walking/Swimming, no cardio fields, an old reps-only run.
const seed = {
  schemaVersion: 2, templates: [], active: null, settings: { unit: 'kg', rest: 90 },
  exercises: [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'run', name: 'Running', category: 'Cardio' },
    { id: 'bike', name: 'Cycling', category: 'Cardio' }, { id: 'rowc', name: 'Rowing', category: 'Cardio' }, { id: 'brow', name: 'Barbell Row', category: 'Back' }],
  workouts: [{ id: 'old', name: 'Old run', location: '', notes: '', start: L('2026-10-20T07:00:00'), end: L('2026-10-20T07:40:00'),
    entries: [{ exerciseId: 'run', sets: [{ weight: '', reps: '1', done: true }] }] }]
};
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const close = (a, b) => Math.abs(a - b) < 1e-6;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.clock.setFixedTime(new Date('2026-10-28T18:00:00+01:00'));
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(seed)]);
  await page.goto('http://localhost:3000/training-tracker/');
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const wait = (ms = 350) => page.waitForTimeout(ms);
  const tab = async (t) => { await go(page, t); await wait(100); };
  const f = (e, s, fld) => `#view input[data-field=${fld}][data-entry="${e}"][data-set="${s}"]`;
  const addEx = async (q) => { await page.click('[data-action=add-exercise]'); await page.fill('#exercise-search', q); await page.click('[data-action=pick-exercise]'); };
  const tick = (e, s) => page.click(`[data-action=toggle-set][data-entry="${e}"][data-set="${s}"]`);
  const exId = async (name) => (await stored()).exercises.find((x) => x.name === name)?.id;
  const sheetText = async (wid) => { await tab('history'); await page.click(`[data-action=open-workout][data-id="${wid}"]`); await wait(); const t = await page.innerText('#sheet'); await page.click('#sheet [data-action=close-sheet]'); return t.replace(/\s+/g, ' '); };

  /* Existing data keeps working; new cardio exercises added once */
  let s = await stored();
  check('existing workouts untouched', JSON.stringify(s.workouts), JSON.stringify(seed.workouts));
  check('Walking + Swimming added', ['Walking', 'Swimming'].every((n) => s.exercises.some((e) => e.name === n && e.category === 'Cardio')), true);
  check('no duplicates', s.exercises.length, 7);
  check('old reps-only run still shown', (await sheetText('old')).includes('1 reps'), true);

  /* A. Mixed workout: run with distance+time (2 sets) and bench */
  await tab('workout');
  await F.startEmpty();
  await addEx('running');
  check('cardio columns', (await page.$$eval('#view .ex-card .set-head span', (t) => t.map((x) => x.textContent))).join('|'), 'Set|Previous|km|Time|✓');
  await page.click('[data-action=add-set][data-entry="0"]'); await page.click('[data-action=add-set][data-entry="0"]');
  await page.fill(f(0, 0, 'distance'), '5'); await page.fill(f(0, 0, 'duration'), '25'); await tick(0, 0);
  await page.fill(f(0, 1, 'distance'), '3'); await page.fill(f(0, 1, 'duration'), '15:30'); await tick(0, 1);
  await page.fill(f(0, 2, 'distance'), ''); await page.fill(f(0, 2, 'duration'), 'abc'); // unchecked, invalid time
  await addEx('bench');
  await page.fill(f(1, 0, 'weight'), '60'); await page.fill(f(1, 0, 'reps'), '8'); await tick(1, 0);
  s = await stored();
  check('5 km stored as 5000 m, 25 min as 1500 s', `${s.active.entries[0].sets[0].distance}|${s.active.entries[0].sets[0].duration}`, '5000|1500');
  check('15:30 parsed as 930 s', s.active.entries[0].sets[1].duration, 930);
  check('invalid time stored empty', s.active.entries[0].sets[2].duration, '');
  await page.click('[data-action=add-set][data-entry="1"]'); // re-render
  check('time re-rendered as mm:ss', await page.inputValue(f(0, 0, 'duration')), '25:00');
  await F.finish(); await wait();
  s = await stored();
  const mixed = s.workouts[0];
  check('mixed workout saved: run 2 sets + bench', `${mixed.entries[0].sets.length}+${mixed.entries[1].sets.length}`, '2+1');
  let t = await sheetText(mixed.id);
  check('history set 1', t.includes('5.00 km · 25:00 · 5:00 /km · 12 km/h'), true);
  check('history set 2', t.includes('3.00 km · 15:30 · 5:10 /km · 11.6 km/h'), true);
  check('history total', t.includes('Total 8.00 km · 40:30 · 5:04 /km · 11.9 km/h'), true);
  check('bench still weight × reps', t.includes('60 kg × 8'), true);

  /* B. Duration only (rowing), C. distance only (cycling), D. swimming, no invented values */
  await tab('workout'); await F.startEmpty();
  await addEx('rowing'); // Cardio "Rowing", not "Barbell Row"
  check('rowing uses metres', (await page.$$eval('#view .ex-card .set-head span', (t) => t.map((x) => x.textContent)))[2], 'm');
  await page.fill(f(0, 0, 'duration'), '20'); await tick(0, 0);
  await addEx('cycling');
  await page.fill(f(1, 0, 'distance'), '20'); await tick(1, 0);
  await addEx('swim');
  await page.fill(f(2, 0, 'distance'), '1500'); await page.fill(f(2, 0, 'duration'), '30'); await tick(2, 0);
  await addEx('running');
  check('running last time shown, no placeholders invented', `${(await page.$$eval('#view .ex-card[data-entry="3"] .prev', (p) => p.map((x) => x.textContent))).join(',')}|${await page.getAttribute(f(3, 0, 'distance'), 'placeholder')}`, '5.00 km 25:00,3.00 km 15:30|–');
  await page.fill(f(3, 0, 'duration'), '10'); await tick(3, 0);   // time only, distance left blank
  await F.finish(); await wait();
  s = await stored();
  const cardioOnly = s.workouts[0];
  const runSet = cardioOnly.entries[3].sets[0];
  check('blank distance not filled from last time', `${runSet.distance == null || runSet.distance === '' ? 'none' : runSet.distance}|${runSet.duration}`, 'none|600');
  t = await sheetText(cardioOnly.id);
  check('rowing duration only', /Rowing Cardio No previous session Set 1 20:00/.test(t), true);
  check('cycling distance only, no speed', /Cycling Cardio No previous session Set 1 20\.00 km(?! ·)/.test(t), true);
  check('swim pace per 100 m', t.includes('1,500 m · 30:00 · 2:00 /100 m'), true);
  check('run time only, no pace', /Running Cardio Previous .*? Set 1 10:00(?! ·)/.test(t), true);

  /* Statistics: cardio counted in mixed workouts, real values only */
  await tab('statistics');
  let v = (await page.innerText('#view')).replace(/\s+/g, ' ');
  check('cardio summary: workouts with cardio', /(\d+) Workouts with cardio/.exec(v)?.[1], 3);
  check('cardio summary: time logged (25+15.5+20+30+10 min)', /([\d:]+) Cardio time logged/.exec(v)?.[1], '1:40:30');
  check('running row', v.includes('Running 3 sessions · 8.00 km · 50:30 · avg 5:04 /km'), true);
  check('rowing row', v.includes('Rowing 1 session · 20:00'), true);
  check('cycling row (no speed without time)', /Cycling 1 session · 20\.00 km(?! ·)/.test(v), true);
  check('swimming row', v.includes('Swimming 1 session · 1,500 m · 30:00 · avg 2:00 /100 m'), true);
  await page.click('[data-saction=filter][data-v="cardio"]');
  const total = await page.$$eval('.stats-grid .stat', (els) => els.find((e) => e.querySelector('.lbl').textContent === 'Workouts').querySelector('.num').textContent.trim());
  check('cardio filter counts mixed workout', total, 3);
  await page.click('[data-saction=filter][data-v="all"]');
  await page.selectOption('#stats-perf-ex', 'run');
  check('running metrics', await page.$$eval('#stats-perf-metric option', (o) => o.map((x) => x.value).join()), 'distance,duration,pace,speed,reps,totalreps');
  v = (await page.innerText('#view')).replace(/\s+/g, ' ');
  check('PR distance 8.00 km', v.includes('8.00 km Distance'), true);
  check('PR fastest pace 5:04 /km', v.includes('5:04 /km Fastest pace'), true);
  check('PR duration 40:30 from sets in the mixed workout', v.includes('40:30 Duration'), true);
  await page.selectOption('#stats-perf-metric', 'duration');
  check('duration chart has old (40 min, run-only fallback) + new sessions', await page.$$eval('.stats-chart-title + svg .dot', (d) => d.length), 3);
  check('duration chart labels as clock (max 40:30, min 10:00)', (await page.$$eval('.stats-chart-title + svg .lbl', (l) => l.map((x) => x.textContent))).slice(0, 2).join(), '40:30,10:00');
  await page.selectOption('#stats-perf-metric', 'pace');
  check('pace with one session: asks for more data, nothing invented', (await page.innerText('#view')).includes('at least twice'), true);
  await page.selectOption('#stats-perf-ex', 'rowc');
  check('rowing: duration only', await page.$$eval('#stats-perf-metric option', (o) => o.map((x) => x.value).join()), 'duration');
  check('rowing note', (await page.textContent('#view')).includes('No distance logged for Rowing yet'), true);
  await page.selectOption('#stats-perf-ex', 'bike');
  check('cycling: distance only (no invented speed)', await page.$$eval('#stats-perf-metric option', (o) => o.map((x) => x.value).join()), 'distance');
  check('cycling hint', (await page.textContent('#view')).includes('Log distance and time in the same set to see speed'), true);

  /* Progress */
  await tab('progress');
  await page.selectOption('#progress-exercise', 'run');
  v = (await page.innerText('#view')).replace(/\s+/g, ' ');
  check('progress running cards', v.includes('8.00 km Longest') && v.includes('5:04 Best pace (/km)') && v.includes('3 Sessions'), true);

  /* Imperial: distance, pace, speed and weight all switch */
  await tab('settings'); await page.click('[data-action=unit][data-unit=lb]');
  t = await sheetText(mixed.id);
  check('imperial run total', t.includes('Total 4.97 mi · 40:30 · 8:09 /mi · 7.4 mph'), true);
  check('imperial weight', t.includes('132.3 lb × 8'), true);
  check('imperial swim', (await sheetText(cardioOnly.id)).includes('1,640 yd · 30:00 · 1:50 /100 yd'), true);
  await tab('workout'); await F.startEmpty(); await addEx('running');
  check('imperial column mi', (await page.$$eval('#view .ex-card .set-head span', (t) => t.map((x) => x.textContent)))[2], 'mi')
;
  await page.fill(f(0, 0, 'distance'), '2'); await page.fill(f(0, 0, 'duration'), '1:05:00');
  s = await stored();
  check('2 mi stored as metres, 1:05:00 as seconds', `${s.active.entries[0].sets[0].distance}|${s.active.entries[0].sets[0].duration}`, (x) => close(+x.split('|')[0], 2 * 1609.344) && x.split('|')[1] === '3900');
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));
  await tab('settings'); await page.click('[data-action=unit][data-unit=kg]');

  /* Templates with cardio targets */
  await tab('workout');
  await page.click('[data-action=new-template]'); await wait();
  await page.fill('#draft-name', 'Run day');
  await page.click('[data-action=draft-add-exercise]'); await page.fill('#exercise-search', 'running'); await page.click('[data-action=pick-exercise]');
  check('template prefilled from last run', await page.inputValue('#sheet input[data-tfield=duration][data-entry="0"][data-set="0"]'), '10:00');
  await page.fill('#sheet input[data-tfield=distance][data-entry="0"][data-set="0"]', '5');
  await page.fill('#sheet input[data-tfield=duration][data-entry="0"][data-set="0"]', '25');
  await page.click('[data-action=save-template]'); await wait();
  check('template stores cardio targets', JSON.stringify((await stored()).templates[0].entries[0].sets[0]), JSON.stringify({ weight: '', reps: '', distance: 5000, duration: 1500 }));
  await F.startTemplate();
  check('workout from template shows planned distance/time', `${await page.getAttribute(f(0, 0, 'distance'), 'placeholder')}|${await page.getAttribute(f(0, 0, 'duration'), 'placeholder')}`, '5|25:00');
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));

  /* Editing a saved cardio workout */
  await tab('history'); await page.click(`[data-action=open-workout][data-id="${mixed.id}"]`); await wait();
  await page.click('[data-action=edit-workout]'); await wait();
  check('editor shows cardio values', `${await page.inputValue('#sheet input[data-wfield=distance][data-entry="0"][data-set="1"]')}|${await page.inputValue('#sheet input[data-wfield=duration][data-entry="0"][data-set="1"]')}`, '3|15:30');
  await page.fill('#sheet input[data-wfield=distance][data-entry="0"][data-set="1"]', '4');
  await page.click('[data-action=save-wedit]'); await wait();
  check('edited total', (await page.innerText('#sheet')).replace(/\s+/g, ' ').includes('Total 9.00 km · 40:30'), true);
  check('bench untouched by edit', JSON.stringify((await stored()).workouts.find((w) => w.id === mixed.id).entries[1].sets[0]), JSON.stringify({ weight: 60, reps: '8', done: true }));
  await page.click('#sheet [data-action=close-sheet]');

  /* Deleted Walking is not re-added */
  await tab('settings'); await page.click('[data-action=manage-exercises]'); await wait();
  const walkId = await exId('Walking');
  await page.click(`[data-action=exm-edit][data-id="${walkId}"]`); await wait();
  await page.click('[data-action=exd-delete]'); await wait();
  await page.reload(); await wait();
  check('deleted Walking stays deleted after reload', (await stored()).exercises.some((e) => e.name === 'Walking'), false);
  await page.screenshot({ path: `${SP}/cardio-${scheme}-x.png` });
  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => r.startsWith('FAIL')).length);
  await browser.close();
})();
