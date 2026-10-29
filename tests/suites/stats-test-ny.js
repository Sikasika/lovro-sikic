const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], scheme = process.argv[3] || 'light';
const L = (s) => new Date(s).toISOString(); // parsed in Europe/Zagreb (process TZ)
const set = (w, r) => ({ weight: w === '' ? '' : String(w), reps: String(r), done: true });
const W = (id, name, start, end, entries, extra = {}) => ({ id, name, start: L(start), ...(end ? { end: L(end) } : {}), notes: '', entries, ...extra });
const E = (exerciseId, sets) => ({ exerciseId, sets });
const data = {
  exercises: [
    { id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'squat', name: 'Squat', category: 'Legs' },
    { id: 'run', name: 'Running', category: 'Cardio' }, { id: 'tennis', name: 'Tennis', category: 'Sports' },
    { id: 'stretch', name: 'Stretching', category: 'Other' }, { id: 'pullup', name: 'Pull-up', category: 'Back' }
  ],
  templates: [], active: null, settings: { unit: 'kg', rest: 90 },
  workouts: [
    W('w1', 'Push', '2026-10-28T07:00', '2026-10-28T08:00', [E('bench', [set(60, 8), set(70, 5), set(80, 3)])], { location: 'Gym A', notes: 'Felt strong' }),
    W('w2', 'Evening run', '2026-10-28T17:00', '2026-10-28T17:40', [E('run', [set('', 1)])]),
    W('w3', 'Tennis', '2026-10-27T10:00', '2026-10-27T11:30', [E('tennis', [set('', 1)])]),
    W('w4', 'Legs + run', '2026-10-26T09:00', '2026-10-26T09:50', [E('squat', [set(100, 5), set(100, 5), set(100, 5)]), E('run', [set('', 1)])]),
    W('w5', 'Bench', '2026-10-25T10:00', '2026-10-25T11:00', [E('bench', [set(65, 8), set(75, 5)])]),
    W('w6', 'Late stretch', '2026-10-24T23:30', '2026-10-25T00:40', [E('stretch', [set('', 1)])]),
    W('w7', 'B1', '2026-10-20T10:00', '2026-10-20T10:45', [E('bench', [set(60, 10)])]),
    W('w8', 'B2', '2026-10-19T10:00', '2026-10-19T10:45', [E('bench', [set(60, 10)])]),
    W('w9', 'B3', '2026-10-18T10:00', '2026-10-18T10:45', [E('bench', [set(60, 10)])]),
    W('w10', 'Pull-ups', '2026-09-15T10:00', null, [E('pullup', [set('', 10), set('', 8)])]),
    W('w11', 'Old bench', '2025-12-01T10:00', '2025-12-01T11:00', [E('bench', [set(50, 10)])]),
    W('w12', 'Very old', '2025-06-10T10:00', '2025-06-10T11:00', [E('bench', [set(40, 10)])]),
    { id: 'bad1', name: 'Broken', start: 'garbage', entries: [E('bench', [set(1, 1)])] },
    W('bad2', 'Empty', '2026-10-10T10:00', '2026-10-10T11:00', [])
  ].reverse()
};

