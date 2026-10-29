const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], scheme = process.argv[3] || 'light';
const KEY = 'training-tracker.v1';
const L = (s) => new Date(s).toISOString();
const seed = {
  schemaVersion: 2, cardioExercisesAdded: true, active: null, settings: { unit: 'kg', rest: 90 }, templates: [],
  exercises: [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'row', name: 'Barbell Row', category: 'Back' }, { id: 'squat', name: 'Squat', category: 'Legs' }],
  workouts: [{ id: 'old', name: 'Old', location: '', notes: '', start: L('2026-10-20T10:00:00'), end: L('2026-10-20T11:00:00'),
    entries: [{ exerciseId: 'bench', sets: [{ weight: 70, reps: '5', done: true }, { weight: 70, reps: '5', done: true }, { weight: 70, reps: '5', done: true }] }] }]
};
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(seed)]);
  await page.goto('http://localhost:3000/training-tracker/');
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const wait = (ms = 300) => page.waitForTimeout(ms);
  const tab = async (t) => { await go(page, t); await wait(100); };
  const f = (e, s, fld) => `#view input[data-field=${fld}][data-entry="${e}"][data-set="${s}"]`;
  const tick = (e, s) => page.click(`[data-action=toggle-set][data-entry="${e}"][data-set="${s}"]`);
  const addEx = async (q) => { await page.click('[data-action=add-exercise]'); await page.fill('#exercise-search', q); await page.click('[data-action=pick-exercise]'); await wait(); };
  const labels = (e) => page.$$eval(`#view .ex-card[data-entry="${e}"] .set-label`, (b) => b.map((x) => x.textContent.trim()).join(','));
  const setMenu = async (e, s, action, v) => { await page.click(`#view .set-label[data-entry="${e}"][data-set="${s}"]`); await wait(); await page.click(`#sheet [data-action=${action}]${v ? `[data-v="${v}"]` : ''}`); await wait(); };
  const menu = async (e, action) => { await page.click(`[data-action=entry-menu][data-entry="${e}"]`); await wait(); await page.click(`#sheet [data-action=${action}]`); await wait(); };
  const restVisible = () => page.isVisible('#sb-rest');
  const skipRest = async () => { if (await restVisible()) await page.click('[data-action=rest-skip]'); };
  const detail = async (id) => { await tab('history'); await page.click(`[data-action=open-workout]${id ? `[data-id="${id}"]` : ''}`); await wait(); const t = (await page.innerText('#sheet')).replace(/\s+/g, ' '); return t; };

  /* A. Normal workout: checkboxes, rest timer, workout timer, last-time autofill */
  await F.startEmpty();
  await addEx('bench');
  check('timer running', /^\d+:\d\d$/.test(await page.innerText('#elapsed')), true);
  check('last-time placeholder', await page.getAttribute(f(0, 0, 'weight'), 'placeholder'), '70');
  check('plain labels', await labels(0), '1,2,3');
  await tick(0, 0);
  check('rest timer starts on check', await restVisible(), true);
  await skipRest();
  await tick(0, 1); await skipRest();
  await F.finish(); await wait();
  let w = (await stored()).workouts[0];
  check('normal: autofilled from last time', JSON.stringify(w.entries[0].sets.map((s) => `${s.weight}x${s.reps}`)), '["70x5","70x5"]');
  check('normal: no new fields added', JSON.stringify(Object.keys(w.entries[0].sets[0]).sort()), '["done","reps","weight"]');

  /* B + C. Warm-up and drop sets, exercise note, reorder/delete via set menu */
  await tab('workout'); await F.startEmpty();
  await addEx('bench');
  await page.click('[data-action=add-set][data-entry="0"]'); await page.click('[data-action=add-set][data-entry="0"]'); // 4 sets... 
  await page.click('[data-action=add-set][data-entry="0"]');
  await setMenu(0, 0, 'set-type', 'warmup');
  await setMenu(0, 3, 'set-type', 'drop');
  check('labels W,1,2,D,3 (5 sets)', await labels(0), 'W,1,2,D,3');
  await setMenu(0, 4, 'set-delete');
  check('deleted extra set via menu', await labels(0), 'W,1,2,D');
  check('set count 4', await page.$$eval('#view .ex-card[data-entry="0"] .set-row', (r) => r.length), 4);
  await page.fill(f(0, 0, 'weight'), '40'); await page.fill(f(0, 0, 'reps'), '10');
  await page.fill(f(0, 1, 'weight'), '80'); await page.fill(f(0, 1, 'reps'), '5');
  await page.fill(f(0, 2, 'weight'), '85'); await page.fill(f(0, 2, 'reps'), '4');
  await page.fill(f(0, 3, 'weight'), '60'); await page.fill(f(0, 3, 'reps'), '8');
  await setMenu(0, 2, 'set-move', '');  // first set-move button = "Move set up": 85×4 before 80×5
  check('moved set keeps values', `${await page.inputValue(f(0, 1, 'weight'))},${await page.inputValue(f(0, 2, 'weight'))}`, '85,80');
  for (let j = 0; j < 4; j++) { await tick(0, j); await skipRest(); }
  await menu(0, 'entry-note');
  await page.fill('.ex-note-input[data-note="active"][data-entry="0"]', 'Seat 4, wide grip');
  await page.fill('#workout-notes', 'Good session overall');
  await F.finish(); await wait();
  w = (await stored()).workouts[0];
  check('types saved', JSON.stringify(w.entries[0].sets.map((s) => s.type || 'working')), '["warmup","working","working","drop"]');
  check('exercise note separate from workout note', `${w.entries[0].note}|${w.notes}`, 'Seat 4, wide grip|Good session overall');
  let t = await detail(w.id);
  check('history labels', /Warm-up 40 kg × 10 Set 1 85 kg × 4 .*?Set 2 80 kg × 5 .*?Drop set 60 kg × 8/.test(t), true);
  check('history note', t.includes('📝 Seat 4, wide grip'), true);
  check('volume excludes warm-up (340+400+480)', t.includes('1,220 Volume'), true);
  await page.click('#sheet [data-action=close-sheet]');
  await tab('statistics');
  await page.selectOption('#stats-perf-ex', 'bench');
  check('stats session volume excludes warm-up', (await page.innerText('#view')).includes('1,220 kg'), true);
  await tab('workout'); await F.startEmpty(); await addEx('bench');
  check('last note shown as reminder', (await page.innerText('#view .ex-hint')).includes('Last note: “Seat 4, wide grip”'), true);
  check('note not auto-copied', await page.$('.ex-note-input[data-note="active"]'), null);
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));

  /* D. Superset: link, badges, rest only after the round, history, repeat */
  await F.startEmpty();
  await addEx('bench'); await addEx('row');
  await menu(0, 'entry-link');
  check('both badged Superset A', await page.$$eval('#view .ss-badge', (b) => b.map((x) => x.textContent).join()), 'Superset A,Superset A');
  await page.fill(f(0, 0, 'weight'), '60'); await page.fill(f(0, 0, 'reps'), '8');
  await tick(0, 0);
  check('no rest after first exercise of superset', await restVisible(), false);
  await page.fill(f(1, 0, 'weight'), '50'); await page.fill(f(1, 0, 'reps'), '10');
  await tick(1, 0);
  check('rest after last exercise of the round', await restVisible(), true);
  await skipRest();
  await setMenu(1, 0, 'set-type', 'warmup');
  await F.finish(); await wait();
  w = (await stored()).workouts[0];
  check('superset saved', w.entries[0].superset && w.entries[0].superset === w.entries[1].superset, true);
  t = await detail(w.id);
  check('history shows one Superset A badge', (t.match(/SUPERSET A/gi) || []).length, 1);
  await page.click('#sheet [data-action=repeat]').then(F.begin); await wait();
  check('repeat keeps superset', await page.$$eval('#view .ss-badge', (b) => b.length), 2);
  check('repeat keeps set types', `${await labels(0)}|${await labels(1)}`, '1|W');
  check('repeat values empty', await page.inputValue(f(0, 0, 'weight')), '');
  /* E. Moving an exercise into the middle breaks the group cleanly */
  await addEx('squat');
  await menu(2, 'move-entry');
  check('group dissolved when split', await page.$$eval('#view .ss-badge', (b) => b.length), 0);
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));

  /* F. Template plan vs actual */
  await page.click('[data-action=new-template]'); await wait();
  await page.fill('#draft-name', 'Plan day');
  await page.click('[data-action=draft-add-exercise]'); await page.fill('#exercise-search', 'squat'); await page.click('[data-action=pick-exercise]'); await wait();
  const tf = (e, s, k) => `#sheet input[data-tfield=${k}][data-entry="${e}"][data-set="${s}"]`;
  await page.fill(tf(0, 0, 'weight'), '60'); await page.fill(tf(0, 0, 'reps'), '5');
  await page.fill(tf(0, 1, 'weight'), '100'); await page.fill(tf(0, 1, 'reps'), '5');
  await page.fill(tf(0, 2, 'weight'), '100'); await page.fill(tf(0, 2, 'reps'), '5');
  await page.click('#sheet .set-label[data-entry="0"][data-set="0"]'); await wait();
  await page.click('#sheet [data-action=set-type][data-v="warmup"]'); await wait();
  check('editor back after set menu', await page.isVisible('#sheet .template-editor'), true);
  await page.fill('.ex-note-input[data-note="draft"][data-entry="0"]', 'Belt on for working sets');
  await page.click('[data-action=save-template]'); await wait();
  const tpl = (await stored()).templates[0];
  check('template stores type + note', `${tpl.entries[0].sets[0].type}|${tpl.entries[0].note}`, 'warmup|Belt on for working sets');
  await F.startTemplate();
  check('plan shown as placeholders, warm-up first', `${await labels(0)}|${await page.getAttribute(f(0, 0, 'weight'), 'placeholder')}|${await page.getAttribute(f(0, 1, 'weight'), 'placeholder')}`, 'W,1,2|60|100');

  check('planned placeholders marked', await page.$$eval('#view input.planned', (i) => i.length), 6);
  check('template note carried in', await page.inputValue('.ex-note-input[data-note="active"]'), 'Belt on for working sets');
  await tick(0, 0); await skipRest();
  await page.fill(f(0, 1, 'weight'), '105'); await tick(0, 1); await skipRest();
  await tick(0, 2); await skipRest();
  await F.finish(); await wait();
  w = (await stored()).workouts[0];
  check('blank sets filled from plan', JSON.stringify(w.entries[0].sets.map((s) => `${s.weight}x${s.reps}`)), '["60x5","105x5","100x5"]');
  check('targets kept in history', JSON.stringify(w.entries[0].sets[1].target), JSON.stringify({ weight: 100, reps: 5 }));
  t = await detail(w.id);
  check('history shows plan only where it differs', t.includes('Set 1 105 kg × 5 plan 100×5') && !t.includes('Set 2 100 kg × 5 plan'), true);

  /* G. Editing a saved workout: set type, note, superset */
  await page.click('[data-action=edit-workout]'); await wait();
  await page.click('#sheet .set-label[data-entry="0"][data-set="2"]'); await wait();
  await page.click('#sheet [data-action=set-type][data-v="drop"]'); await wait();
  await page.fill('.ex-note-input[data-note="wedit"][data-entry="0"]', 'Edited note');
  await page.click('[data-action=save-wedit]'); await wait();
  w = (await stored()).workouts.find((x) => x.id === w.id);
  check('edit saved type + note, kept targets', `${w.entries[0].sets[2].type}|${w.entries[0].note}|${JSON.stringify(w.entries[0].sets[2].target)}`, 'drop|Edited note|{"weight":100,"reps":5}');
  await page.click('#sheet [data-action=close-sheet]');
  await tab('workout'); await F.startEmpty(); await addEx('bench'); await addEx('row');
  await menu(0, 'entry-link');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SP}/logging-${scheme}-superset.png` });
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));
  await tab('history'); await page.click('[data-action=open-workout]'); await wait(500);
  await page.screenshot({ path: `${SP}/logging-${scheme}-history.png` });
  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => r.startsWith('FAIL')).length);
  await browser.close();
})();
