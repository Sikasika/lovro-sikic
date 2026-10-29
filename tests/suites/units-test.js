const { chromium, devices } = require('playwright');
const fs = require('fs');
const SP = process.argv[2];
const KEY = 'training-tracker.v1', BACKUP = 'training-tracker.v1.backup-before-v2';
const L = (s) => new Date(s).toISOString();
const set = (w, r) => ({ weight: w === '' ? '' : String(w), reps: String(r), done: true });
const W = (id, name, start, end, entries) => ({ id, name, start: L(start), end: L(end), notes: '', entries });
const E = (exerciseId, sets) => ({ exerciseId, sets });
const exercises = [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'squat', name: 'Squat', category: 'Legs' },
  { id: 'pullup', name: 'Pull-up', category: 'Back' }, { id: 'run', name: 'Running', category: 'Cardio' }];
// A v1 data file exactly as the old app saved it (no schemaVersion, weights as typed strings).
const v1 = (unit, workouts, active = null) => ({ exercises, workouts, templates: [{ id: 't1', name: 'Push', location: '', entries: [{ exerciseId: 'bench', sets: 3 }] }], active, settings: { unit, rest: 90 } });
const lbWorkouts = [
  W('w2', 'Heavy', '2026-10-27T10:00', '2026-10-27T11:00', [E('bench', [set(135, 5), set(185.5, 3)]), E('squat', [set(225, 5)])]),
  W('w1', 'Light', '2026-10-20T10:00', '2026-10-20T11:00', [E('bench', [set(95, 10), set('', 8)])])
];

