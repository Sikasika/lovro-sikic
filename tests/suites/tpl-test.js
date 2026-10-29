const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], scheme = process.argv[3] || 'light';
const KEY = 'training-tracker.v1';
const exercises = [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'squat', name: 'Squat', category: 'Legs' },
  { id: 'row', name: 'Barbell Row', category: 'Back' }, { id: 'curl', name: 'Barbell Curl', category: 'Arms' }];
// Current (v2) data with a template in the OLD format: sets is just a count.
const seed = {
  schemaVersion: 2, exercises, active: null, settings: { unit: 'kg', rest: 90 },
  templates: [{ id: 'old1', name: 'Old Push', location: 'Gym A', entries: [{ exerciseId: 'bench', sets: 3 }, { exerciseId: 'row', sets: 2 }] }],
  workouts: [{ id: 'w1', name: 'Legs', start: '2026-10-27T09:00:00.000Z', end: '2026-10-27T10:00:00.000Z', notes: '', location: 'Home',
    entries: [{ exerciseId: 'squat', sets: [{ weight: 100, reps: '5', done: true }, { weight: 105, reps: '3', done: true }] }] }]
};
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const close = (a, b) => Math.abs(a - b) < 1e-9;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb' });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  const errors = [], dialogs = [];
  let dialogAnswer = true;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); dialogAnswer ? d.accept() : d.dismiss(); });
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(seed)]);
  await page.goto('http://localhost:3000/training-tracker/');
  await go(page, 'workout'); // the app opens on Today
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const wait = (ms = 350) => page.waitForTimeout(ms);
  const tfield = (e, s, f) => `#sheet input[data-tfield=${f}][data-entry="${e}"][data-set="${s}"]`;
  const wfield = (e, s, f) => `input[data-field=${f}][data-entry="${e}"][data-set="${s}"]`;

  /* 7. Old template is preserved and still works */
  check('old template untouched on load', JSON.stringify((await stored()).templates[0].entries), JSON.stringify(seed.templates[0].entries));
  check('old template tile shown', await page.textContent('#view .tpl-name'), 'Old Push');
  await F.startTemplate('#view [data-action=review][data-id=old1]');
  check('old template starts with 3 + 2 empty sets', JSON.stringify(await page.$$eval('.ex-card', (c) => c.map((x) => x.querySelectorAll('.set-row').length))), '[3,2]');
  check('no location field on screen or in the new workout', `${await page.$('#workout-location')}|${'location' in (await stored()).active}`, 'null|false');
  check('starting did not change old template', JSON.stringify((await stored()).templates[0]), JSON.stringify(seed.templates[0]));
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));

  /* 3/4. Edit the old template: targets, add/remove/reorder sets and exercises */
  await page.click('#view [data-action=edit-template][data-id=old1]'); await wait();
  check('editor shows 3 empty planned sets', await page.$$eval('#sheet input[data-tfield=weight][data-entry="0"]', (r) => r.length), 3);
  await page.fill(tfield(0, 0, 'weight'), '60'); await page.fill(tfield(0, 0, 'reps'), '8');
  await page.fill(tfield(0, 1, 'weight'), '70'); await page.fill(tfield(0, 1, 'reps'), '6');
  await page.fill(tfield(0, 2, 'reps'), '5');                      // weight left empty
  await page.click('[data-action=draft-add-set][data-entry="0"]'); // copies last set (– × 5)
  await page.fill(tfield(0, 3, 'weight'), '80'); await page.fill(tfield(0, 3, 'reps'), '3');
  await page.click('[data-action=draft-move-set][data-entry="0"][data-set="3"]'); // 80×3 above –×5
  await page.click('[data-action=draft-remove-set][data-entry="1"][data-set="1"]'); // row: 2 → 1 set
  check('cannot remove last set', await page.isDisabled('[data-action=draft-remove-set][data-entry="1"][data-set="0"]'), true);
  await page.fill(tfield(1, 0, 'reps'), '8.6');                   // rounds to 9
  await page.fill(tfield(1, 0, 'weight'), '-5');                  // invalid → empty
  // add Squat: pre-filled from last time (100×5, 105×3)
  await page.click('[data-action=draft-add-exercise]');
  await page.fill('#exercise-search', 'squat'); await page.click('[data-action=pick-exercise]');
  check('new exercise prefilled from last time', `${await page.inputValue(tfield(2, 0, 'weight'))}x${await page.inputValue(tfield(2, 0, 'reps'))},${await page.inputValue(tfield(2, 1, 'weight'))}x${await page.inputValue(tfield(2, 1, 'reps'))}`, '100x5,105x3');
  await page.click('[data-action=draft-move-ex][data-entry="2"][data-dir="-1"]'); // squat above row
  check('first exercise cannot move up', await page.isDisabled('[data-action=draft-move-ex][data-entry="0"][data-dir="-1"]'), true);
  // add & remove an exercise (with confirmation)
  await page.click('[data-action=draft-add-exercise]');
  await page.fill('#exercise-search', 'curl'); await page.click('[data-action=pick-exercise]');
  dialogAnswer = false;
  await page.click('[data-action=draft-remove][data-entry="3"]');
  check('remove exercise asks; cancel keeps it', await page.$$eval('#sheet .tpl-card', (c) => c.length), 4);
  dialogAnswer = true;
  await page.click('[data-action=draft-remove][data-entry="3"]');
  check('remove exercise after confirm', await page.$$eval('#sheet .tpl-card', (c) => c.length), 3);
  // scroll position kept after a change
  await page.$eval('#sheet .sheet-body', (b) => { b.scrollTop = 400; });
  const before = await page.$eval('#sheet .sheet-body', (b) => b.scrollTop);
  await page.$eval('[data-action=draft-add-set][data-entry="2"]', (b) => b.click()); // no auto-scroll
  check('editor keeps scroll position', await page.$eval('#sheet .sheet-body', (b) => b.scrollTop), (v) => v > 0 && Math.abs(v - before) < 2);
  await page.click('[data-action=draft-remove-set][data-entry="2"][data-set="1"]');
  await page.fill('#draft-name', 'Push & Legs');                  // rename
  check('template editor has no location field', await page.$('#draft-location'), null);
  await page.screenshot({ path: `${SP}/tpl-${scheme}-editor.png` });
  await page.click('[data-action=save-template]'); await wait();
  let t = (await stored()).templates[0];
  check('saved: name; old location kept in data', `${t.name}|${t.location}`, 'Push & Legs|Gym A');
  check('saved: exercise order', t.entries.map((e) => e.exerciseId).join(), 'bench,squat,row');
  check('saved: bench targets in order', JSON.stringify(t.entries[0].sets), JSON.stringify([{ weight: 60, reps: 8 }, { weight: 70, reps: 6 }, { weight: 80, reps: 3 }, { weight: '', reps: 5 }]));
  check('saved: squat targets', JSON.stringify(t.entries[1].sets), JSON.stringify([{ weight: 100, reps: 5 }, { weight: 105, reps: 3 }]));
  check('saved: row rounded reps, invalid weight empty', JSON.stringify(t.entries[2].sets), JSON.stringify([{ weight: '', reps: 9 }]));
  check('tile renamed', await page.textContent('#view [data-action=review][data-id=old1] .tpl-name'), 'Push & Legs');

  /* 2/6. Start from template: populated, and the workout never changes the template */
  const tplBefore = JSON.stringify((await stored()).templates);
  await F.startTemplate('#view [data-action=review][data-id=old1]');
  const vals = await page.$$eval('.ex-card', (cards) => cards.map((c) => [...c.querySelectorAll('.set-row')].map((r) => `${r.querySelector('[data-field=weight]').value}x${r.querySelector('[data-field=reps]').value}`)));
  check('values start empty (actual not yet done)', JSON.stringify(vals), JSON.stringify([['x', 'x', 'x', 'x'], ['x', 'x'], ['x']]));
  const plans = await page.$$eval('.ex-card', (cards) => cards.map((c) => [...c.querySelectorAll('.set-row')].map((r) => `${r.querySelector('[data-field=weight]').placeholder}x${r.querySelector('[data-field=reps]').placeholder}`)));
  check('targets shown as planned placeholders', JSON.stringify(plans), JSON.stringify([['60x8', '70x6', '80x3', 'x5'], ['100x5', '105x3'], ['x9']]));
  check('sets start unchecked', await page.$$eval('.set-row.done', (r) => r.length), 0);
  await page.fill(wfield(0, 0, 'weight'), '62.5');
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]');
  await page.click('[data-action=add-set][data-entry="0"]');
  await page.click('[data-action=entry-menu][data-entry="2"]'); await wait();
  await page.click('[data-action=remove-entry][data-entry="2"]');
  await page.fill('#workout-name', 'Changed name');

  check('editing the workout does not change template', JSON.stringify((await stored()).templates), tplBefore);
  await F.finish(); await wait();
  check('finishing does not change template', JSON.stringify((await stored()).templates), tplBefore);
  const fin = (await stored()).workouts[0];
  check('finished workout has checked set at 62.5', `${fin.entries[0].sets.length}:${fin.entries[0].sets[0].weight}`, '1:62.5');
  check('finished workout linked to template', fin.templateId, 'old1');

  /* Units: targets are stored in kg and shown in the selected unit */
  await go(page, 'settings'); await page.click('[data-action=unit][data-unit=lb]');
  await go(page, 'workout');
  await page.click('#view [data-action=edit-template][data-id=old1]'); await wait();
  check('editor shows targets in lb', await page.inputValue(tfield(0, 0, 'weight')), '132.28');
  check('column says lb', (await page.textContent('#sheet .tpl-sets th:nth-child(2)')).trim(), 'Target lb');
  await page.fill(tfield(0, 0, 'weight'), '135');
  await page.click('[data-action=save-template]'); await wait();
  check('135 lb target stored as kg', (await stored()).templates[0].entries[0].sets[0].weight, (v) => close(v, 135 * 0.45359237));
  await F.startTemplate('#view [data-action=review][data-id=old1]');
  check('workout shows 135 lb plan', await page.getAttribute(wfield(0, 0, 'weight'), 'placeholder'), '135');
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));
  await go(page, 'settings'); await page.click('[data-action=unit][data-unit=kg]'); await go(page, 'workout');

  /* Cancel: unsaved changes ask first; unchanged editor closes silently */
  const n0 = dialogs.length;
  await page.click('#view [data-action=edit-template][data-id=old1]'); await wait();
  await page.click('[data-action=cancel-template]'); await wait();
  check('cancel without changes: no prompt', dialogs.length, n0);
  await page.click('#view [data-action=edit-template][data-id=old1]'); await wait();
  await page.fill('#draft-name', 'Should not save');
  dialogAnswer = false;
  await page.click('#sheet-backdrop', { position: { x: 20, y: 20 } }); await wait(100);
  check('backdrop with changes asks and stays open', await page.isVisible('#sheet .template-editor'), true);
  dialogAnswer = true;
  await page.click('[data-action=cancel-template]'); await wait();
  check('discarded edit not saved', (await stored()).templates[0].name, 'Push & Legs');

  /* 5. Create new, save from workout and from history, delete */
  await page.click('[data-action=new-template]'); await wait();
  await page.fill('#draft-name', 'Pull Day');

  await page.click('[data-action=draft-add-exercise]'); await page.fill('#exercise-search', 'row'); await page.click('[data-action=pick-exercise]');
  check('exercise without history gets 3 empty sets', await page.$$eval('#sheet .tpl-card tbody tr', (r) => r.length), 3);
  await page.click('[data-action=save-template]'); await wait();
  check('new template saved with empty targets', JSON.stringify((await stored()).templates.find((x) => x.name === 'Pull Day').entries[0].sets), JSON.stringify([{ weight: '', reps: '' }, { weight: '', reps: '' }, { weight: '', reps: '' }]));
  // Save as template from a workout in progress (keeps typed values, checked or not)
  await F.startEmpty();
  await page.click('[data-action=add-exercise]'); await page.fill('#exercise-search', 'curl'); await page.click('[data-action=pick-exercise]');
  await page.fill(wfield(0, 0, 'weight'), '30'); await page.fill(wfield(0, 0, 'reps'), '12');
  await page.fill('#workout-name', 'Arms');
  await page.click('[data-action=save-active-template]');
  check('save from workout keeps targets', JSON.stringify((await stored()).templates.find((x) => x.name === 'Arms').entries[0].sets), JSON.stringify([{ weight: 30, reps: 12 }, { weight: '', reps: '' }, { weight: '', reps: '' }]));
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500));
  // Save from history
  await go(page, 'history');
  await page.click('[data-action=open-workout][data-id=w1]'); await wait();
  await page.click('[data-action=save-history-template]');
  await page.click('#sheet [data-action=close-sheet]');
  check('save from history keeps sets', JSON.stringify((await stored()).templates.find((x) => x.name === 'Legs').entries[0].sets), JSON.stringify([{ weight: 100, reps: 5 }, { weight: 105, reps: 3 }]));
  await go(page, 'workout'); await wait(2300);
  await page.screenshot({ path: `${SP}/tpl-${scheme}-home.png` });
  const id = (await stored()).templates.find((x) => x.name === 'Pull Day').id;
  await page.click(`#view [data-action=edit-template][data-id="${id}"]`); await wait();

  await page.click('[data-action=delete-template]'); await wait();
  check('delete template', (await stored()).templates.some((x) => x.name === 'Pull Day'), false);
  check('past workouts kept after delete', (await stored()).workouts.length, 2);

  /* Old-format templates in an imported backup also work */
  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => r.startsWith('FAIL')).length);
  await browser.close();
})();
