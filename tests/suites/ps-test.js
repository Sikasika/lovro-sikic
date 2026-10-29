const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], scheme = process.argv[3] || 'light';
const KEY = 'training-tracker.v1';
const L = (s) => new Date(s).toISOString();
const S = (w, r, extra = {}) => ({ weight: w, reps: String(r), done: true, ...extra });
const C = (m, sec) => ({ weight: '', reps: '', distance: m, duration: sec, done: true });
const W = (id, day, from, to, entries) => ({ id, name: id, location: '', notes: '', start: L(`2026-${day}T${from}:00`), ...(to ? { end: L(`2026-${day}T${to}:00`) } : {}), entries });
const E = (exerciseId, sets) => ({ exerciseId, sets });
// Clock: Wed 28 Oct 2026 18:00 (Zagreb). This week = Mon 26 – Wed 28, last week = 19–25 Oct.
const seed = {
  schemaVersion: 2, cardioExercisesAdded: true, active: null, settings: { unit: 'kg', rest: 90 }, templates: [],
  exercises: [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'squat', name: 'Squat', category: 'Legs' },
    { id: 'pullup', name: 'Pull-up', category: 'Back' }, { id: 'run', name: 'Running', category: 'Cardio' }, { id: 'tennis', name: 'Tennis', category: 'Sports' }],
  workouts: [
    W('a7', '10-01', '10:00', '10:30', [E('pullup', [S('', 10)])]),
    W('a1', '10-13', '10:00', '11:00', [E('bench', [S(80, 5)])]),
    W('a2', '10-20', '10:00', '11:00', [E('bench', [S(40, 10, { type: 'warmup' }), S(90, 3), S(85, 5)]), E('run', [C(5000, 1500)])]),
    W('a3', '10-22', '07:00', null, [E('run', [C(6000, 1980)])]),             // no end time
    W('a8', '10-24', '10:00', '10:45', [E('squat', [S(100, 5)])]),
    W('a4', '10-26', '10:00', '10:45', [E('bench', [S(92.5, 2)]), E('squat', [S(100, 5)])]),
    W('a5', '10-27', '10:00', '11:30', [E('tennis', [S('', 1)])]),
    W('a6', '10-28', '07:00', '07:50', [E('run', [C(3000, 840)]), E('pullup', [S('', 12), S('', 10)])])
  ].reverse()
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
  await page.clock.setFixedTime(new Date('2026-10-28T18:00:00+01:00'));
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(seed)]);
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 300) => page.waitForTimeout(ms);
  const tab = async (t) => { await go(page, t); await wait(100); };
  const card = (sel, l) => page.$$eval(`${sel} .stat`, (els, l) => els.find((e) => e.querySelector('.lbl').textContent === l)?.querySelector('.num').innerText.replace(/\s+/g, ' ').trim(), l);
  const compare = () => page.$$eval('.compare tbody tr', (rows) => Object.fromEntries(rows.map((r) => [r.querySelector('th').textContent, [...r.querySelectorAll('td')].map((d) => d.innerText.trim())])));
  const records = () => page.$$eval('.section-title', (ts) => {
    const t = ts.find((x) => x.textContent.startsWith('Recent records'));
    return [...t.nextElementSibling.querySelectorAll('.list-item')].map((li) => li.innerText.replace(/\s+/g, ' ').trim());
  });

  /* Progress: quick summaries */
  await tab('progress');
  check('total workouts', await card('#view .stats', 'Total workouts'), 8);
  check('week streak (weeks of 26, 19, 12 Oct; 5 Oct empty)', await card('#view .stats', 'Week streak'), '3 wk');
  check('day streak (26, 27, 28 Oct)', await card('#view .stats', 'Day streak'), '3 d');
  let c = await compare();
  check('this/last week workouts', c.Workouts.join('|'), '3|3');
  check('training time (last week: one workout has no end time)', c['Training time'].join('|'), '3.1 h|1.8 h*');
  check('volume excludes warm-ups (685 | 270+425+500)', c['Volume (kg)'].join('|'), '685|1,195');
  check('cardio time from logged sets (14:00 | 25:00+33:00)', c['Cardio time'].join('|'), '14:00|58:00');
  check('untimed note shown', (await page.innerText('#view')).includes('Some workouts have no end time'), true);
  let r = await records();
  check('6 recent records', r.length, 6);
  check('record list', JSON.stringify(r.map((x) => x.replace(/ \d+ \w+$/, '')).sort()), JSON.stringify([
    'Bench Press Est. 1RM 99.2 kg · was 93.3 kg', 'Bench Press Heaviest 90 kg · was 80 kg', 'Bench Press Heaviest 92.5 kg · was 90 kg',
    'Pull-up Most reps 12 reps · was 10 reps', 'Running Fastest pace 4:40 /km · was 5:00 /km', 'Running Longest 6.00 km · was 5.00 km'].sort()));
  check('newest first', r[r.length - 1].endsWith('20 Oct'), true);
  check('first sessions are baselines, not records (no Squat/Tennis)', r.some((x) => /Squat|Tennis/.test(x)), false);
  check('no weekly bar chart duplicated from Statistics', (await page.innerText('#view')).includes('Workouts per week'), false);
  await page.selectOption('#progress-exercise', 'squat');
  check('flat chart labels only the real value', JSON.stringify(await page.$$eval('svg.chart .lbl', (l) => l.map((x) => x.textContent))), JSON.stringify(['116.7', '24 Oct', '26 Oct']));
  check('chart caption: sessions and range', await page.innerText('.chart-caption'), '2 sessions · 24 Oct – 26 Oct');
  await page.selectOption('#progress-exercise', 'bench');
  check('progress bench heaviest/e1RM', `${await card('#view .stats:last-of-type', 'Heaviest (kg)')}|${await card('#view .stats:last-of-type', 'Best est. 1RM')}`, '92.5|99.2');
  await page.screenshot({ path: `${SP}/ps-${scheme}-progress.png`, fullPage: true });

  /* Statistics: same metrics, same answers */
  await tab('statistics');
  check('stats this week = progress', await card('.stats-grid', 'This week'), 3);
  check('stats day streak = progress', await card('.stats-grid', 'Day streak'), '3 d');
  check('stats week streak = progress', await card('.stats-grid', 'Week streak'), '3 wk');
  check('stats 30D workouts', await card('.stats-grid', 'Workouts'), 8);
  check('stats 30D volume (400 + 695 + 500 + 685)', await card('.stats-grid', 'Volume (kg)'), '2,280');
  await page.click('[data-saction=period][data-v="7d"]');
  check('stats 7D volume = this week + Oct 24 squat... (22–28 Oct: 500 + 685)', await card('.stats-grid', 'Volume (kg)'), '1,185');
  const types = await page.$$eval('.hbar', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('untimed type says "Time not recorded" (not 0 h)', types.find((x) => x.startsWith('Cardio') && !x.includes('sets')), 'Cardio 1 · 20% Time not recorded');
  check('Sports in category breakdown', types.some((x) => x.startsWith('Sports') && x.includes('1 sets')), true);
  check('frequency chart titled with unit', (await page.innerText('#view')).includes('Workouts per week (count), by main activity'), true);
  check('heatmap explains untimed shade', (await page.innerText('#view')).includes('no end time use the lightest shade'), true);
  await page.selectOption('#stats-perf-ex', 'bench');
  let v = (await page.innerText('#view')).replace(/\s+/g, ' ');
  check('stats bench PRs = progress', v.includes('92.5 kg × 2 Heaviest weight') && v.includes('99.2 kg Estimated 1-rep max'), true);
  await page.selectOption('#stats-perf-ex', 'run');
  v = (await page.innerText('#view')).replace(/\s+/g, ' ');
  check('stats running: longest + fastest', v.includes('6.00 km Distance') && v.includes('4:40 /km Fastest pace'), true);
  await page.click('[data-saction=filter][data-v="cardio"]');
  check('cardio summary: 3 runs incl. mixed', (await page.innerText('#view')).replace(/\s+/g, ' ').includes('Running 2 sessions · 9.00 km · 47:00'), true);
  await page.click('[data-saction=filter][data-v="all"]');

  /* Edited history updates records everywhere */
  await tab('history');
  await page.click('[data-action=open-workout][data-id="a4"]'); await wait();
  await page.click('[data-action=edit-workout]'); await wait();
  await page.fill('#sheet input[data-wfield=weight][data-entry="0"][data-set="0"]', '100');
  await page.fill('#sheet input[data-wfield=reps][data-entry="0"][data-set="0"]', '1');
  await page.click('[data-action=save-wedit]'); await wait();
  await page.click('#sheet [data-action=close-sheet]');
  await tab('progress');
  r = await records();
  check('edited: new heaviest record 100 kg', r.some((x) => x.startsWith('Bench Press Heaviest 100 kg · was 90 kg')), true);
  c = await compare();
  check('edited: this week volume 100 + 500', c['Volume (kg)'][0], '600');
  await tab('statistics');
  await page.selectOption('#stats-perf-ex', 'bench');
  check('edited: statistics PR 100 kg × 1', (await page.innerText('#view')).replace(/\s+/g, ' ').includes('100 kg × 1 Heaviest weight'), true);

  /* Deleted history removes its records */
  await tab('history');
  await page.click('[data-action=open-workout][data-id="a4"]'); await wait();
  await page.click('[data-action=delete-workout]'); await wait();
  await tab('progress');
  r = await records();
  check('deleted: 100 kg record gone, 90 kg still there', `${r.some((x) => x.includes('100 kg'))}|${r.some((x) => x.startsWith('Bench Press Heaviest 90 kg'))}`, 'false|true');
  check('deleted: totals', `${await card('#view .stats', 'Total workouts')}|${(await compare()).Workouts[0]}`, '7|2');
  await page.selectOption('#progress-exercise', 'bench');
  check('deleted: progress heaviest back to 90', await card('#view .stats:last-of-type', 'Heaviest (kg)'), 90);
  await tab('statistics');
  await page.selectOption('#stats-perf-ex', 'bench');
  check('deleted: statistics heaviest back to 90', (await page.innerText('#view')).replace(/\s+/g, ' ').includes('90 kg × 3 Heaviest weight'), true);

  /* Missing measurements: weeks with nothing recorded show – */
  await page.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); s.workouts = s.workouts.filter((w) => w.id === 'a5'); localStorage.setItem(k, JSON.stringify(s)); }, KEY);
  await page.reload(); await tab('progress');
  c = await compare();
  check('only tennis this week: volume and cardio time show –', `${c['Volume (kg)'].join('|')}|${c['Cardio time'].join('|')}`, '–|–|–|–');
  check('no records: explains what is needed', (await page.innerText('#view')).includes('A record needs an earlier session'), true);
  await tab('statistics');
  check('stats volume – with hint', `${await card('.stats-grid', 'Volume (kg)')}`, '–');
  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log('FAILS:', results.filter((x) => x.startsWith('FAIL')).length);
  await browser.close();
})();
