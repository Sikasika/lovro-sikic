// Insights body-weight overview. Usage: node bwi-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const base = require('./wk-seed.js');
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const pad = (n) => String(n).padStart(2, '0');
const TODAY = new Date(2026, 9, 29);
const dayN = (n) => new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - n);
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ago = (n) => key(dayN(n));
const r1 = (v) => Math.round(v * 10) / 10;
const fmt1 = (v) => (Math.round(v * 10) / 10).toLocaleString('en-GB');
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt1(Math.abs(v))}`;
// Independent reference for the rules: mean of weigh-ins with days ago in [a, b] (inclusive).
const meanAgo = (bw, a, b) => { const xs = bw.filter((w) => w.n >= a && w.n <= b); return xs.length ? { avg: xs.reduce((s, w) => s + w.kg, 0) / xs.length, n: xs.length } : null; };
const series = (fn, days, skip = () => false) => Array.from({ length: days }, (_, k) => days - 1 - k).filter((n) => !skip(n)).map((n) => ({ id: `w${n}`, date: ago(n), kg: r1(fn(n)), n }));
const strip = (bw) => bw.map(({ n, ...w }) => w);
const L = (s) => new Date(s).toISOString();
const benchWorkout = (id, n, w) => ({ id, name: 'Bench day', notes: '', start: dayN(n).toISOString(), end: new Date(dayN(n).getTime() + 3600e3).toISOString(),
  entries: [{ exerciseId: 'bench', sets: [{ weight: w, reps: '5', done: true }, { weight: w, reps: '5', done: true }] }] });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 760 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.clock.setFixedTime(new Date('2026-10-29T19:00:00+01:00'));
  await page.goto('http://localhost:3000/training-tracker/');
  const load = async (data) => {
    await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, data]);
    await page.reload(); await page.waitForTimeout(300);
    await page.click('[data-tab=insights]'); await page.waitForTimeout(250);
  };
  const st = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const view = async () => (await page.innerText('#view')).replace(/\s+/g, ' ');
  const tiles = () => page.$$eval('.bw-ins .bw-metric', (m) => m.map((x) => `${x.querySelector('.bw-metric-v').textContent.trim()}|${x.querySelector('.bw-metric-h').textContent.replace(/\s+/g, ' ').trim()}`));
  const obs = () => page.$$eval('.bw-ins .bw-obs li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  const mk = (bw, extra = {}) => ({ ...JSON.parse(JSON.stringify(base)), bodyweights: strip(bw), ...extra });

  /* 1. No weigh-ins, no workouts */
  await load({ ...mk([]), workouts: [] });
  check('1 nothing: original empty message, no weight section', `${(await view()).includes('Insights appear once you have finished workouts')}|${await page.$('.bw-ins')}`, 'true|null');
  /* No weigh-ins, with workouts: no weight section, workout insights unchanged */
  await load(mk([]));
  check('1b workouts only: no weight section, weekly report present', `${await page.$('.bw-ins')}|${(await view()).includes('Weekly report'.toUpperCase()) || (await view()).includes('Weekly report')}`, 'null|true');

  /* 2. Weigh-ins, no workouts */
  const down = series((n) => 80 + n * 0.05 + (n % 3 === 0 ? 0.4 : n % 3 === 1 ? -0.3 : 0), 40);
  await load({ ...mk(down), workouts: [] });
  check('2 weight-only: section shown with workout note, no tabs', `${await page.isVisible('.bw-ins')}|${(await view()).includes('Workout insights appear once you have finished workouts')}|${await page.$('[data-iaction=view]')}`, 'true|true|null');

  /* 5. Sufficient data, moving down: numbers match an independent calculation */
  const cur = meanAgo(down, 0, 6), prev7 = meanAgo(down, 7, 13), prev30 = meanAgo(down, 30, 36);
  const t = await tiles();
  check('5 latest = today\'s reading', t[0], `${fmt1(down[down.length - 1].kg)}|Today`);
  check('5 7-day avg + count + dates', t[1], `${fmt1(cur.avg)}|7 weigh-ins · 23 Oct–29 Oct`);
  check('5 7-day change vs previous 7 days', t[2], `${signed(cur.avg - prev7.avg)}|vs 16 Oct–22 Oct`);
  check('5 30-day change vs 7 days ending 30 days earlier', t[3], `${signed(cur.avg - prev30.avg)}|vs 23 Sept–29 Sept`);
  let o = await obs();
  check('5 trend observation with dates and change, no judgement words', o[0], (x) => x.startsWith(`Over about 30 days your 7-day average changed by ${signed(cur.avg - prev30.avg)} kg`) && x.includes('23 Sept–29 Sept') && !/good|great|well done|bad|progress/i.test(x));
  check('5 no strength link without workouts', o.length, 1);
  check('5 chart: dots + average line', `${await page.$$eval('.bw-ins .wdot', (d) => d.length)}|${await page.$$eval('.bw-ins .bw-chart .line', (d) => d.length)}`, '30|1');
  check('5 calc agrees (shared functions)', await page.evaluate(() => { const l = weighIns(); return [weightTrend(l, 7).change, weightTrend(l, 30).change].map((v) => Math.round(v * 1000) / 1000).join(); }), [cur.avg - prev7.avg, cur.avg - prev30.avg].map((v) => Math.round(v * 1000) / 1000).join());

  /* Moving up */
  const up = series((n) => 76 - n * 0.06 + (n % 2 ? 0.3 : -0.3), 40);
  await load({ ...mk(up), workouts: [] });
  const cu = meanAgo(up, 0, 6), pu = meanAgo(up, 30, 36);
  o = await obs();
  check('5 moving up: positive change, same neutral wording', o[0], (x) => x.startsWith(`Over about 30 days your 7-day average changed by ${signed(cu.avg - pu.avg)} kg`) && cu.avg > pu.avg);
  /* Relatively stable */
  const flat = series((n) => 80 + (n % 3 === 0 ? 0.6 : n % 3 === 1 ? -0.5 : 0.1), 40);
  await load({ ...mk(flat), workouts: [] });
  o = await obs();
  check('5 stable: reported as relatively stable with the range', o[0], (x) => x.startsWith('Relatively stable over about 30 days: your 7-day average stayed between') && x.includes('(30 Sept–29 Oct)'));
  check('5 stable range really within 1 kg', await page.evaluate(() => { const r = weightAverageRange(weighIns()); return r.max - r.min <= 1; }), true);

  /* 3. One weigh-in */
  await load({ ...mk([{ id: 'a', date: ago(2), kg: 81.3, n: 2 }]), workouts: [] });
  const t1 = await tiles();
  check('3 one weigh-in: latest + avg, both changes "–" with reasons', `${t1[0]}#${t1[1].split('|')[0]}#${t1[2]}#${t1[3]}`, (x) => x.startsWith('81.3|Tue, 27 Oct#81.3#–|Needs 2+ weigh-ins in both weeks (have 1 and 0)#–|Needs 2+ weigh-ins around'));
  check('3 one weigh-in: dot, no line, says too few', `${await page.$$eval('.bw-ins .wdot', (d) => d.length)}|${await page.$$eval('.bw-ins .bw-chart .line', (d) => d.length)}|${(await view()).includes('too few for a trend line')}`, '1|0|true');
  check('3 one weigh-in: lack of data stated, not called stable', `${(await view()).includes('Not enough weigh-ins to compare periods yet')}|${(await view()).includes('stable')}|${(await obs()).length}`, 'true|false|0');

  /* 4. Sparse weigh-ins + 6. gaps */
  const sparse = [{ n: 0, kg: 80 }, { n: 9, kg: 81 }].map((w) => ({ id: `s${w.n}`, date: ago(w.n), ...w }));
  await load({ ...mk(sparse), workouts: [] });
  check('4 sparse: 2 readings, no line, no comparison', `${await page.$$eval('.bw-ins .wdot', (d) => d.length)}|${await page.$$eval('.bw-ins .bw-chart .line', (d) => d.length)}|${(await tiles())[2].split('|')[0]}|${(await obs()).length}`, '2|0|–|0');
  // Gap of 12 days in the middle: windows count only real weigh-ins
  const gappy = series((n) => 82 - (40 - n) * 0.04, 40, (n) => n >= 8 && n <= 19);
  await load({ ...mk(gappy), workouts: [] });
  const g7 = meanAgo(gappy, 7, 13), gc = meanAgo(gappy, 0, 6);
  const tg = await tiles();
  check('6 gap: previous 7-day window has only its real weigh-ins', `${g7.n}|${tg[2]}`, `1|–|Needs 2+ weigh-ins in both weeks (have ${gc.n} and 1)`);
  check('6 gap: 30-day comparison still uses real readings', (await tiles())[3].split('|')[0], signed(gc.avg - meanAgo(gappy, 30, 36).avg));

  /* Stale data note */
  const old = series((n) => 80 + n * 0.02, 20).map((w) => ({ ...w, date: ago(w.n + 12), n: w.n + 12 }));
  await load({ ...mk(old), workouts: [] });
  check('stale: says latest weigh-in was 12 days ago', (await view()).includes('Your latest weigh-in was 12 days ago'), true);

  /* 7. Target set, changed, removed (via the real editor) */
  await load({ ...mk(down) });
  check('7 no target: no target row', await page.$('.bw-ins-target'), null);
  await page.click('[data-tab=progress]'); await page.click('[data-action=bw-goal]'); await page.waitForTimeout(250);
  await page.fill('#bw-target', '78'); await page.fill('#bw-start', '84'); await page.click('[data-action=bw-goal-save]'); await page.waitForTimeout(200);
  await page.click('[data-tab=insights]'); await page.waitForTimeout(250);
  const above = cur.avg - 78, pct = Math.round(((84 - cur.avg) / 6) * 100);
  check('7 target set: distance above + % from start', (await page.innerText('.bw-ins-target')).replace(/\s+/g, ' '), `Target 78 kg ${fmt1(above)} kg above ${pct}% of the way from 84 kg, using the 7-day average`);
  check('7 target bar is neutral accent, not green', await page.$eval('.bw-ins .bw-bar span', (s) => getComputedStyle(s).backgroundColor === getComputedStyle(document.querySelector('.tabbar button.active')).color), true);
  check('7 target near the data: dashed line in chart', await page.$$eval('.bw-ins .bw-chart .target', (l) => l.length), 1);
  check('7 target far from the data: noted, not squashed', await page.evaluate(() => { const h = weightChart(weighIns(), { from: sAddDays(sDay(new Date()), -29), target: 60, minLine: 3, sparse: true }); return h.includes('target below the chart') && !h.includes('class="target"'); }), true);
  await page.click('[data-tab=progress]'); await page.click('[data-action=bw-goal]'); await page.waitForTimeout(250);
  await page.fill('#bw-target', '80'); await page.click('[data-action=bw-goal-save]'); await page.waitForTimeout(200);
  await page.click('[data-tab=insights]'); await page.waitForTimeout(250);
  check('7 target changed: row + dashed line in chart', `${(await page.innerText('.bw-ins-target')).includes('Target 80 kg')}|${await page.$$eval('.bw-ins .bw-chart .target', (l) => l.length)}`, 'true|1');
  // Target below current → "below" wording when the average is under it (gain direction)
  await page.evaluate(() => { state.settings.weightGoal = { targetKg: 85, startKg: 78, startDate: '2026-10-01' }; save(); render(); });
  check('7 gain target: "below", no judgement', (await page.innerText('.bw-ins-target')).replace(/\s+/g, ' '), (x) => x.includes('Target 85 kg') && x.includes('kg below'));
  await page.click('[data-tab=progress]'); await page.click('[data-action=bw-goal]'); await page.waitForTimeout(250);
  await page.click('[data-action=bw-goal-remove]'); await page.waitForTimeout(200);
  await page.click('[data-tab=insights]'); await page.waitForTimeout(250);
  check('7 target removed: row gone', await page.$('.bw-ins-target'), null);

  /* 8. lb */
  await page.evaluate(() => { state.settings.unit = 'lb'; save(); render(); });
  const tl = await tiles();
  check('8 lb: every value converted', `${tl[0].split('|')[0]}|${tl[1].split('|')[0]}|${tl[2].split('|')[0]}`, `${fmt1(down[down.length - 1].kg / 0.45359237)}|${fmt1(cur.avg / 0.45359237)}|${signed((cur.avg - prev7.avg) / 0.45359237)}`);
  check('8 lb: labels and observation in lb', `${(await page.innerText('.bw-ins')).includes('7-day avg (lb)')}|${(await obs())[0].includes(' lb')}|${(await obs())[0].includes(' kg')}`, 'true|true|false');
  await page.evaluate(() => { state.settings.unit = 'kg'; save(); render(); });

  /* No good/bad colours in the weight section; weekly report row still there; no duplicate weight card */
  check('no up/down status colours in the weight section', await page.$$eval('.bw-ins .up, .bw-ins .down', (x) => x.length), 0);
  check('weight card no longer among workout cards (no duplicate message)', await page.$$eval('.insight-card', (c) => c.some((x) => x.textContent.includes('Body weight'))), false);
  check('weekly report keeps its Body weight (avg) row', (await view()).includes('Body weight avg (kg)'), true);
  check('section sits between cards and the weekly report', await page.evaluate(() => { const v = document.querySelector('#view').innerHTML; return v.indexOf('bw-ins') > v.indexOf('stats-seg') && v.indexOf('bw-ins') < v.indexOf('Weekly report'.replace(/./, (c) => c)); }), true);

  /* 9. Strength present: weight vs strength (one observation, named exercise and periods) */
  const wsBw = series((n) => (n >= 15 ? 82.4 : 81.2) + (n % 2 ? 0.2 : -0.2), 30);
  const ws = [benchWorkout('b1', 27, 80), benchWorkout('b2', 20, 80), benchWorkout('b3', 10, 82.5), benchWorkout('b4', 3, 82.5)];
  await load(mk(wsBw, { workouts: ws }));
  o = await obs();
  check('9 strength link: one observation naming exercise, periods, numbers', o.filter((x) => x.includes('Bench Press')).length === 1 && o.some((x) => x.startsWith('30 Sept–14 Oct vs 15 Oct–29 Oct: average weight 82.4 kg → 81.2 kg (15 and 15 weigh-ins), while your best estimated 1RM on Bench Press went up') && x.includes('(2 and 2 sessions)') && x.includes("they don't show why")), true);
  check('9 no causal or body-composition claims', o.join(' '), (x) => !/muscle|fat|recover|because|proves|preserv/i.test(x));
  // Only one session in a half → no link
  await load(mk(wsBw, { workouts: ws.slice(1) }));
  check('9 too few sessions in one half: no link', (await obs()).some((x) => x.includes('Bench Press')), false);
  // Weight change under 0.5 kg → no link
  await load(mk(series((n) => 81 + (n % 2 ? 0.2 : -0.2), 30), { workouts: ws }));
  check('9 weight barely changed: no link', (await obs()).some((x) => x.includes('Bench Press')), false);
  // Strength absent (only cardio workouts) → no link
  await load(mk(wsBw, { workouts: base.workouts.filter((w) => w.id === 'w2') }));
  check('9 strength absent: no link, weight section fine', `${(await obs()).some((x) => x.includes('1RM'))}|${await page.isVisible('.bw-ins')}`, 'false|true');

  /* 10. Editing / deleting a weigh-in updates Insights */
  await load(mk(down));
  await page.click('.bw-ins ~ * , [data-action=bw-list]'); await page.waitForTimeout(250);
  await page.click(`#sheet [data-action=bw-edit][data-id="w0"]`); await page.waitForTimeout(250);
  await page.fill('#bw-kg', '79.1'); await page.click('[data-action=bw-save]'); await page.waitForTimeout(250);
  await page.click('#sheet [data-action=close-sheet]'); await page.waitForTimeout(200);
  check('10 edit from Insights updates Latest', (await tiles())[0].split('|')[0], '79.1');
  await page.click('[data-action=bw-list]'); await page.waitForTimeout(250);
  await page.click(`#sheet [data-action=bw-edit][data-id="w0"]`); await page.waitForTimeout(250);
  await page.click('[data-action=bw-delete]'); await page.waitForTimeout(250);
  await page.click('#sheet [data-action=close-sheet]'); await page.waitForTimeout(200);
  check('10 delete updates Latest to yesterday', (await tiles())[0], `${fmt1(down[down.length - 2].kg)}|Yesterday`);
  check('10 data integrity: workouts untouched', JSON.stringify((await st()).workouts), JSON.stringify(base.workouts));

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`${scheme} ${width}px — PASSES: ${results.filter((r) => r.startsWith('PASS')).length}  FAILS: ${results.filter((r) => r.startsWith('FAIL')).length}`);
  await browser.close();
})();
