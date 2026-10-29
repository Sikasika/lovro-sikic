// Body-weight tracking: entry, 7-day average, target, chart, Statistics, Insights, backup/restore.
// Usage: node bw-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const base = require('./wk-seed.js'); // workouts + templates (no weigh-ins): an existing user's data
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const close = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = new Date(2026, 9, 29);
const ago = (n) => key(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - n));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 760 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  let answer = true;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await page.clock.setFixedTime(new Date('2026-10-29T19:00:00+01:00'));
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(base)]);
  await page.goto('http://localhost:3000/training-tracker/');
  const st = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const put = (data) => page.evaluate(([k, v]) => { localStorage.setItem(k, JSON.stringify(v)); }, [KEY, data]);
  const wait = (ms = 250) => page.waitForTimeout(ms);
  const tab = async (t) => { await go(page, t); await wait(); };
  const tiles = () => page.$$eval('#view .stats:first-of-type .stat .num', (n) => n.map((x) => x.textContent.trim()));
  const bwTiles = () => page.evaluate(() => [...document.querySelectorAll('#view .stats')][0] ? [...[...document.querySelectorAll('#view .stats')][0].querySelectorAll('.stat')].map((s) => `${s.querySelector('.num').textContent.trim()}|${s.querySelector('.lbl').textContent.trim()}`) : []);
  const workoutsJSON = JSON.stringify(base.workouts);

  /* A. Existing user, no weigh-ins yet */
  await tab('progress');
  check('A workouts overview still on Progress › Overview', (await page.innerText('#view')).includes('Total workouts'), true);
  await tab('body');
  check('A card shown under Progress › Body, empty', `${await page.isVisible('#bw-quick')}|${await page.innerText('[data-action=bw-log-today]')}`, 'true|Log today');
  check('A existing data has bodyweights default []', JSON.stringify((await page.evaluate(() => state.bodyweights))), '[]');
  await tab('statistics');
  check('A statistics: no weigh-ins message', (await page.innerText('#view')).includes('No weigh-ins yet'), true);
  check('A old "isn\'t recorded" placeholder gone', (await page.innerText('#view')).includes("isn't recorded"), false);
  await tab('body');

  /* B. Quick entry for today */
  for (const bad of ['', 'abc', '5', '999']) {
    await page.fill('#bw-quick', bad); await page.click('[data-action=bw-log-today]'); await wait(100);
  }
  check('B invalid entries rejected', (await st()).bodyweights?.length ?? 0, 0);
  await page.fill('#bw-quick', '81,4'); await page.click('[data-action=bw-log-today]'); await wait();
  let s = await st();
  check('B logged today, comma accepted', `${s.bodyweights.length}|${s.bodyweights[0].date}|${s.bodyweights[0].kg}`, `1|${ago(0)}|81.4`);
  check('B button now says Update today', await page.innerText('[data-action=bw-log-today]'), 'Update today');
  check('B tiles: latest, 7-day avg, change –', JSON.stringify(await bwTiles()), JSON.stringify(['81.4|Latest (kg)', '81.4|7-day avg (kg)', '–|Change (kg)']));
  answer = false;
  await page.fill('#bw-quick', '80.9'); await page.click('[data-action=bw-log-today]'); await wait();
  check('B same day asks; cancel keeps the first', `${dialogs.pop()?.includes('already logged 81.4 kg today')}|${(await st()).bodyweights.map((w) => w.kg).join()}`, 'true|81.4');
  answer = true;
  await page.fill('#bw-quick', '80.9'); await page.click('[data-action=bw-log-today]'); await wait();
  s = await st();
  check('B confirmed: replaced, still one entry per day', `${s.bodyweights.length}|${s.bodyweights[0].kg}|${dialogs.pop()?.includes('Replace it with 80.9 kg')}`, '1|80.9|true');

  /* D/E. Other date, edit, delete */
  await page.click('[data-action=bw-add]'); await wait();
  await page.fill('#bw-date', ago(1)); await page.fill('#bw-kg', '81.6'); await page.fill('#bw-note', '  After dinner  ');
  await page.click('[data-action=bw-save]'); await wait();
  s = await st();
  check('D other date saved, note trimmed, sorted by date', JSON.stringify(s.bodyweights.map((w) => `${w.date}:${w.kg}:${w.note || ''}`)), JSON.stringify([`${ago(1)}:81.6:After dinner`, `${ago(0)}:80.9:`]));
  await page.click('[data-action=bw-add]'); await wait();
  await page.$eval('#bw-date', (i) => { i.removeAttribute('max'); i.value = '2026-11-02'; });
  await page.fill('#bw-kg', '80');
  await page.click('[data-action=bw-save]'); await wait();
  check('D future date refused', `${dialogs.pop()}|${(await st()).bodyweights.length}`, "The date can't be in the future.|2");
  await page.click('[data-action=bw-cancel]'); await wait();
  // Edit yesterday's entry onto today's date → asks to replace today's entry
  await page.click('[data-action=bw-list]'); await wait();
  check('E list newest first with 7-day avg', (await page.$$eval('#sheet [data-action=bw-edit] .grow', (n) => n.map((x) => x.textContent.trim().split('\n')[0]))).slice(0, 2).join(), 'Today,YesterdayAfter dinner');
  const yId = s.bodyweights[0].id;
  await page.click(`#sheet [data-action=bw-edit][data-id="${yId}"]`); await wait();
  check('E editor prefilled', `${await page.inputValue('#bw-date')}|${await page.inputValue('#bw-kg')}|${await page.inputValue('#bw-note')}`, `${ago(1)}|81.6|After dinner`);
  await page.fill('#bw-kg', '81.5'); await page.fill('#bw-date', ago(0));
  answer = false;
  await page.click('[data-action=bw-save]'); await wait();
  check('E moving onto a logged day asks; cancel keeps both', `${dialogs.pop()?.includes('already logged 80.9 kg today')}|${(await st()).bodyweights.length}|${await page.isVisible('#bw-kg')}`, 'true|2|true');
  answer = true;
  await page.fill('#bw-date', ago(2));
  await page.click('[data-action=bw-save]'); await wait();
  s = await st();
  check('E edit saved in place (same id), back to list', `${s.bodyweights.find((w) => w.id === yId).date}|${s.bodyweights.find((w) => w.id === yId).kg}|${s.bodyweights.length}|${await page.isVisible('#sheet [data-action=bw-edit]')}`, `${ago(2)}|81.5|2|true`);
  await page.click(`#sheet [data-action=bw-edit][data-id="${yId}"]`); await wait();
  answer = false;
  await page.click('[data-action=bw-delete]'); await wait();
  check('E delete asks; cancel keeps', `${dialogs.pop()?.startsWith('Delete the weigh-in of 81.5 kg on')}|${(await st()).bodyweights.length}`, 'true|2');
  answer = true;
  await page.click('[data-action=bw-delete]'); await wait();
  check('E deleted', `${(await st()).bodyweights.length}|${(await st()).bodyweights[0].kg}`, '1|80.9');
  await page.click('#sheet [data-action=close-sheet]'); await wait();

  /* F. 7-day average and change, gaps not filled in */
  s = await st();
  s.bodyweights = [
    { id: 'a0', date: ago(0), kg: 80 }, { id: 'a2', date: ago(2), kg: 81 }, { id: 'a6', date: ago(6), kg: 82 }, // this window: 81
    { id: 'a7', date: ago(7), kg: 84 }, { id: 'a10', date: ago(10), kg: 83 }, { id: 'a13', date: ago(13), kg: 85 }, // prev window: 84
    { id: 'a14', date: ago(14), kg: 90 } // outside both
  ];
  await put(s); await page.reload(); await wait(500); await tab('body');
  check('F 7-day avg = mean of days 0–6 only; change vs days 7–13', JSON.stringify(await bwTiles()), JSON.stringify(['80|Latest (kg)', '81|7-day avg (kg)', '−3|Change (kg)']));
  check('F calc functions agree', await page.evaluate(() => { const l = weighIns(); const t = weightTrend(l); return `${t.cur.avg}|${t.cur.n}|${t.prev.avg}|${t.prev.n}|${t.change}`; }), '81|3|84|3|-3');
  check('F single weigh-in in prev window → no change shown', await page.evaluate(() => { const l = weighIns().filter((w) => !['a10', 'a13'].includes(w.id)); return weightTrend(l).change; }), null);
  check('F window with 1 weigh-in = that weigh-in (days −20..−14)', await page.evaluate(() => weightAverage(weighIns(), sAddDays(sDay(new Date()), -14)).avg), 90);
  check('F window with none = null', await page.evaluate(() => weightAverage(weighIns(), sAddDays(sDay(new Date()), -15))), null);

  /* G. Target weight */
  await page.click('[data-action=bw-goal]'); await wait();
  check('G goal editor prefills start with 7-day avg', await page.inputValue('#bw-start'), '81');
  await page.fill('#bw-target', '78'); await page.fill('#bw-start', '84');
  await page.click('[data-action=bw-goal-save]'); await wait();
  s = await st();
  check('G goal stored in kg with start date', JSON.stringify(s.settings.weightGoal), JSON.stringify({ targetKg: 78, startKg: 84, startDate: ago(0) }));
  check('G progress: (84−81)/(84−78)=50%, 3 kg to go', (await page.innerText('#view .bw-goal')).replace(/\s+/g, ' '), (t) => t.includes('Target 78 kg') && t.includes('3 kg to go') && t.includes('50%'));
  check('G bar width 50%', await page.$eval('#view .bw-bar span', (b) => b.style.width), '50%');
  check('G gaining direction + reached + clamp', await page.evaluate(() => JSON.stringify([
    weightGoalProgress({ targetKg: 90, startKg: 80 }, 85), weightGoalProgress({ targetKg: 78, startKg: 84 }, 77.5), weightGoalProgress({ targetKg: 78, startKg: 84 }, 86)].map((p) => `${p.direction}:${Math.round(p.pct)}:${p.toGo}:${p.reached}`))), '["gain:50:5:false","lose:100:0:true","lose:0:8:false"]');
  await page.click('[data-action=bw-goal]'); await wait();
  await page.fill('#bw-target', '84');
  await page.click('[data-action=bw-goal-save]'); await wait();
  check('G target = start refused', dialogs.pop(), 'The target and the starting weight are the same.');
  await page.fill('#bw-target', '79');
  await page.click('[data-action=bw-goal-save]'); await wait();
  check('G editing target keeps start date', JSON.stringify((await st()).settings.weightGoal), JSON.stringify({ targetKg: 79, startKg: 84, startDate: ago(0) }));

  /* H. Pounds: shown and typed in lb, stored in kg */
  await tab('settings'); await page.click('[data-action=unit][data-unit=lb]'); await tab('body');
  check('H tiles in lb', JSON.stringify((await bwTiles()).slice(0, 2)), JSON.stringify(['176.4|Latest (lb)', '178.6|7-day avg (lb)']));
  await page.fill('#bw-quick', '180'); await page.click('[data-action=bw-log-today]'); await wait();
  s = await st();
  check('H 180 lb stored as kg, shown as 180', `${close(s.bodyweights.find((w) => w.date === ago(0)).kg, 180 * 0.45359237)}|${(await bwTiles())[0]}`, 'true|180|Latest (lb)');
  check('H out-of-range message in lb', await page.evaluate(() => parseWeightInput('20').error), 'Enter a weight between 44.1 and 881.8 lb.');
  await tab('settings'); await page.click('[data-action=unit][data-unit=kg]'); await tab('body');
  s = await st(); s.bodyweights.find((w) => w.date === ago(0)).kg = 80; await put(s); await page.reload(); await wait(500); await tab('body');

  /* I. Chart */
  check('I 30-day chart with dots + avg line', `${await page.$$eval('#view .bw-chart .wdot', (d) => d.length)}|${await page.$$eval('#view .bw-chart .line', (d) => d.length)}`, '7|1');
  check('I target line drawn when near the data', await page.$$eval('#view .bw-chart .target', (d) => d.length), 1);
  check('I chart labels are real values only', (await page.$$eval('#view .bw-chart text.lbl', (t) => t.map((x) => x.textContent))).join('|'), (v) => v === 'Target 79|90|80|15 Oct|29 Oct');
  check('I chart with 0/1 weigh-ins shows a message', await page.evaluate(() => [weightChart([]), weightChart(weighIns().slice(-1))].map((h) => h.includes('Log at least two')).join()), 'true,true');
  check('I far target noted, not squashed', await page.evaluate(() => weightChart(weighIns(), { target: 50 }).includes('target below the chart')), true);

  /* J. Statistics */
  await tab('statistics');
  check('J statistics: chart + tiles', `${await page.$$eval('#view .bw-chart', (c) => c.length)}|${(await page.innerText('#view')).replace(/\s+/g, ' ').includes('7 Weigh-ins')}`, '1|true');
  await page.click('[data-action=bw-range][data-v="1m"]'); await wait();
  check('J range 1M', `${await page.$eval('[data-action=bw-range][data-v="1m"]', (b) => b.classList.contains('on'))}|${(await page.innerText('#view')).replace(/\s+/g, ' ').includes('7 Weigh-ins')}`, 'true|true');
  check('J lowest/highest', (await page.innerText('#view')).replace(/\s+/g, ' '), (t) => t.includes('80 Lowest (kg)') && t.includes('90 Highest (kg)'));

  /* K. Insights */
  await tab('insights');
  let ins = (await page.innerText('#view')).replace(/\s+/g, ' ');
  // Last complete week = 19–25 Oct (ago 4..10): weigh-ins a6(82), a7(84), a10(83) → 83; week before 12–18 Oct: a13(85), a14(90) → 87.5
  check('K weekly report row: calendar-week averages 83 vs 87.5', await page.$eval('#view .report tr:has(th:text("Body weight avg (kg)"))', (r) => [...r.querySelectorAll('td')].map((x) => x.textContent.trim()).join('|')).catch(() => 'none'), '83|87.5|−4.5');
  check('K weight shown in the Body weight overview, not as a workout card', `${await page.isVisible('.bw-ins')}|${await page.$$eval('.insight-card', (c) => c.some((x) => x.textContent.includes('Body weight')))}`, 'true|false');
  check('K weekly report row, neutral change', `${ins.includes('Body weight avg (kg)')}|${await page.$eval('#view .report tr:has(th:text("Body weight avg (kg)")) .chg', (c) => `${c.textContent}|${c.classList.contains('up') || c.classList.contains('down')}`).catch(() => 'none')}`, (v) => v.startsWith('true|') && v.endsWith('|false'));
  s = await st(); s.bodyweights = s.bodyweights.filter((w) => w.id !== 'a14'); await put(s); await page.reload(); await wait(500); await tab('insights');
  check('K weigh-ins removed: report row follows', await page.$eval('#view .report tr:has(th:text("Body weight avg (kg)"))', (r) => r.querySelectorAll('td')[1].textContent.trim()).catch(() => 'none'), '85');
  check('K no weight row/note without weigh-ins', await page.evaluate(() => { const b = state.bodyweights; state.bodyweights = []; const h = renderInsights(); state.bodyweights = b; return h.includes('Body weight'); }), false);
  check('K workout data untouched so far', JSON.stringify((await st()).workouts), workoutsJSON);

  /* L. Backup / restore */
  const restoreFile = async (obj, name = 'backup.json') => {
    await tab('settings');
    await page.setInputFiles('#import-file', { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });
    await wait(400);
  };
  const confirmRestore = async () => {
    if (await page.$('#sheet [data-action=restore-toggle-copy][aria-checked=true]')) await page.click('#sheet [data-action=restore-toggle-copy]');
    await page.click('#sheet [data-action=restore-confirm]'); await wait(500);
  };
  const exported = await page.evaluate(() => buildBackup());
  check('L export has weigh-ins, count and target', `${exported.data.bodyweights.length}|${exported.counts.bodyweights}|${JSON.stringify(exported.data.settings.weightGoal)}`, `6|6|${JSON.stringify({ targetKg: 79, startKg: 84, startDate: ago(0) })}`);
  const mine = JSON.parse(JSON.stringify((await st()).bodyweights));
  // L1. Older backup without any weight data: weigh-ins and target kept (logic, not just UI)
  const old = JSON.parse(JSON.stringify(base)); delete old.bodyweights; old.workouts = old.workouts.slice(0, 1); old.settings = { unit: 'kg', rest: 60 };
  await restoreFile(old, 'old.json');
  const conf = (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  check('L1 confirm says no weight data, weigh-ins kept', conf.includes('no weight data') && conf.includes('Your weigh-ins are kept.') && conf.includes('the 6 weigh-ins and the target weight on this device will stay'), true);
  check('L1 replace text does not list weigh-ins', conf.includes('weigh-ins and your settings on this device will be replaced'), false);
  await confirmRestore();
  s = await st();
  check('L1 restored workouts, kept weigh-ins + target', `${s.workouts.length}|${JSON.stringify(s.bodyweights) === JSON.stringify(mine)}|${s.settings.weightGoal?.targetKg}|${s.settings.rest}`, '1|true|79|60');
  check('L1 pure restore logic keeps weigh-ins', await page.evaluate((o) => { const r = validateBackup(o); const n = restoredState(r, { bodyweights: [{ id: 'x', date: '2026-10-01', kg: 70 }], settings: {} }, { source: 'file' }); return `${r.weights.count}|${r.weights.field}|${n.bodyweights.length}|${n.bodyweights[0].kg}`; }, old), '0|false|1|70');
  // L2. Backup with an empty weigh-in list also keeps them (it contains no weight data)
  const emptyList = { ...JSON.parse(JSON.stringify(exported)) }; emptyList.data.bodyweights = []; emptyList.counts.bodyweights = 0; delete emptyList.data.settings.weightGoal;
  check('L2 empty weigh-in list keeps current', await page.evaluate((o) => { const r = validateBackup(o); return restoredState(r, state, { source: 'file' }).bodyweights.length; }, emptyList), 6);
  // L3. Backup with weigh-ins replaces them
  const other = JSON.parse(JSON.stringify(exported));
  other.data.bodyweights = [{ id: 'z1', date: '2026-09-01', kg: 90 }, { id: 'z2', date: '2026-09-02', kg: 89.5, note: 'x' }]; other.counts.bodyweights = 2;
  other.data.settings.weightGoal = { targetKg: 85, startKg: 90, startDate: '2026-09-01' };
  await restoreFile(other, 'new.json');
  const conf3 = (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  check('L3 confirm lists 2 weigh-ins in backup and 6 replaced', conf3.includes('2 weigh-ins') && conf3.includes('6 weigh-ins and your settings') && !conf3.includes('are kept'), true);
  await confirmRestore();
  s = await st();
  check('L3 weigh-ins and target replaced', `${s.bodyweights.map((w) => w.id).join()}|${s.settings.weightGoal.targetKg}|${s.workouts.length}`, `z1,z2|85|${base.workouts.length}`);
  // L4. Undo last restore brings back exactly the previous weigh-ins
  await tab('settings'); await page.click('[data-action=undo-restore]'); await wait(300); await confirmRestore();
  s = await st();
  check('L4 undo restores previous weigh-ins exactly', `${JSON.stringify(s.bodyweights) === JSON.stringify(mine)}|${s.settings.weightGoal.targetKg}|${s.workouts.length}`, 'true|79|1');
  // L5. Undo copy saved by the previous app version (no weigh-in field) keeps today's weigh-ins
  const legacyCopy = JSON.parse(JSON.stringify(old)); legacyCopy.exportedAt = '2026-10-20T10:00:00.000Z';
  check('L5 undo with pre-weight copy keeps weigh-ins', await page.evaluate((o) => { const r = validateBackup(o); return restoredState(r, state, { source: 'undo' }).bodyweights.length; }, legacyCopy), 6);
  check('L5 undo with a copy that has weigh-ins is exact', await page.evaluate((o) => { const r = validateBackup(o); return restoredState(r, state, { source: 'undo' }).bodyweights.map((w) => w.id).join(); }, other), 'z1,z2');
  // L6. Invalid weigh-in data rejects the whole file
  const bads = {
    'duplicate date': [{ id: 'b1', date: '2026-09-01', kg: 80 }, { id: 'b2', date: '2026-09-01', kg: 81 }],
    'bad weight': [{ id: 'b1', date: '2026-09-01', kg: 5 }],
    'text weight': [{ id: 'b1', date: '2026-09-01', kg: '80' }],
    'bad date': [{ id: 'b1', date: '2026-13-40', kg: 80 }],
    'no id': [{ date: '2026-09-01', kg: 80 }],
    'not a list': { a: 1 }
  };
  const rej = await page.evaluate(([b, bads]) => Object.entries(bads).map(([n, list]) => { const o = JSON.parse(JSON.stringify(b)); o.data.bodyweights = list; delete o.counts.bodyweights; const r = validateBackup(o); return `${n}:${r.ok ? 'accepted' : 'rejected'}`; }).join(), [exported, bads]);
  check('L6 invalid weigh-ins rejected', rej, 'duplicate date:rejected,bad weight:rejected,text weight:rejected,bad date:rejected,no id:rejected,not a list:rejected');
  check('L6 count mismatch rejected', await page.evaluate((b) => { const o = JSON.parse(JSON.stringify(b)); o.counts.bodyweights = 9; return validateBackup(o).ok; }, exported), false);
  check('L6 invalid target dropped with warning', await page.evaluate((b) => { const o = JSON.parse(JSON.stringify(b)); o.data.settings.weightGoal = { targetKg: 'x' }; const r = validateBackup(o); return `${r.ok}|${'weightGoal' in r.state.settings}|${r.warnings.some((w) => w.includes('target weight'))}`; }, exported), 'true|false|true');
  // L7. Real file round trip through the export button
  await tab('settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
  const file = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  check('L7 exported file contains weigh-ins', `${file.data.bodyweights.length}|${file.counts.bodyweights}`, '6|6');

  /* M. Erase all + undo */
  await page.click('[data-action=reset]'); await wait(300);
  check('M erase mentions weigh-ins and clears them', `${dialogs.pop()?.includes('weigh-ins')}|${(await st()).bodyweights.length}`, 'true|0');
  await page.click('[data-action=undo-restore]'); await wait(300); await confirmRestore();
  check('M undo after erase brings weigh-ins back', (await st()).bodyweights.length, 6);

  /* N. Persistence, workout tab untouched */
  await page.reload(); await wait(500);
  check('N weigh-ins survive reload', (await st()).bodyweights.length, 6);
  await tab('workout');
  check('N workout start screen unchanged', `${await page.isVisible('#view [data-action=start-flow]')}|${(await page.innerText('#view')).includes('weigh')}`, 'true|false');

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`${scheme} ${width}px — PASSES: ${results.filter((r) => r.startsWith('PASS')).length}  FAILS: ${results.filter((r) => r.startsWith('FAIL')).length}`);
  await browser.close();
})();
