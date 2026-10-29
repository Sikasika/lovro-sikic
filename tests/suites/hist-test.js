// History: list entries, workout review, previous-session comparison. Usage: node hist-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const base = require('./hist-seed.js');
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const L = (s) => new Date(s).toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 760 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  let answer = true;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => (answer ? d.accept() : d.dismiss()));
  await page.clock.setFixedTime(new Date('2026-10-29T19:00:00+01:00'));
  await page.goto('http://localhost:3000/training-tracker/');
  const load = async (data) => {
    await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, data]);
    await page.reload(); await page.waitForTimeout(250);
    await page.click('[data-tab=history]'); await page.waitForTimeout(150);
  };
  const st = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const open = async (id) => { await page.click(`[data-action=open-workout][data-id="${id}"]`); await page.waitForTimeout(250); };
  const closeDetail = async () => { await page.click('#sheet .sheet-head [data-action=close-sheet]'); await page.waitForTimeout(150); };
  // Exercise cards in the detail view: { name, line, rows: ["label|value|cmp"] }
  const cards = () => page.$$eval('#sheet .hist-ex', (cs) => cs.map((c) => ({
    name: c.querySelector('.hist-ex-name').textContent,
    ss: c.querySelector('.ss-badge')?.textContent || '',
    note: c.querySelector('.detail-note')?.textContent.trim() || '',
    line: c.querySelector('.hcmp')?.textContent.replace(/\s+/g, ' ').trim() || '',
    rows: [...c.querySelectorAll('.hset')].map((r) => [r.querySelector('.hset-l'), r.querySelector('.hset-v'), r.querySelector('.hset-c')].map((x) => (x ? x.textContent.replace(/\s+/g, ' ').trim() : '')).join('|'))
  })));
  const listRows = () => page.$$eval('#view .hist-item', (r) => r.map((x) => `${x.dataset.id}|${x.querySelector('.hist-name').textContent}|${x.querySelector('.hist-date').textContent}|${x.querySelector('.sub').textContent}`));

  /* 1. List entries */
  const runOnly = { id: 'cardio', name: 'Easy run', notes: '', start: L('2026-10-28T07:00:00+01:00'), end: L('2026-10-28T07:30:00+01:00'),
    entries: [{ exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 5000, duration: 1500, done: true }] }] };
  const noEnd = { id: 'noend', name: 'Imported', notes: '', start: L('2026-09-30T07:00:00+02:00'),
    entries: [{ exerciseId: 'squat', sets: [{ weight: 80, reps: '5', done: true }] }] };
  const d1 = clone(base); d1.workouts = [runOnly, ...d1.workouts, noEnd];
  await load(d1);
  const lr = await listRows();
  check('1 list: name, date, duration, exercises, sets, volume', lr[1], 'new|Push & Run|Tue, 27 Oct|1:10:00 · 5 exercises · 9 sets · 2,125 kg');
  check('1 list: cardio-only workout has no volume', lr[0], 'cardio|Easy run|Wed, 28 Oct|30:00 · 1 exercise · 1 set');
  check('1 list: missing end time says so, no invented duration', lr[4], 'noend|Imported|Wed, 30 Sept|No duration · 1 exercise · 1 set · 400 kg');
  check('1 list: chronological, grouped by month', (await page.$$eval('#view .section-title', (t) => t.map((x) => x.textContent))).join(), 'October 2026,September 2026');
  check('1 list: volume excludes warm-ups (same rule as before)', await page.evaluate(() => workoutVolume(state.workouts.find((w) => w.id === 'new'))), 2125);

  /* 2. Detail view */
  await open('new');
  check('2 header: back to History, name, Edit', `${await page.innerText('#sheet .sheet-head [data-action=close-sheet]')}|${await page.innerText('#sheet .sheet-head h2')}|${await page.innerText('#sheet .sheet-head [data-action=edit-workout]')}`, '‹ History|Push & Run|Edit');
  check('2 date + start time', await page.innerText('#sheet .hist-when'), 'Tuesday 27 October 2026 · 18:00');
  check('2 metrics', (await page.innerText('#sheet .hist-metrics')).replace(/\s+/g, ' '), '1:10:00 Duration 5 Exercises 9 Sets done 1 set not done 2,125 Volume (kg) Warm-ups excluded');
  let c = await cards();
  check('2 exercises in original order', c.map((x) => x.name).join(), 'Bench Press,Pull-up,Dips,Cable Fly,Running');
  check('2 superset badge once, both cards grouped', `${c.map((x) => x.ss).join('|')}|${await page.$$eval('#sheet .hist-ex.superset', (x) => x.length)}`, 'Superset A|||||2');
  check('2 exercise note', c[0].note, '📝 Pause reps');
  check('2 bench rows: warm-up, working with plan, drop', JSON.stringify(c[0].rows), JSON.stringify(['Warm-up|40 kg × 10|', 'Set 1|60 kg × 11|+1 repwas 60×10', 'Set 2|62.5 kg × 10plan 62.5×8|+2.5 kgwas 60×10', 'Drop set|40 kg × 12|samewas 40×12']));
  check('2 incomplete set shown and marked, not compared', c[1].rows[1], 'Set 2|8 reps Not done|');
  check('2 cardio set: distance, time, pace, speed', c[4].rows[0], 'Set 1|5.50 km · 26:00 · 4:44 /km · 12.7 km/h|');

  /* 3. Comparisons */
  check('3 previous = most recent earlier workout WITH the exercise (skips Legs on 24 Oct)', c[0].line, 'Previous Tue, 20 Oct: 60×10, 60×10, 60×8, D 40×12 · 1 working set fewer this time');
  check('3 warm-ups excluded from comparison (no delta on warm-up row)', c[0].rows[0].endsWith('|'), true);
  check('3 weighted vs bodyweight: previous shown, no change claimed', `${c[1].line}#${c[1].rows[0]}`, 'Previous Tue, 20 Oct: 10×6#Set 1|9 reps|was 10×6');
  check('3 unchanged: neutral "same"', c[2].rows[0], 'Set 1|12 reps|samewas 12 reps');
  check('3 no previous session', `${c[3].line}|${c[3].rows.every((r) => r.endsWith('|'))}`, 'No previous session|true');
  check('3 cardio: totals and changes vs previous', c[4].line, 'Previous Tue, 20 Oct: 5.00 km · 25:00 · +0.50 km · +1:00 · pace −0:16 /km');
  check('3 per-set comparisons stay neutral (only the trend line is coloured)', await page.$$eval('#sheet .hcmp .up, #sheet .hcmp .down, #sheet .hset-c .up, #sheet .hset-c .down, #sheet .rec.up, #sheet .rec.down', (x) => x.length), 0);
  check('3 no "better/worse/improved" wording', (await page.innerText('#sheet')), (t) => !/better|worse|improv|regress|great/i.test(t));
  await closeDetail();
  check('2 back returns to the History list', `${await page.isVisible('#sheet')}|${await page.isVisible('#view .hist-item')}`, 'false|true');
  await open('old');
  check('3 oldest workout: every exercise "No previous session"', (await cards()).map((x) => x.line).join('|'), 'No previous session|No previous session|No previous session|No previous session');
  await closeDetail();

  /* 3b. Edge cases built on the fixtures */
  const d2 = clone(base);
  // Earlier session that only had warm-ups for bench, and a done:false working set: both ignored
  d2.workouts.splice(1, 0, { id: 'warm', name: 'Warm-up only', notes: '', start: L('2026-10-25T10:00:00+02:00'), end: L('2026-10-25T10:30:00+02:00'),
    entries: [{ exerciseId: 'bench', sets: [{ weight: 40, reps: '10', done: true, type: 'warmup' }] }, { exerciseId: 'squat', sets: [{ weight: 100, reps: '5', done: true }] }] });
  d2.workouts.find((w) => w.id === 'old').entries[0].sets.splice(1, 0, { weight: 70, reps: '2', done: false });
  // Current has more working sets than before on Dips, and an exercise with only warm-ups
  d2.workouts[0].entries[2].sets.push({ weight: '', reps: '10', done: true }, { weight: '', reps: '8', done: true });
  d2.workouts[0].entries.push({ exerciseId: 'squat', sets: [{ weight: 60, reps: '8', done: true, type: 'warmup' }] });
  await load(d2);
  await open('new');
  c = await cards();
  check('3b warm-up-only and not-done earlier sets never used as "previous"', c[0].line.startsWith('Previous Tue, 20 Oct: 60×10, 60×10, 60×8'), true);
  check('3b more sets than before: extra sets get no invented match', `${c[2].line}#${c[2].rows.map((r) => r.split('|')[2]).join(',')}`, 'Previous Tue, 20 Oct: 12 reps · 2 working sets more this time#samewas 12 reps,,');
  check('3b only warm-ups this time: says nothing to compare', c[5].line, 'Previous Sun, 25 Oct: only warm-ups logged this time, so nothing to compare');
  check('3b pure function: drop sets only matched with drop sets', await page.evaluate(() => matchSets({ working: [{ weight: 50, reps: '5' }], drop: [] }, { working: [], drop: [{ weight: 50, reps: '5', type: 'drop' }] }).length), 0);
  await closeDetail();

  /* 3c. Pounds */
  await page.evaluate(() => { state.settings.unit = 'lb'; save(); render(); });
  await open('new');
  c = await cards();
  check('3c lb: values and changes in lb', `${c[0].rows[2]}`, 'Set 2|137.8 lb × 10plan 137.8×8|+5.5 lbwas 132.3×10');
  await closeDetail();
  await page.evaluate(() => { state.settings.unit = 'kg'; save(); render(); });

  /* 4. Editing a historical workout is reflected (detail and later comparisons) */
  await load(clone(base));
  await open('old');
  await page.click('#sheet [data-action=edit-workout]'); await page.waitForTimeout(250);
  await page.fill('#sheet input[data-wfield=weight][data-entry="0"][data-set="1"]', '57.5');
  await page.click('[data-action=save-wedit]'); await page.waitForTimeout(300);
  check('4 after edit, detail shows edited value', (await cards())[0].rows[1], 'Set 1|57.5 kg × 10|');
  await closeDetail();
  await open('new');
  check('4 later workout compares with the edited session', (await cards())[0].rows[1], 'Set 1|60 kg × 11|+2.5 kg, +1 repwas 57.5×10');
  // Edit the date of the later workout to before the old one: comparisons follow the dates
  await page.click('#sheet [data-action=edit-workout]'); await page.waitForTimeout(250);
  await page.fill('#wedit-date', '2026-10-15');
  await page.click('[data-action=save-wedit]'); await page.waitForTimeout(300);
  check('4 moved earlier: now has no previous session', (await cards())[0].line, 'No previous session');
  await closeDetail();
  check('4 list re-sorted by date', (await listRows()).map((r) => r.split('|')[0]).join(), 'mid,old,new');

  /* Delete from the detail view (moved to the bottom), with confirmation */
  await open('mid');
  answer = false;
  await page.click('#sheet [data-action=delete-workout]'); await page.waitForTimeout(200);
  check('delete asks; cancel keeps it', (await st()).workouts.length, 3);
  answer = true;
  await page.click('#sheet [data-action=delete-workout]'); await page.waitForTimeout(250);
  check('delete removes it and returns to the list', `${(await st()).workouts.length}|${await page.isVisible('#sheet')}`, '2|false');

  /* Active workout alongside History; detail opened from the Workout tab says Done */
  await page.click('[data-tab=workout]'); await page.click('[data-action=start-flow]'); await page.click('#sheet [data-action=start-empty]'); await page.waitForTimeout(600);
  await page.click('[data-tab=history]'); await page.waitForTimeout(150);
  check('active workout: live bar on History, list works', `${await page.isVisible('#live-bar')}|${(await listRows()).length}`, 'true|2');
  await open('old');
  check('active workout not shown or counted in History', (await page.innerText('#sheet')).includes('Afternoon Workout') || (await page.innerText('#sheet')).includes('Evening Workout'), false);
  await closeDetail();
  await page.click('#live-bar'); await page.waitForTimeout(200);
  await page.click('#view [data-action=discard]'); await page.waitForTimeout(600);
  await page.evaluate(() => { ui.savedId = 'old'; render(); });
  await page.click('#view .saved-card [data-action=open-workout]'); await page.waitForTimeout(250);
  check('detail opened from the Workout tab: "Done" instead of "‹ History"', await page.innerText('#sheet .sheet-head [data-action=close-sheet]'), 'Done');
  await closeDetail();

  /* Backup round trip keeps everything the review needs */
  const b = await page.evaluate(() => buildBackup());
  check('backup round trip unchanged', await page.evaluate((bk) => { const r = validateBackup(bk); return r.ok && JSON.stringify(r.state.workouts) === JSON.stringify(state.workouts); }, b), true);

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`${scheme} ${width}px — PASSES: ${results.filter((r) => r.startsWith('PASS')).length}  FAILS: ${results.filter((r) => r.startsWith('FAIL')).length}`);
  await browser.close();
})();