const results = [];
const check = (name, got, want) => results.push(`${String(got) === String(want) ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${String(got) === String(want) ? '' : ` want ${JSON.stringify(want)}`}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'America/New_York', locale: 'en-GB' });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.clock.setFixedTime(new Date('2026-10-28T18:00:00-04:00'));
  await page.addInitScript((d) => { if (!localStorage.getItem('training-tracker.v1')) localStorage.setItem('training-tracker.v1', JSON.stringify(d)); }, data);
  await page.goto('http://localhost:3000/training-tracker/');
  await go(page, 'statistics');
  await page.waitForTimeout(200);

  const stat = async (label) => page.$$eval('.stats-grid .stat', (els, l) => {
    const el = els.find((e) => e.querySelector('.lbl').textContent === l); return el ? el.querySelector('.num').textContent.trim() : null; }, label);
  const summary = async () => ({
    total: await stat('Workouts'), hours: await stat('Training time'), avg: await stat('Avg / week'),
    week: await stat('This week'), month: await stat('This month'), cur: await stat('Day streak'), longest: await stat('Longest day streak') });
  const tabTitle = await page.textContent('#title');
  check('title', tabTitle, 'Progress');
  check('skipped note', (await page.textContent('#view')).includes('2 workouts were left out'), true);

  // Summary: 30D default
  let s = await summary();
  check('30D total', s.total, 9); check('30D hours', s.hours, '8.4 h'); check('30D avg/wk', s.avg, '2.1');
  check('this week', s.week, 4); check('this month', s.month, 9); check('current streak', s.cur, '5 d'); check('30D longest', s.longest, '5 d');
  await page.click('[data-saction=period][data-v="7d"]');
  s = await summary();
  check('7D total', s.total, 6); check('7D hours', s.hours, '6.2 h'); check('7D avg', s.avg, 6); check('7D longest', s.longest, '5 d');
  await page.click('[data-saction=period][data-v="12m"]');
  s = await summary();
  check('12M total', s.total, 11); check('12M hours (w10 unknown)', s.hours, '9.4 h');
  check('12M hint unknown', await page.$$eval('.stats-grid .stat', (els) => els[1].querySelector('.stat-hint').textContent), '1 without duration');
  await page.click('[data-saction=period][data-v="all"]');
  s = await summary();
  check('All total', s.total, 12);
  // All time: 2025-06-10 .. 2026-10-28 inclusive = 506 days
  check('All avg/wk', s.avg, String(Math.round(12 / (506 / 7) * 10) / 10));

  // Filter: cardio, 30D
  await page.click('[data-saction=period][data-v="30d"]');
  await page.click('[data-saction=filter][data-v="cardio"]');
  s = await summary();
  check('cardio total', s.total, 2); check('cardio this week', s.week, 2); check('cardio streak', s.cur, '1 d'); check('cardio hours', s.hours, '1.5 h');
  // Heatmap with filter: 10-27 tennis should be empty
  check('cardio filter hides sports day', await page.getAttribute('[data-day="2026-10-27"]', 'class'), 'heat-cell empty');
  await page.click('[data-saction=filter][data-v="all"]');

  // Heatmap cells
  const style = (k) => page.getAttribute(`[data-day="${k}"]`, 'style');
  check('today has split gradient', /linear-gradient.*heat-weights.*heat-cardio/.test(await style('2026-10-28')), true);
  check('today level 4 (100 min)', /heat-weights\) 100%/.test(await style('2026-10-28')), true);
  check('today outlined', (await page.getAttribute('[data-day="2026-10-28"]', 'class')).includes('today'), true);
  check('midnight-crossing on start day', /heat-other\) 82%/.test(await style('2026-10-24')), true);
  check('nothing on 25 from w6', /heat-other/.test(await style('2026-10-25')), false);
  check('DST day 25 weights level 3', /heat-weights\) 82%/.test(await style('2026-10-25')), true);
  check('sports day 27 level 4', /heat-sports\) 100%/.test(await style('2026-10-27')), true);
  check('unknown-duration day level 1', /heat-weights\) 40%/.test(await style('2026-09-15')), true);
  check('aria label', await page.getAttribute('[data-day="2026-10-28"]', 'aria-label'), 'Wednesday 28 October 2026: 2 workouts (Weights, Cardio), 1.7 h (today)');
  check('range label', await page.textContent('.heat-range'), 'Oct 2025 – Oct 2026');
  check('12 months of days', await page.$$eval('.heat-cell[data-day]', (e) => e.length), 365);
  check('no future cell', await page.$('[data-day="2026-10-29"]'), null);
  check('next disabled at today', await page.isDisabled('[data-saction=heat-next]'), true);
  // Day sheet
  await page.click('[data-day="2026-10-28"]');
  await page.waitForTimeout(400);
  const sheet = await page.textContent('#sheet');
  check('day sheet lists both', sheet.includes('Push') && sheet.includes('Evening run') && sheet.includes('Felt strong') && !sheet.includes('Gym A'), true);
  await page.screenshot({ path: `${SP}/stats/${scheme}-day.png` });
  await page.click('#sheet [data-action=close-sheet]');
  // Keyboard navigation
  await page.focus('[data-day="2026-10-28"]');
  await page.keyboard.press('ArrowUp');
  check('arrow up moves to 27th', await page.evaluate(() => document.activeElement.dataset.day), '2026-10-27');
  await page.keyboard.press('ArrowLeft');
  check('arrow left moves a week', await page.evaluate(() => document.activeElement.dataset.day), '2026-10-20');
  // Navigate back a year
  await page.click('[data-saction=heat-prev]');
  check('prev range', await page.textContent('.heat-range'), 'Oct 2024 – Oct 2025');
  check('old workout visible', /heat-weights/.test(await style('2025-06-10')), true);
  await page.click('[data-saction=heat-today]');
  check('back to today', await page.textContent('.heat-range'), 'Oct 2025 – Oct 2026');

  // Frequency: weekly 12 — current week 4 (w1 weights, w2 cardio, w3 sports, w4 weights)
  const freqNote = await page.textContent('.freq-controls + svg + .legend-types + .stats-note');
  check('freq this week', /This week: 4/.test(freqNote), true);
  check('freq last week', /Last week: 4/.test(freqNote), true);
  await page.click('[data-saction=freq-mode][data-v="month"]');
  check('monthly this month', /This month: 9/.test(await page.textContent('.freq-controls + svg + .legend-types + .stats-note')), true);
  await page.selectOption('#stats-freq-range', '24');
  check('monthly 24 kept', await page.inputValue('#stats-freq-range'), '24');

  // Performance: default exercise = most sessions = Bench
  check('perf default ex', await page.$eval('#stats-perf-ex', (e) => e.selectedOptions[0].textContent), 'Bench Press');
  check('bench metrics', await page.$$eval('#stats-perf-metric option', (o) => o.map((x) => x.value).join()), 'weight,e1rm,volume,reps,totalreps,duration');
  const prText = await page.textContent('#view');
  check('PR heaviest 80 kg × 3', prText.includes('80 kg × 3'), true);
  check('PR e1rm 88', prText.includes('88 kg'), true);
  await page.selectOption('#stats-perf-ex', 'run');
  check('running metrics (duration only from run-only workout)', await page.$$eval('#stats-perf-metric option', (o) => o.map((x) => x.value).join()), 'duration,reps,totalreps');
  check('running PR duration 40:00', (await page.textContent('#view')).includes('40:00'), true);
  check('running no-distance note', (await page.textContent('#view')).includes('No distance logged for Running yet'), true);
  await page.selectOption('#stats-perf-ex', 'pullup');
  check('bodyweight ex metrics', await page.$$eval('#stats-perf-metric option', (o) => o.map((x) => x.value).join()), 'reps,totalreps');
  await page.selectOption('#stats-perf-ex', 'bench');
  await page.selectOption('#stats-perf-range', '3m');
  check('bench 3m points', await page.$$eval('.chart .dot', (d) => d.length), 5);
  check('body weight: no weigh-ins message (replaces old placeholder)', (await page.textContent('#view')).includes('No weigh-ins yet. Log your weight at the top of the Progress tab.') && !(await page.textContent('#view')).includes("isn't recorded"), true);

  // Breakdown 30D
  const bd = await page.$$eval('.hbar', (els) => els.map((e) => e.querySelector('.hbar-top').textContent.replace(/\s+/g, ' ').trim()));
  check('breakdown weights', bd[0], 'Weights 6 · 67%');
  check('breakdown cardio', bd[1], 'Cardio 1 · 11%');
  check('breakdown sports', bd[2], 'Sports 1 · 11%');
  check('breakdown other', bd[3], 'Other 1 · 11%');
  // Sets by category now covers every category: 8 chest + 3 legs + 2 cardio + 1 sports + 1 other = 15
  check('category chest', bd.find((x) => x.startsWith('Chest')), 'Chest 8 sets · 53%');
  check('category legs', bd.find((x) => x.startsWith('Legs')), 'Legs 3 sets · 20%');
  check('category cardio', bd.find((x) => x.startsWith('Cardio') && x.includes('sets')), 'Cardio 2 sets · 13%');
  check('category sports', bd.find((x) => x.startsWith('Sports') && x.includes('sets')), 'Sports 1 sets · 7%');
  const dow = await page.$$eval('.dow-col', (els) => els.map((e) => e.querySelector('.dow-val').textContent || '0').join());
  // Mon: 19,26 =2 ; Tue: 20,27 =2 ; Wed: 28x2 =2 ; Thu 0 ; Fri 0 ; Sat: 24 =1 ; Sun: 18,25 =2
  check('day of week', dow, '2,2,2,0,0,1,2');

  await page.screenshot({ path: `${SP}/stats/${scheme}-full.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SP}/stats/${scheme}-top.png` });

  // Empty state
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('training-tracker.v1')); s.workouts = []; localStorage.setItem('training-tracker.v1', JSON.stringify(s)); });
  await page.reload(); await go(page, 'statistics');
  const v = await page.textContent('#view');
  check('empty state', v.includes('No completed workouts yet') && v.includes('No workouts in this range') && v.includes('No workouts in this period'), true);
  await page.screenshot({ path: `${SP}/stats/${scheme}-empty.png`, fullPage: true });
  // Corrupt data -> error state, other tabs still work
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('training-tracker.v1')); s.workouts = [{ id: 'x', start: new Date().toISOString(), entries: [{ exerciseId: 'bench', sets: 5 }] }]; localStorage.setItem('training-tracker.v1', JSON.stringify(s)); });
  await page.reload(); await go(page, 'statistics');
  check('error state', (await page.textContent('#view')).includes("Couldn't calculate statistics") || (await page.textContent('#view')).includes('left out'), true);
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((r) => r.startsWith('FAIL')).length, 'ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
