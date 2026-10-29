const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], scheme = process.argv[3] || 'light';
const KEY = 'training-tracker.v1';
const L = (s) => new Date(s).toISOString();
const S = (w, r, extra = {}) => ({ weight: w, reps: String(r), done: true, ...extra });
const C = (m, sec) => ({ weight: '', reps: '', ...(m != null ? { distance: m } : {}), ...(sec != null ? { duration: sec } : {}), done: true });
const W = (id, day, entries) => ({ id, name: id, location: '', notes: '', start: L(`2026-${day}T10:00:00`), end: L(`2026-${day}T11:00:00`), entries });
const E = (exerciseId, sets) => ({ exerciseId, sets });
// Clock: Wed 28 Oct 2026. Last complete week: 19–25 Oct. Week before: 12–18 Oct. 5–11 Oct: no training.
const seed = {
  schemaVersion: 2, cardioExercisesAdded: true, active: null, settings: { unit: 'kg', rest: 90 }, templates: [],
  exercises: [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'squat', name: 'Squat', category: 'Legs' },
    { id: 'pull', name: 'Pull-up', category: 'Back' }, { id: 'run', name: 'Running', category: 'Cardio' }, { id: 'bike', name: 'Cycling', category: 'Cardio' },
    { id: 'rowc', name: 'Rowing', category: 'Cardio' }, { id: 'padel', name: 'Padel', category: 'Sports' }, { id: 'opress', name: 'Old Press', category: 'Shoulders', archived: true }],
  workouts: [
    W('b1', '09-07', [E('bench', [S(40, 10, { type: 'warmup' }), S(80, 5)]), E('squat', [S(100, 5)])]),
    W('op1', '09-10', [E('opress', [S(40, 8)])]),
    W('b2', '09-14', [E('bench', [S(82.5, 5)]), E('squat', [S(105, 5)])]),
    W('op2', '09-17', [E('opress', [S(42.5, 8)])]),
    W('b3', '09-21', [E('bench', [S(100, 1, { type: 'warmup' }), S(85, 5)])]),   // heavy warm-up must not count
    W('b4', '09-28', [E('bench', [S(85, 5)])]),
    W('pu0', '09-30', [E('pull', [S('', 6)])]),
    W('sq2', '10-02', [E('squat', [S(105, 5)])]),
    W('b5', '10-13', [E('bench', [S(85, 4)]), E('squat', [S(100, 5)])]),
    W('pu1', '10-14', [E('pull', [S('', 8), S('', 8)])]),
    W('c2', '10-15', [E('run', [C(4000, 1320)])]),
    W('c3', '10-17', [E('bike', [C(20000, null)]), E('rowc', [C(null, 1200)])]),       // distance only + time only
    W('b6', '10-20', [E('bench', [S(85, 5), S(85, 5)]), E('run', [C(5000, 1500)])]),  // mixed
    W('pu2', '10-21', [E('pull', [S('', 10), S('', 8)])]),
    W('b7', '10-22', [E('bench', [S(82.5, 6)])]),
    W('sq3', '10-23', [E('squat', [S(105, 4)])]),
    W('c1', '10-24', [E('run', [C(6000, 1800)])]),
    W('p1', '10-26', [E('bench', [S(85, 5)]), E('padel', [S('', 1)])]),
    W('c4', '10-27', [E('run', [C(5000, 1440)])]),
    W('bad', '10-25', [E('bench', [S(-50, 5)])])                                      // invalid: negative weight
  ].reverse()
};
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => {
  const browser = await chromium.launch();
  const mk = async (seedData) => {
    const ctx = await browser.newContext({ ...devices['iPhone SE'], viewport: { width: 375, height: 667 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
    const page = await ctx.newPage(); const F = require('./flow.js')(page);
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
    page.on('dialog', (d) => d.accept());
    await page.clock.setFixedTime(new Date('2026-10-28T18:00:00+01:00'));
    if (seedData) await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(seedData)]);
    await page.goto('http://localhost:3000/training-tracker/');
    return page;
  };
  const wait = (p, ms = 250) => p.waitForTimeout(ms);
  const text = async (p) => (await p.innerText('#view')).replace(/\s+/g, ' ');
  const view = async (p, v) => { await p.click(`[data-iaction=view][data-v="${v}"]`); await wait(p); };
  const rowsOf = (p) => p.$$eval('.compare.report tbody tr', (rs) => Object.fromEntries(rs.map((r) => [r.querySelector('th').innerText.trim(), [...r.querySelectorAll('td')].map((d) => d.innerText.trim().replace(/\n+/g, ' · ').replace(/\s+/g, ' '))])));

  /* Empty app */
  let page = await mk(null);
  await go(page, 'insights'); await wait(page);
  check('empty: explains what to record', (await text(page)).includes('log workouts in at least two different weeks'), true);
  check('empty: no errors', page.errors.length, 0);
  await page.context().close();

  page = await mk(seed);
  await go(page, 'insights'); await wait(page);
  check('tab title', await page.innerText('#title'), 'Progress');

  /* Insight cards: last complete week (19–25 Oct) vs 12–18 Oct */
  const cards = await page.$$eval('.insight-card', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  check('at most 4 cards', cards.length, 4);
  check('frequency card', cards[0], (t) => t.includes('Training frequency increased') && t.includes('5 workouts last week (19 Oct – 25 Oct) vs 4 the week before (12 Oct – 18 Oct)'));
  check('volume card (1,765 vs 840, warm-ups excluded)', cards[1], (t) => t.includes('Strength volume up 110%') && t.includes('1,765 kg last week (19 Oct – 25 Oct) vs 840 kg (12 Oct – 18 Oct)') && t.includes('warm-ups excluded'));
  check('plateau card (Squat, worded as possible)', cards[2], (t) => t.includes('Possible plateau: Squat') && t.includes('No new best estimated 1RM in the last 6 weeks') && t.includes('only reflects what was logged'));
  check('running distance card (11 vs 4 km)', cards[3], (t) => t.includes('Running distance up 175%') && t.includes('11.00 km last week'));
  check('invalid workout ignored (not counted)', cards[0].includes('5 workouts'), true);

  /* Weekly report: last complete week by default */
  let r = await rowsOf(page);
  check('report heading', (await text(page)).includes('Week of 19 Oct – 25 Oct compared with Week of 12 Oct – 18 Oct'), true);
  check('workouts 5 vs 4', r.Workouts.join('|'), '5|4|+1 · +25%');
  check('strength sessions 4 vs 2 (mixed counted)', r['Strength sessions'].join('|'), '4|2|+2 · +100%');
  check('cardio sessions 2 vs 2', r['Cardio sessions'].join('|'), '2|2|same');
  check('cardio time from cardio sets only', r['Cardio time'].join('|'), '55:00|42:00|+13:00 · +31%');
  check('volume', r['Strength volume (kg)'].join('|'), '1,765|840|+925 · +110%');
  check('running distance separate', r['Running (km)'].join('|'), '11.00|4.00|+7.00 · +175%');
  check('cycling distance separate, to zero', r['Cycling (km)'].join('|'), '–|20.00|−20.00 · −100%');
  check('no rowing distance row (time only)', Object.keys(r).some((k) => k.startsWith('Rowing')), false);
  check('categories', `${r.Chest.join('|')} / ${r.Legs.join('|')}`, '2|1|+1 · +100% / 1|1|same');
  // Current incomplete week vs same days of last week
  await page.click('[data-iaction=week][data-dir="-1"]'); await wait(page);
  let t = await text(page);
  check('current week labelled in progress', t.includes('This week so far (26 Oct – 28 Oct) compared with Same days last week (19 Oct – 21 Oct)') && t.includes('3 of 7 days'), true);
  r = await rowsOf(page);
  check('partial week: 2 vs 2 same days', r.Workouts.join('|'), '2|2|same');
  check('zero baseline shows "new", no %', r['Sports sessions'].join('|'), '1|0|new');
  check('next disabled on current week', await page.isDisabled('[data-iaction=week][data-dir="-1"]'), true);
  // Week with no training
  for (let i = 0; i < 3; i++) { await page.click('[data-iaction=week][data-dir="1"]'); await wait(page, 120); } // 26 Oct -> 5 Oct
  t = await text(page);
  r = await rowsOf(page);
  check('empty week (5–11 Oct) vs 28 Sep – 4 Oct', t.includes('Week of 5 Oct – 11 Oct compared with Week of 28 Sept – 4 Oct') || t.includes('Week of 5 Oct – 11 Oct compared with Week of 28 Sep – 4 Oct'), true);
  check('empty week workouts 0 vs 3', r.Workouts.join('|'), '0|3|−3 · −100%');
  check('empty week cardio time', r['Cardio time'].join('|'), '–|–|–');

  /* Strength progression */
  await view(page, 'strength');
  check('default exercise: Bench (most sessions)', await page.$eval('#ins-ex', (s) => s.selectedOptions[0].textContent), 'Bench Press');
  t = await text(page);
  check('best working weight 85 (100 kg warm-up excluded)', t.includes('85 kg Best working weight'), true);
  check('best e1RM 99.2', t.includes('99.2 kg Best est. 1RM'), true);
  check('recent vs earlier (3 vs 3)', t.includes('Best estimated 1RM in the last 3 sessions (20 Oct – 26 Oct): 99.2 kg') && t.includes('same'), true);
  check('reps at same weight', t.includes('85 kg 5 sessions · 21 Sept → 26 Oct 5 → 5 reps') || t.includes('85 kg 5 sessions · 21 Sep → 26 Oct 5 → 5 reps'), true);
  check('reps at 82.5', t.includes('82.5 kg 2 sessions') && t.includes('5 → 6 reps'), true);
  check('bench improving in 6 weeks', t.includes('Recorded progress in the last 6 weeks'), true);
  check('lists squat as possible plateau', t.includes('Possible plateaus in this period: Squat'), true);
  check('e1RM chart drawn', await page.$$eval('.chart .dot', (d) => d.length), 8);
  await page.selectOption('#ins-ex', 'squat');
  t = await text(page);
  check('squat plateau wording', t.includes('Possible plateau.') && t.includes('No new best estimated 1RM in the last 6 weeks (3 sessions since 17 Sept)') || t.includes('(3 sessions since 17 Sep)'), true);
  await page.selectOption('#ins-plateau-weeks', '4');
  t = await text(page);
  check('configurable period (4 weeks)', t.includes('in the last 4 weeks'), true);
  check('plateau setting saved', (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).settings.plateauWeeks, KEY)), 4);
  await page.selectOption('#ins-plateau-weeks', '6');
  await page.selectOption('#ins-ex', 'pull');
  t = await text(page);
  check('bodyweight: reps, no weight metrics', t.includes('Most reps in a set per session (bodyweight') && !t.includes('Best working weight') && !t.includes('Reps at the same weight'), true);
  check('archived exercise listed', await page.$eval('#ins-ex', (s) => [...s.options].some((o) => o.textContent === 'Old Press (archived)')), true);
  await page.selectOption('#ins-ex', 'opress');
  check('sparse data: insufficient, no plateau claim', (await text(page)).includes('Not enough data to judge the last 6 weeks'), true);

  /* Cardio trends */
  await view(page, 'cardio');
  const bars = await page.$eval('.chart', (s) => s.getAttribute('aria-label'));
  check('weekly cardio time (logged sets only)', bars.includes('12/10: 42:00') && bars.includes('19/10: 55:00') && bars.includes('26/10: 24:00'), true);
  check('current week bar marked partial (cardio time + running distance charts)', await page.$$eval('.bar-partial', (b) => b.length), 2);
  check('default activity Running', await page.$eval('#ins-cardio', (s) => s.selectedOptions[0].textContent), 'Running');
  t = await text(page);
  check('running recent vs earlier distance (avg)', t.includes('Average distance, last 2 sessions: 5.50 km vs 4.50 km'), true);
  check('running pace avg (4:54 vs 5:15)', t.includes('Average pace, last 2 sessions: 4:54 /km vs 5:15 /km'), true);
  check('pace caveat', t.includes("doesn't by itself show a change in fitness"), true);
  await page.selectOption('#ins-cardio', 'bike');
  t = await text(page);
  check('cycling: no speed without time', t.includes('Needs sets with both distance and time logged'), true);
  await page.selectOption('#ins-cardio', 'rowc');
  t = await text(page);
  check('rowing: no distance invented', t.includes('No distance logged for Rowing'), true);

  /* Balance */
  await view(page, 'balance');
  t = await text(page);
  check('balance period = last 4 complete weeks', t.includes('28 Sept – 25 Oct') || t.includes('28 Sep – 25 Oct'), true);
  check('mixed counted per type', t.includes('Weights') && t.includes('Cardio') && t.includes('Sports'), true);
  check('not logged recently: Shoulders only', t.includes('Shoulders · last 17 Sept') || t.includes('Shoulders · last 17 Sep'), true);
  check('proxy caveat', t.includes('only rough proxies') && t.includes('no single ideal number'), true);
  check('no errors so far', JSON.stringify(page.errors), '[]');
  await page.screenshot({ path: `${SP}/ins-${scheme}-balance.png`, fullPage: true });

  /* Editing and deleting update Insights */
  await go(page, 'history'); await wait(page);
  await page.click('[data-action=open-workout][data-id="sq3"]'); await wait(page);
  await page.click('[data-action=delete-workout]'); await wait(page);
  await page.click('[data-action=open-workout][data-id="b7"]'); await wait(page);
  await page.click('[data-action=edit-workout]'); await wait(page);
  await page.fill('#sheet input[data-wfield=weight][data-entry="0"][data-set="0"]', '90');
  await page.fill('#sheet input[data-wfield=reps][data-entry="0"][data-set="0"]', '5');
  await page.click('[data-action=save-wedit]'); await wait(page);
  await page.click('#sheet [data-action=close-sheet]');
  await go(page, 'insights'); await view(page, 'overview');
  const cards2 = await page.$$eval('.insight-card', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  check('deleted: frequency now 4 vs 4 -> no frequency card', cards2.some((x) => x.includes('Training frequency')), false);
  check('edited+deleted: volume 850 + 450 = 1,300', cards2.some((x) => x.includes('1,300 kg last week')), true);
  check('deleted: squat plateau gone (not enough sessions)', cards2.some((x) => x.includes('Possible plateau: Squat')), false);
  check('edited: records last week now 6 (incl. bench 90 kg + e1RM)', cards2.some((x) => x.includes('6 new records last week')), true);
  await view(page, 'strength');
  await page.selectOption('#ins-ex', 'bench');
  check('edited: best working weight 90', (await text(page)).includes('90 kg Best working weight'), true);
  check('no errors after edits', JSON.stringify(page.errors), '[]');
  await page.screenshot({ path: `${SP}/ins-${scheme}-strength.png`, fullPage: true });
  await view(page, 'overview');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SP}/ins-${scheme}-week.png`, fullPage: true });
  await page.context().close();

  /* Theme: Auto follows the phone, Light/Dark override it, and it is remembered */
  page = await mk(seed);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const sys = await bg();
  check('auto follows system', sys, scheme === 'dark' ? 'rgb(7, 11, 20)' : 'rgb(238, 242, 247)');
  await go(page, 'settings'); await wait(page);
  await page.click('[data-action=theme][data-v="light"]'); await wait(page);
  check('light forced', await bg(), 'rgb(238, 242, 247)');
  check('status bar colour follows', await page.evaluate(() => [...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content).join()), '#eef2f7,#eef2f7');
  await page.reload(); await wait(page);
  check('light remembered after reopening', await bg(), 'rgb(238, 242, 247)');
  await go(page, 'settings'); await wait(page);
  await page.click('[data-action=theme][data-v="dark"]'); await wait(page);
  check('dark forced', await bg(), 'rgb(7, 11, 20)');
  await page.click('[data-action=theme][data-v="system"]'); await wait(page);
  check('back to auto', await bg(), sys);
  check('no theme errors', JSON.stringify(page.errors), '[]');
  await page.context().close();

  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((x) => x.startsWith('FAIL')).length);
  await browser.close();
})();