const results = [];
const check = (name, got, want) => {
  const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`);
};
const close = (a, b) => Math.abs(a - b) < 1e-9;

async function session(browser, seed) {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  page.errors = [];
  page.alerts = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Could not load data/.test(m.text()) && page.errors.push(m.text()));
  page.on('dialog', (d) => { page.alerts.push(d.message()); d.accept(); });
  await page.clock.setFixedTime(new Date('2026-10-28T18:00:00+01:00'));
  if (seed !== undefined) await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, seed]);
  await page.goto('http://localhost:3000/training-tracker/');
  return page;
}
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
const text = (page) => page.textContent('#view');
const tab = async (page, t) => { await page.click(`[data-tab=${t}]`); await page.waitForTimeout(100); };
const setUnit = async (page, u) => { await tab(page, 'settings'); await page.click(`[data-action=unit][data-unit=${u}]`); };
const openFirstHistory = async (page) => { await tab(page, 'history'); await page.click('[data-action=open-workout]'); await page.waitForTimeout(350); const t = await page.textContent('#sheet'); await page.click('#sheet [data-action=close-sheet]'); return t; };

(async () => {
  const browser = await chromium.launch();

  /* ---- A. v1 data saved in kg: numbers unchanged, backup kept ---- */
  {
    const raw = JSON.stringify(v1('kg', [W('k1', 'Kg day', '2026-10-27T10:00', '2026-10-27T11:00', [E('bench', [set(60, 8), set('62.5', 5)])])]));
    const page = await session(browser, raw);
    const s = await stored(page);
    check('A kg: schemaVersion 2', s.schemaVersion, 2);
    check('A kg: weights untouched', JSON.stringify(s.workouts[0].entries[0].sets.map((x) => x.weight)), '["60","62.5"]');
    check('A kg: backup is exact original', await page.evaluate((k) => localStorage.getItem(k), BACKUP), raw);
    check('A kg: templates/settings kept', `${s.templates.length}/${s.settings.unit}/${s.settings.rest}`, '1/kg/90');
    const h = await openFirstHistory(page);
    check('A kg: history shows 62.5 kg', h.includes('62.5 kg × 5'), true);
    await page.reload();
    check('A kg: reload does not migrate again', JSON.stringify((await stored(page)).workouts[0].entries[0].sets.map((x) => x.weight)), '["60","62.5"]');
    check('A errors', page.errors.length, 0);
    await page.context().close();
  }

  /* ---- B. v1 data saved in lb: converted to kg, displays identical lb values ---- */
  let lbPage;
  {
    const raw = JSON.stringify(v1('lb', lbWorkouts));
    const page = lbPage = await session(browser, raw);
    const s = await stored(page);
    const w = s.workouts.find((x) => x.id === 'w2').entries[0].sets.map((x) => x.weight);
    check('B lb: 135 lb stored as kg', w[0], (v) => close(v, 135 * 0.45359237));
    check('B lb: 185.5 lb stored as kg', w[1], (v) => close(v, 185.5 * 0.45359237));
    check('B lb: blank weight stays blank', s.workouts.find((x) => x.id === 'w1').entries[0].sets[1].weight, '');
    check('B lb: backup is exact original', await page.evaluate((k) => localStorage.getItem(k), BACKUP), raw);
    let h = await openFirstHistory(page);
    check('B lb: history shows 185.5 lb', h.includes('185.5 lb × 3') && h.includes('135 lb × 5'), true);
    await tab(page, 'progress');
    let t = await text(page);
    check('B lb: progress heaviest 185.5', t.includes('185.5'), true);
    await tab(page, 'statistics');
    await page.selectOption('#stats-perf-ex', 'bench');
    t = await text(page);
    check('B lb: stats PR heaviest', t.includes('185.5 lb × 3'), true);
    // Switch to kg
    await setUnit(page, 'kg');
    h = await openFirstHistory(page);
    check('B kg view: 185.5 lb → 84.1 kg', h.includes('84.1 kg × 3') && h.includes('61.2 kg × 5'), true);
    await tab(page, 'statistics');
    check('B kg view: stats PR 84.1 kg', (await text(page)).includes('84.1 kg × 3'), true);
    // Toggle back and forth many times: storage unchanged, lb display exact
    const before = JSON.stringify((await stored(page)).workouts);
    for (let i = 0; i < 10; i++) { await setUnit(page, i % 2 ? 'kg' : 'lb'); }
    await setUnit(page, 'lb');
    check('B toggling never rewrites weights', JSON.stringify((await stored(page)).workouts), before);
    h = await openFirstHistory(page);
    check('B back to lb: exact 185.5 and 135', h.includes('185.5 lb × 3') && h.includes('135 lb × 5'), true);
    // Pre-update copy download
    await tab(page, 'settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export-pre-update]')]);
    const p = await dl.path();
    check('B pre-update copy downloads original', fs.readFileSync(p, 'utf8'), raw);
  }

  /* ---- C. Typing weights in lb stores kg; inputs and placeholders round-trip ---- */
  {
    const page = lbPage;
    await tab(page, 'workout');
    await require("./flow.js")(page).startEmpty();
    await page.click('[data-action=add-exercise]');
    await page.fill('#exercise-search', 'bench');
    await page.click('[data-action=pick-exercise]');
    check('C placeholder shows last time in lb', await page.getAttribute('input[data-entry="0"][data-set="1"][data-field=weight]', 'placeholder'), '185.5');
    check('C previous column in lb', (await page.$$eval('#view .prev', (p) => p.map((x) => x.textContent))).join(), '135×5,185.5×3');

    await page.fill('input[data-entry="0"][data-set="0"][data-field=weight]', '225');
    await page.fill('input[data-entry="0"][data-set="0"][data-field=reps]', '5');
    await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]');
    await page.fill('input[data-entry="0"][data-set="1"][data-field=reps]', '3'); // weight left blank → last time (185.5 lb)
    await page.click('[data-action=toggle-set][data-entry="0"][data-set="1"]');
    let s = await stored(page);
    check('C typed 225 lb stored as kg', s.active.entries[0].sets[0].weight, (v) => close(v, 225 * 0.45359237));
    await page.click('[data-action=add-set][data-entry="0"]');
    check('C re-rendered input still shows 225', await page.inputValue('input[data-entry="0"][data-set="0"][data-field=weight]'), '225');
    await page.fill('input[data-entry="0"][data-set="0"][data-field=weight]', '22,5');
    s = await stored(page);
    check('C comma decimal accepted', s.active.entries[0].sets[0].weight, (v) => close(v, 22.5 * 0.45359237));
    await page.fill('input[data-entry="0"][data-set="0"][data-field=weight]', '225');
    await require("./flow.js")(page).finish();
    s = await stored(page);
    const fin = s.workouts[0].entries[0].sets;
    check('C blank weight filled from last time (kg)', fin[1].weight, (v) => close(v, 185.5 * 0.45359237));
    check('C unchecked extra set dropped', fin.length, 2);
    const h = await openFirstHistory(page);
    check('C history shows 225 lb', h.includes('225 lb × 5') && h.includes('185.5 lb × 3'), true);
    await setUnit(page, 'kg');
    check('C kg view 102.1 kg', (await openFirstHistory(page)).includes('102.1 kg × 5'), true);
    check('B/C errors', page.errors.length, 0);

    /* ---- D. Export (v2) → import round trip, and importing old v1 files ---- */
    await tab(page, 'settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
    const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    check('D export has schemaVersion 2', exported.schemaVersion, 2);
    const before = JSON.stringify((await stored(page)).workouts);
    const v2file = `${SP}/backup-v2.json`; fs.writeFileSync(v2file, JSON.stringify(exported));
    await page.setInputFiles('#import-file', v2file);
    await page.waitForTimeout(300);
    await page.click('[data-action=restore-confirm]'); await page.waitForTimeout(500);
    check('D v2 import keeps kg values exactly', JSON.stringify((await stored(page)).workouts), before);
    const v1file = `${SP}/backup-v1-lb.json`; fs.writeFileSync(v1file, JSON.stringify({ app: 'training-tracker', version: 1, ...v1('lb', lbWorkouts) }));
    await page.setInputFiles('#import-file', v1file);
    await page.waitForTimeout(300);
    await page.click('[data-action=restore-confirm]'); await page.waitForTimeout(500);
    s = await stored(page);
    check('D v1 lb import converted', s.workouts.find((x) => x.id === 'w2').entries[0].sets[1].weight, (v) => close(v, 185.5 * 0.45359237));
    check('D v1 import → schemaVersion 2', s.schemaVersion, 2);
    check('D v1 import unit restored to lb', s.settings.unit, 'lb');
    check('D errors', page.errors.length, 0);
    await page.context().close();
  }

  /* ---- E. Unreadable stored data is kept, never overwritten ---- */
  {
    const page = await session(browser, '{"workouts": [broken');
    await page.waitForTimeout(600);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    const copyKey = keys.find((k) => k.startsWith('training-tracker.v1.unreadable-'));
    check('E unreadable copy kept', !!copyKey, true);
    check('E unreadable copy exact', await page.evaluate((k) => localStorage.getItem(k), copyKey), '{"workouts": [broken');
    check('E user warned', page.alerts.some((a) => a.includes('could not be read')), true);
    await page.context().close();
  }

  /* ---- F. Fresh install: no migration, no backup ---- */
  {
    const page = await session(browser);
    await require("./flow.js")(page).startEmpty();
    check('F fresh: schemaVersion 2', (await stored(page)).schemaVersion, 2);
    check('F fresh: no backup key', await page.evaluate((k) => localStorage.getItem(k), BACKUP), null);
    await tab(page, 'settings');
    check('F no pre-update button', await page.$('[data-action=export-pre-update]'), null);
    await page.context().close();
  }

  /* ---- G. Progress and Statistics agree ---- */
  {
    const workouts = [
      W('g1', 'A', '2026-10-28T07:00', '2026-10-28T08:00', [E('bench', [set(60, 8), set(70, 5), set(80, 3)])]),
      W('g2', 'B', '2026-10-27T07:00', '2026-10-27T08:00', [E('bench', [set(100, 15)])]),          // 15 reps: no e1RM
      W('g3', 'C', '2026-10-20T07:00', '2026-10-20T08:00', [E('bench', [set(75, 5), set(-5, 5)])]), // negative set invalid
      W('g4', 'D', '2026-10-13T07:00', '2026-10-13T08:00', [E('pullup', [set('', 12), set('', 9)])]),
      W('g5', 'E', '2026-10-06T07:00', '2026-10-06T08:00', [E('bench', [{ weight: '50', reps: '5', done: false }])]), // no valid sets
      W('g6', 'F', '2026-11-02T07:00', '2026-11-02T08:00', [E('bench', [set(200, 1)])])             // future-dated
    ];
    const page = await session(browser, JSON.stringify(v1('kg', workouts)));
    await tab(page, 'progress');
    const pstat = (l) => page.$$eval('.stats .stat', (els, l) => els.find((e) => e.querySelector('.lbl').textContent === l)?.querySelector('.num').textContent, l);
    const prog = { week: await page.$eval('.compare tbody tr:first-child td', (td) => td.textContent.trim()), streak: (await pstat('Week streak'))?.replace(/\s*wk$/, ''), total: await pstat('Total workouts'),
      heaviest: await pstat('Heaviest (kg)'), e1rm: await pstat('Best est. 1RM'), sessions: await pstat('Sessions'),
      dots: await page.$$eval('.chart .dot', (d) => d.length), labels: await page.$$eval('svg.chart', (c) => [...c[c.length - 1].querySelectorAll('.lbl')].map((x) => x.textContent)) };
    await page.selectOption('#progress-exercise', 'pullup');
    const progReps = await pstat('Most reps in a set');
    await tab(page, 'statistics');
    const sstat = (l) => page.$$eval('.stats-grid .stat', (els, l) => els.find((e) => e.querySelector('.lbl').textContent === l)?.querySelector('.num').textContent.trim(), l);
    await page.click('[data-saction=period][data-v="all"]');
    const st = { week: await sstat('This week'), total: await sstat('Workouts'), dayStreak: await sstat('Day streak') };
    await page.selectOption('#stats-perf-ex', 'bench');
    await page.selectOption('#stats-perf-metric', 'e1rm');
    const sdots = await page.$$eval('.chart .dot', (d) => d.length);
    const slabels = await page.$$eval('.stats-chart-title + svg .lbl', (t) => t.map((x) => x.textContent));
    const v = await text(page);
    check('G this week equal', `${prog.week}=${st.week}`, '2=2');
    check('G total equal (invalid/future excluded)', `${prog.total}=${st.total}`, '4=4');
    check('G week streak 3 (Oct 13, 20, 27 weeks)', prog.streak, 3);
    check('G day streak 2 (27th, 28th)', st.dayStreak, '2 d');
    check('G heaviest equal 100', prog.heaviest === '100' && v.includes('100 kg × 15'), true);
    check('G best e1RM equal 88 (15-rep set excluded)', prog.e1rm === '88' && v.includes('88 kg'), true);
    check('G e1RM chart same points', `${prog.dots}=${sdots}`, '2=2');
    check('G e1RM chart same labels', JSON.stringify(prog.labels), JSON.stringify(slabels));
    check('G negative set ignored (Oct 20 e1RM from 75×5 = 87.5)', prog.labels[1], '87.5');
    check('G chart top is 88', prog.labels[0], '88');
    check('G sessions: bench in 3 completed workouts', prog.sessions, 3);
    await page.selectOption('#stats-perf-ex', 'pullup');
    check('G most reps equal', `${progReps}=${(await text(page)).match(/(\d+)Most reps in a set/)?.[1]}`, '12=12');
    check('G errors', page.errors.length, 0);
    await page.context().close();
  }

  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => r.startsWith('FAIL')).length);
  await browser.close();
})();
