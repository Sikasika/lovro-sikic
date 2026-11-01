// Statistics fixes: workouts over 4 h (overnight), activity time in the filtered heatmap,
// one set-count rule (working + drop sets, no warm-ups) across the Statistics cards.
// Usage: node statfix-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const V39 = '6a681b2'; // the release before these fixes
const OLD_PORT = 3240 + (scheme === 'dark' ? 2 : 0) + (width === 320 ? 1 : 0);
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const up = (port) => new Promise((res) => http.get(`http://localhost:${port}/training-tracker/`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));

(async () => { try { await main(); } catch (e) { console.log(results.join('\n')); console.log('CRASH', e.stack.split('\n').slice(0, 12).join(' / ')); console.log('PASSES: 0  FAILS: 1'); process.exit(1); } })();
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.clock.setFixedTime(new Date('2026-11-25T09:00:00+01:00')); // Wednesday
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 200) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const txt = async (s) => (await page.innerText(s)).replace(/\s+/g, ' ');
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#view *, #sheet *')].every((el) => el.offsetParent === null || el.closest('svg') || el.closest('#heat-scroll') || el.getBoundingClientRect().right <= window.innerWidth + 1));
  await ev(() => {
    window.U = {
      id: (n) => state.exercises.find((e) => e.name === n).id,
      // start "YYYY-MM-DDTHH:MM" local; min = minutes until end (null = no end time)
      w(start, entries, min = 60, extra = {}) {
        const id = `w${state.workouts.length + 1}`;
        const w = { id, name: `W${state.workouts.length + 1}`, notes: '', start: new Date(start).toISOString(), entries: entries.map(([n, sets]) => ({ exerciseId: U.id(n), sets })), ...extra };
        if (min != null) w.end = new Date(Date.parse(start) + min * 60000).toISOString();
        state.workouts.push(w); state.workouts.sort((a, b) => new Date(b.start) - new Date(a.start)); save(); return id;
      },
      lift: (k, w = 80, r = 5) => Array.from({ length: k }, () => ({ weight: w, reps: r, done: true })),
      run: (m, s) => [{ distance: m, duration: s, done: true }],
      reset() { localStorage.clear(); state = defaultState(); ui.stats.filter = 'all'; ui.stats.period = '30d'; save(); closeSheet(); ui.tab = 'home'; render(); },
      stats(f = 'all', period = '30d') { closeSheet(); ui.stats.filter = f; ui.stats.period = period; ui.tab = 'statistics'; render(); },
      card(label) { const c = [...document.querySelectorAll('#view .stat')].find((x) => x.querySelector('.lbl')?.textContent.trim() === label); return c ? `${c.querySelector('.num').textContent.trim()}|${c.querySelector('.stat-hint')?.textContent.trim() || ''}` : null; },
      cell: (day) => document.querySelector(`.heat-cell[data-day="${day}"]`)?.getAttribute('aria-label') || '',
      cellBg: (day) => document.querySelector(`.heat-cell[data-day="${day}"]`)?.getAttribute('style') || '',
      item: (id) => completedWorkouts().items.find((it) => it.w.id === id)
    };
  });

  /* A. Workouts over 4 hours */
  await ev(() => U.reset());
  const ids = await ev(() => ({
    night: U.w('2026-11-23T19:00', [['Bench Press', U.lift(3)]], 870), // 19:00 → 09:30 next day = 14.5 h
    normal: U.w('2026-11-20T07:00', [['Squat', U.lift(3, 100)]], 60),
    four: U.w('2026-11-18T07:00', [['Squat', U.lift(3, 100)]], 240), // exactly 4 h: counts
    noend: U.w('2026-11-16T07:00', [['Squat', U.lift(3, 100)]], null)
  }));
  let r = await ev((i) => { const a = U.item(i.night), b = U.item(i.four); return `${a.min}|${a.rawMin}|${a.long}|${b.min}|${b.long}`; }, ids);
  check('A1 overnight 14.5 h: kept as a workout, its time not counted (long); exactly 4 h still counts', r, 'null|870|true|240|false');
  await ev(() => U.stats()); await wait();
  check('A1 Training time: 5 h (1 h + 4 h), with the reasons named', await ev(() => U.card('Training time')), '5 h|1 without duration, 1 over 4 h not counted');
  check('A1 the overnight workout still counts as a workout and its volume counts', `${await ev(() => U.card('Workouts'))}|${await ev(() => U.card('Volume (kg)'))}`, (v) => v.startsWith('4|') && v.includes('|5,700|')); // 3×400 bench + 3 × 1,500 squat
  check('A1 heatmap day (All): "no counted duration, 1 over 4 h not counted" (not 14.5 h)', await ev(() => U.cell('2026-11-23')), (v) => v.includes('no counted duration') && v.includes('1 over 4 h not counted') && !v.includes('14.5'));
  await page.click('.heat-cell[data-day="2026-11-23"]'); await wait(300);
  r = await txt('#sheet');
  check('A1 day sheet: the real span, "over 4 h: not counted", a link to check it', `${r.includes('14 h 30 min, over 4 h: not counted')}|${!!(await page.$('#sheet [data-action=open-workout]'))}`, 'true|true');
  await page.click('#sheet [data-action=open-workout]'); await wait(300);
  r = await txt('#sheet');
  check('A2 History detail: warning with start/end and both choices', `${r.includes('14 h 30 min is unusually long')}|${r.includes('the next day')}|${!!(await page.$('#sheet [data-action=edit-workout].btn'))}|${!!(await page.$('#sheet [data-action=confirm-long]'))}`, 'true|true|true|true');
  check('A2 warning fits the screen', await noOverflow(), true);
  await page.click('#sheet [data-action=confirm-long]'); await wait(300);
  r = await ev((i) => { const w = state.workouts.find((x) => x.id === i.night); return `${w.durationConfirmed}|${U.item(i.night).min}|${JSON.parse(localStorage.getItem('training-tracker.v1')).workouts.find((x) => x.id === i.night).durationConfirmed}`; }, ids);
  check('A2 "It Lasted This Long": saved as confirmed, now counted (870 min)', r, 'true|870|true');
  check('A2 the detail now says it is confirmed and counted', (await txt('#sheet')).includes('confirmed: counted in training time'), true);
  await ev(() => U.stats()); await wait();
  check('A2 Training time now includes it: 19.5 h', await ev(() => U.card('Training time')), '19.5 h|1 without duration');
  await ev((i) => { closeSheet(); openSheet(renderWorkoutDetail(state.workouts.find((x) => x.id === i.night))); }, ids); await wait();
  await page.click('#sheet [data-action=unconfirm-long]'); await wait(300);
  check('A2 "Don\'t count this time" undoes it', await ev((i) => `${'durationConfirmed' in state.workouts.find((x) => x.id === i.night)}|${U.item(i.night).min}`, ids), 'false|null');
  // Correct the end time
  await page.click('#sheet .long-note [data-action=edit-workout]'); await wait(300);
  check('A3 the editor shows the over-4-h hint', (await page.innerText('#wedit-duration')).includes('over 4 h: check the end time'), true);
  await page.fill('#wedit-end', '20:30'); await page.dispatchEvent('#wedit-end', 'input'); await wait(100);
  await page.click('#sheet [data-action=save-wedit]'); await wait(300);
  r = await ev((i) => { const w = state.workouts.find((x) => x.id === i.night); const e = new Date(w.end); return `${e.getDate()} ${e.getHours()}:${e.getMinutes()}|${U.item(i.night).min}|${U.item(i.night).long}|${!!document.querySelector('#sheet .long-note')}`; }, ids);
  check('A3 end time corrected to 20:30 the same evening: 90 min, counted, warning gone', r, '23 20:30|90|false|false');
  check('A3 sets unchanged by the edit', await ev((i) => JSON.stringify(state.workouts.find((x) => x.id === i.night).entries[0].sets), ids), JSON.stringify([{ weight: 80, reps: '5', done: true }, { weight: 80, reps: '5', done: true }, { weight: 80, reps: '5', done: true }]));
  // A confirmed long workout whose times are then edited loses the confirmation
  const conf = await ev(() => U.w('2026-11-22T08:00', [['Cycling', U.run(120000, 18000)]], 300, { durationConfirmed: true }));
  check('A4 a confirmed 5 h ride counts (300 min)', await ev((i) => U.item(i).min, conf), 300);
  await ev((i) => { beginWorkoutEdit(state.workouts.find((x) => x.id === i)); openWorkoutEditor(); }, conf); await wait();
  await page.fill('#wedit-end', '14:00'); await page.dispatchEvent('#wedit-end', 'input');
  await page.click('#sheet [data-action=save-wedit]'); await wait(300);
  check('A4 changing its times clears the confirmation (6 h is asked about again)', await ev((i) => `${'durationConfirmed' in state.workouts.find((x) => x.id === i)}|${U.item(i).long}`, conf), 'false|true');
  // History list and Progress mark it
  await ev(() => { closeSheet(); ui.tab = 'history'; render(); }); await wait();
  check('A5 History list marks the long workout "(check end time)", only that one', await ev(() => document.querySelectorAll('#view .hist-item .sub').length && [...document.querySelectorAll('#view .hist-item .sub')].filter((x) => x.textContent.includes('check end time')).length), 1);
  await ev(() => { ui.tab = 'progress'; render(); }); await wait();
  check('A5 Progress note explains the * (no end time or over 4 h)', (await txt('#view')).includes('lasted over 4 h'), true);

  // Finish: a workout left running overnight
  const startActive = (iso) => ev((s) => { state.active = { id: 'act', name: 'Evening', notes: '', start: new Date(s).toISOString(), entries: [{ exerciseId: U.id('Bench Press'), sets: [{ weight: 80, reps: '5', done: true }, { weight: 80, reps: '5', done: true }] }] }; save(); ui.tapGuardUntil = 0; ui.tab = 'workout'; render(); }, iso); // a fresh workout: no tap guard left from the last save
  const finish = async () => { await page.click('[data-action=finish]'); await wait(300); };
  await ev(() => U.reset());
  await startActive('2026-11-24T19:00');
  await finish();
  r = await txt('#sheet');
  check('A6 Finish after 14 h: warning with an end-time field and a confirm box', `${r.includes('Running for 14 h')}|${!!(await page.$('#finish-end'))}|${!!(await page.$('#finish-long-ok'))}`, 'true|true|true');
  check('A6 Finish warning fits the screen', await noOverflow(), true);
  await page.fill('#finish-end', '20:45');
  await page.click('#sheet .save-btn[data-action=save-workout]'); await wait(400);
  r = await ev(() => { const w = state.workouts.find((x) => x.id === 'act'); const e = new Date(w.end); return `${!state.active}|${e.getDate()} ${e.getHours()}:${e.getMinutes()}|${'durationConfirmed' in w}|${U.item('act').min}`; });
  check('A6 saved with the entered end time (20:45 that evening = 105 min, counted)', r, 'true|24 20:45|false|105');
  await ev(() => U.reset()); await startActive('2026-11-24T19:00'); await finish();
  await page.check('#finish-long-ok');
  await page.click('#sheet .save-btn[data-action=save-workout]'); await wait(400);
  check('A7 "It really lasted over 4 hours": saved now, confirmed and counted (840 min)', await ev(() => { const w = state.workouts[0]; return `${w.durationConfirmed}|${U.item('act').min}`; }), 'true|840');
  await ev(() => U.reset()); await startActive('2026-11-24T19:00'); await finish();
  await page.click('#sheet .save-btn[data-action=save-workout]'); await wait(400);
  check('A8 neither: saved as it is (sets kept), flagged long, time not counted', await ev(() => { const it = U.item('act'); return `${state.workouts.length}|${it.entries[0].sets.length}|${it.long}|${it.min}`; }), '1|2|true|null');
  await ev(() => U.reset()); await startActive('2026-11-25T03:00'); await finish();
  dialogs.length = 0;
  await page.fill('#finish-end', '10:00');
  await page.click('#sheet .save-btn[data-action=save-workout]'); await wait(300);
  check('A9 an end time later than now is refused; nothing saved', `${dialogs[0]?.includes('later than now')}|${await ev(() => `${!!state.active}|${state.workouts.length}`)}`, 'true|true|0');
  await ev(() => closeSheet());
  await ev(() => U.reset()); await startActive('2026-11-25T07:30'); await finish();
  check('A10 a normal 1.5 h workout: no long-workout warning', `${!!(await page.$('#finish-end'))}|${(await txt('#sheet')).includes('Running for')}`, 'false|false');
  await page.click('#sheet .save-btn[data-action=save-workout]'); await wait(400);
  check('A10 saved with end = now and counted (90 min)', await ev(() => `${U.item('act').min}|${'durationConfirmed' in state.workouts[0]}`), '90|false');

  /* B. Filtered heatmap: a mixed workout's time is not given to one activity */
  await ev(() => U.reset());
  await ev(() => {
    U.w('2026-11-24T07:00', [['Bench Press', U.lift(3)], ['Running', U.run(3000, 900)]], 90); // mixed: 90 min, 15 min running
    U.w('2026-11-23T07:00', [['Running', U.run(10000, 3000)]], 60); // only cardio: 60 min
    U.w('2026-11-22T07:00', [['Squat', U.lift(3, 100)], ['Running', [{ distance: 2000, done: true }]]], 75); // mixed, cardio without time
    U.w('2026-11-21T19:00', [['Running', U.run(5000, 1800)]], 840); // cardio only, left running: 14 h
  });
  const labels = async (f) => { await ev((x) => U.stats(x), f); await wait(); return ev(() => ['2026-11-24', '2026-11-23', '2026-11-22', '2026-11-21'].map((d) => U.cell(d))); };
  let L = await labels('all');
  check('B All: mixed day = whole workout (1.5 h); cardio-only 1 h; mixed 75 min 1.3 h', `${L[0].includes('1.5 h')}|${L[1].includes(', 1 h')}|${L[2].includes('1.3 h')}`, 'true|true|true');
  check('B All: the overnight cardio day is not 14 h', `${L[3].includes('no counted duration')}|${L[3].includes('over 4 h not counted')}|${L[3].includes('14')}`, 'true|true|false');
  L = await labels('cardio');
  check('B Cardio: mixed day shows its 15 min of cardio (0.3 h), not 1.5 h', `${L[0].includes('0.3 h cardio time')}|${L[0].includes('1.5 h')}`, 'true|false');
  check('B Cardio: cardio-only workout keeps its whole time (1 h)', L[1].includes('1 h cardio time'), true);
  check('B Cardio: mixed workout with no cardio time logged: labelled "cardio time not known"', `${L[2].includes('cardio time not known')}|${/\d h/.test(L[2].split(',').slice(-1)[0])}`, 'true|false');
  check('B Cardio: overnight cardio-only uses the 30 min logged on its sets', L[3].includes('0.5 h cardio time'), true);
  check('B Cardio: shading follows cardio time (mixed day = lightest; 60 min = level 3)', await ev(() => `${U.cellBg('2026-11-24').includes(' 40%')}|${U.cellBg('2026-11-23').includes(' 82%')}`), 'true|true');
  check('B Cardio legend says how the time is found', (await txt('#view')).includes('otherwise the time logged on its cardio sets'), true);
  L = await labels('weights');
  check('B Weights: the mixed days are not given the whole workout time; labelled not known', `${L[0].includes('weights time not known')}|${L[0].includes('1.5 h')}|${L[2].includes('weights time not known')}`, 'true|false|true');
  check('B Weights: the cardio-only days are not shown', `${L[1].includes('no workouts')}|${L[3].includes('no workouts')}`, 'true|true');
  check('B Weights legend fits; whole view fits', await noOverflow(), true);
  await ev(() => U.w('2026-11-24T18:00', [['Squat', U.lift(3, 100)]], 45));
  L = await labels('weights');
  check('B Weights: a weights-only workout the same day counts (45 min), the mixed one is named as unknown', `${L[0].includes('2 workouts')}|${L[0].includes('0.8 h weights time')}|${L[0].includes('1 without a known weights time')}`, 'true|true|true');
  L = await labels('all');
  check('B All stays the sum of whole workouts that day (90 + 45 = 2.3 h)', L[0].includes('2.3 h'), true);

  /* C. Set counts: working + drop, no warm-ups, in every Statistics card */
  await ev(() => U.reset());
  await ev(() => {
    U.w('2026-11-24T07:00', [['Bench Press', [{ weight: 40, reps: 10, type: 'warmup', done: true }, ...U.lift(3), { weight: 60, reps: 8, type: 'drop', done: true }]], ['Running', U.run(3000, 900)]], 60);
    U.w('2026-11-20T07:00', [['Squat', [{ weight: 60, reps: 5, type: 'warmup', done: true }, { weight: 60, reps: 5, type: 'warmup', done: true }, ...U.lift(2, 100)]]], 60);
  });
  await ev(() => U.stats('weights')); await wait();
  let v = await txt('#view');
  const catRow = (name) => ev((n) => { const r = [...document.querySelectorAll('#view .hbar, #view .hb-row, #view [class*=hbar]')].find((x) => x.textContent.includes(n) && /sets ·/.test(x.textContent)); return r ? r.textContent.replace(/\s+/g, ' ').trim() : ''; }, name);
  check('C Weights summary: Sets = 4 + 2 = 6 (working + drop), hint names the rule', await ev(() => U.card('Sets')), '6|Working + drop sets, no warm-ups');
  check('C per-exercise rows: Bench 4 sets, Squat 2 sets', `${v.includes('Bench Press 1 session · 4 sets')}|${v.includes('Squat 1 session · 2 sets')}`, 'true|true');
  check('C Sets by category uses the same rule: Chest 4, Legs 2', `${await catRow('Chest')}|${await catRow('Legs')}`, (x) => /Chest.*4 sets/.test(x.split('|')[0]) && /Legs.*2 sets/.test(x.split('|')[1]));
  check('C Sets by category note states the rule', v.includes('warm-ups are not counted anywhere in Statistics'), true);
  check('C volume still leaves warm-ups out: 3×400 + 480 + 2×500 = 2,680', await ev(() => U.card('Volume (kg)')), (x) => x.startsWith('2,680') || x.startsWith('2680'));
  await ev(() => U.stats('all')); await wait();
  check('C All view, Sets by category: Chest 4, Legs 2, Cardio 1', `${await catRow('Chest')}|${await catRow('Legs')}|${await catRow('Cardio')}`, (x) => { const [a, b, c] = x.split('|'); return /4 sets/.test(a) && /2 sets/.test(b) && /1 sets?/.test(c); });
  await page.click('.heat-cell[data-day="2026-11-24"]'); await wait(300);
  check('C day sheet shows every logged set and names the warm-up: "6 sets incl. 1 warm-up"', (await txt('#sheet')).includes('6 sets incl. 1 warm-up'), true);
  await ev(() => { closeSheet(); ui.tab = 'history'; render(); }); await wait();
  v = await txt('#view');
  check('C History list: "6 sets incl. 1 warm-up" and "4 sets incl. 2 warm-ups"', `${v.includes('6 sets incl. 1 warm-up')}|${v.includes('4 sets incl. 2 warm-ups')}`, 'true|true');
  await page.click('#view .hist-item >> nth=0'); await wait(300);
  check('C History detail: Sets done 6, "Incl. 1 warm-up"', (await txt('#sheet')).includes('6 Sets done Incl. 1 warm-up'), true);
  check('C History detail fits', await noOverflow(), true);
  await ev(() => closeSheet());

  /* D. Older data and backups */
  await ev(() => U.reset());
  // A backup as v39 wrote it: an overnight workout, no durationConfirmed anywhere
  const oldBackup = await ev(() => { U.w('2026-11-23T19:00', [['Bench Press', U.lift(3)]], 870); U.w('2026-11-20T07:00', [['Squat', U.lift(3, 100)]], 60); return buildBackup(); });
  r = await ev((bk) => { const v = validateBackup(bk); const s = restoredState(v, defaultState(), { source: 'file' }); state = s; save(); return `${v.ok}|${s.workouts.length}|${s.workouts.some((w) => 'durationConfirmed' in w)}|${completedWorkouts().items.filter((it) => it.long).length}`; }, oldBackup);
  check('D older backup: restores unchanged; the overnight workout is flagged, nothing added or dropped', r, 'true|2|false|1');
  r = await ev(() => { const w = state.workouts.find((x) => x.name === 'W1'); w.durationConfirmed = true; save(); const bk = buildBackup(); const v = validateBackup(JSON.parse(JSON.stringify(bk))); return `${bk.format}|${Object.keys(bk).join(',')}|${v.ok}|${restoredState(v, defaultState(), { source: 'file' }).workouts.find((x) => x.name === 'W1').durationConfirmed}`; });
  check('D new backup: same format, the confirmation round-trips', r, '1|app,kind,format,schemaVersion,exportedAt,counts,data|true|true');
  const newBackup = await ev(() => buildBackup());
  // Data saved by v39 (in localStorage) loads as is
  await ev(() => { const raw = JSON.parse(localStorage.getItem('training-tracker.v1')); raw.workouts.forEach((w) => delete w.durationConfirmed); localStorage.setItem('training-tracker.v1', JSON.stringify(raw)); });
  await page.reload(); await wait(400);
  check('D stored data without the new field loads; stats run (long one flagged)', await ev(() => `${state.workouts.length}|${completedWorkouts().items.filter((it) => it.long).length}|${typeof renderStatistics()}`), '2|1|string');
  // The real v39 app reads a v40 backup that has the new field
  const site = path.join(os.tmpdir(), `v39-site-${scheme}-${width}`);
  fs.rmSync(site, { recursive: true, force: true }); fs.mkdirSync(site, { recursive: true });
  execSync(`git -C "${path.join(__dirname, '..', '..')}" archive ${V39} training-tracker | tar -x -C "${site}"`);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), site, String(OLD_PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up(OLD_PORT)); i++) await new Promise((res) => setTimeout(res, 100));
  try {
    const old = await ctx.newPage();
    old.on('pageerror', (e) => errors.push(`v39: ${e.message}`));
    await old.goto(`http://localhost:${OLD_PORT}/training-tracker/`);
    r = await old.evaluate((bk) => { const v = validateBackup(bk); const s = restoredState(v, state, { source: 'file' }); return `${v.ok}|${s.workouts.length}|${s.workouts.find((w) => w.name === 'W1').durationConfirmed}`; }, newBackup);
    check('D the real v39 app restores a v40 backup and keeps the field', r, 'true|2|true');
    await old.close();
  } finally { server.kill(); }

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
}
