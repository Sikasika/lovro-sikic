const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], width = +process.argv[3], scheme = process.argv[4] || 'light';
const KEY = 'training-tracker.v1';
const L = (s) => new Date(s).toISOString();
const data = {
  schemaVersion: 2, cardioExercisesAdded: true, settings: { unit: 'kg', rest: 90 },
  exercises: [{ id: 'bench', name: 'Incline Dumbbell Bench Press With Pause', category: 'Chest' }, { id: 'run', name: 'Running', category: 'Cardio' },
    { id: 'row', name: 'Barbell Row', category: 'Back' }, { id: 'padel', name: 'Padel', category: 'Sports' }, { id: 'swim', name: 'Swimming', category: 'Cardio' }, { id: 'old', name: 'Old', category: 'Legs', archived: true }],
  workouts: [
    { id: 'w2', name: 'A very long workout name that keeps going and going', location: 'Fitness Centar Zagreb Velesajam Hall B', notes: 'Notes '.repeat(30), templateId: 't1', start: L('2026-10-27T10:00:00'), end: L('2026-10-27T11:10:00'),
      entries: [
        { exerciseId: 'bench', note: 'Seat 4, wide grip, pause at the bottom for two seconds', superset: 's1', sets: [{ weight: 40, reps: '10', type: 'warmup', done: true }, { weight: 102.5, reps: '5', target: { weight: 100, reps: 5 }, done: true }, { weight: 80, reps: '8', type: 'drop', done: true }] },
        { exerciseId: 'row', superset: 's1', sets: [{ weight: 60, reps: '10', done: true }] },
        { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 12345, duration: 3725, done: true }, { weight: '', reps: '', distance: 5000, duration: 1500, done: true }] },
        { exerciseId: 'swim', sets: [{ weight: '', reps: '', distance: 1500, duration: 1800, done: true }] }] },
    { id: 'w1', name: 'Legacy', location: '', notes: '', start: L('2026-10-20T10:00:00'), end: L('2026-10-20T11:00:00'),
      entries: [{ exerciseId: 'old', sets: [{ weight: '50', reps: '10', done: true }] }, { exerciseId: 'padel', sets: [{ weight: '', reps: '1', done: true }] }, { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 10000, duration: 3000, done: true }] }, { exerciseId: 'bench', sets: [{ weight: 95, reps: '5', done: true }] }] }],
  templates: [{ id: 't1', name: 'Push day with a long template name', location: 'Gym A', entries: [{ exerciseId: 'bench', note: 'Belt', superset: 'a', sets: [{ weight: 60, reps: 5, type: 'warmup' }, { weight: 100, reps: 5 }] }, { exerciseId: 'row', superset: 'a', sets: [{ weight: '', reps: 10 }] }, { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 5000, duration: 1500 }] }] }],
  active: null,
  bodyweights: Array.from({ length: 40 }, (_, i) => { const d = new Date(2026, 9, 28 - i); return { id: `bw${i}`, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, kg: 101.3 + Math.sin(i) * 1.4 + i * 0.05, ...(i === 3 ? { note: 'A long note about how the weigh-in went after a very salty dinner' } : {}) }; }),
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone SE'], viewport: { width, height: 640 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  const errors = [], problems = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  page.on('dialog', (d) => d.dismiss());
  await page.clock.setFixedTime(new Date('2026-10-28T18:00:00+01:00'));
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(data)]);
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 250) => page.waitForTimeout(ms);
  let screens = 0;
  async function inspect(label) {
    screens++;
    const r = await page.evaluate(() => {
      const vw = window.innerWidth;
      const out = [];
      if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${vw}px)`);
      const sheet = document.querySelector('#sheet:not(.hidden) .sheet-body');
      if (sheet && sheet.scrollWidth > sheet.clientWidth + 1) out.push(`panel scrolls sideways (${sheet.scrollWidth} > ${sheet.clientWidth})`);
      document.querySelectorAll('input, select, textarea').forEach((el) => {
        if (el.offsetParent === null || el.type === 'file') return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) out.push(`${el.tagName.toLowerCase()}#${el.id || el.className} font ${fs}px (iOS zooms below 16px)`);
      });
      document.querySelectorAll('#view *, #sheet *').forEach((el) => {
        if (el.offsetParent === null || el.closest('.heat-scroll, .cat-chips, svg')) return;
        const b = el.getBoundingClientRect();
        if (b.width && b.right > vw + 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} sticks out (${Math.round(b.right)}px)`);
      });
      return [...new Set(out)];
    });
    r.forEach((x) => problems.push(`${label}: ${x}`));
  }
  const tab = async (t) => { await go(page, t); await wait(); };
  const close = async () => { const b = await page.$('#sheet:not(.hidden) .sheet-head .link:last-child'); if (b) await b.click(); await wait(); };

  await inspect('Today'); await tab('plans'); await inspect('Plans');
  await tab('workout'); await inspect('Workout start');
  await page.click('[data-action=start-flow]'); await wait(); await inspect('Start chooser');
  await page.click('#sheet [data-action=close-sheet]'); await wait();
  await page.click('[data-action=edit-template]'); await wait(); await inspect('Template editor');
  await page.click('#sheet .set-label[data-entry="0"][data-set="0"]'); await wait(); await inspect('Template set menu');
  await page.click('[data-action=set-menu-back]'); await wait();
  await page.click('[data-action=draft-add-exercise]'); await wait(); await inspect('Template exercise picker');
  await page.click('[data-action=back-to-template]'); await wait();
  await page.click('[data-action=cancel-template]'); await wait();
  await page.click('#view [data-action=review][data-kind=template]'); await wait(); await inspect('Template review'); await F.begin(); await inspect('Live workout from template');
  await tab('home'); await inspect('Today with a workout in progress'); await page.click('[data-action=continue-workout]'); await wait();
  await page.click('[data-action=entry-menu][data-entry="0"]'); await wait(); await inspect('Exercise menu'); await close();
  await page.click('.set-label[data-entry="0"][data-set="1"]'); await wait(); await inspect('Set menu');
  await page.click('[data-action=set-menu-back]'); await wait();
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
  await page.click('[data-action=toggle-set][data-entry="1"][data-set="0"]'); await wait(); // end of superset round -> rest
  await inspect('Rest timer showing');
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
  await page.click('[data-action=add-exercise]'); await wait(); await inspect('Exercise picker');
  await page.fill('#exercise-search', 'New thing with a really long name'); await wait(); await inspect('Picker create option');
  await page.click('[data-action=create-exercise]'); await wait(); await inspect('Category picker'); await close();
  await page.click('[data-action=finish]'); await wait(); await inspect('Finish summary');
  await page.click('#sheet [data-action=close-sheet]'); await wait();
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500)); await wait();

  await tab('history'); await inspect('History');
  await page.click('[data-action=open-workout][data-id="w2"]'); await wait(); await inspect('Workout details');
  await page.click('[data-action=edit-workout]'); await wait(); await inspect('Workout editor');
  await page.click('[data-action=cancel-wedit]'); await wait(); await page.click('#sheet .sheet-head [data-action=close-sheet]'); await wait();
  await tab('progress'); await inspect('Progress');
  await tab('body'); await inspect('Body weight');
  await page.click('[data-action=bw-list]'); await wait(); await inspect('Weigh-in list');
  await page.click('#sheet [data-action=bw-edit]'); await wait(); await inspect('Weigh-in editor');
  await page.click('[data-action=bw-cancel]'); await wait(); await page.click('#sheet [data-action=close-sheet]'); await wait();
  await page.click('[data-action=bw-goal]'); await wait(); await inspect('Target editor (none yet)');
  await page.fill('#bw-target', '95'); await page.click('[data-action=bw-goal-save]'); await wait(); await inspect('Progress with target');
  await page.click('[data-action=bw-add]'); await wait(); await inspect('Add weigh-in'); await page.click('[data-action=bw-cancel]'); await wait();
  await tab('progress');
  for (const ex of ['bench', 'run', 'padel']) { await page.selectOption('#progress-exercise', ex); await wait(); await inspect(`Progress ${ex}`); }
  await tab('insights'); await inspect('Insights week');
  await page.click('[data-iaction=week][data-dir="-1"]'); await wait(); await inspect('Insights current week');
  for (const v of ['strength', 'cardio', 'balance']) { await page.click(`[data-iaction=view][data-v="${v}"]`); await wait(); await inspect(`Insights ${v}`); }
  await page.click('[data-iaction=view][data-v="cardio"]'); await wait();
  await page.selectOption('#ins-cardio', 'swim'); await wait(); await inspect('Insights cardio swim');
  await page.click('[data-iaction=view][data-v="overview"]'); await wait();
  await tab('statistics'); await inspect('Statistics');
  for (const f of ['weights', 'cardio', 'sports', 'other', 'all']) { await page.click(`[data-saction=filter][data-v="${f}"]`); await wait(); await inspect(`Statistics filter ${f}`); }
  for (const ex of ['bench', 'run', 'swim', 'padel']) { await page.selectOption('#stats-perf-ex', ex); await wait(); await inspect(`Statistics performance ${ex}`); }
  await page.click('[data-saction=freq-mode][data-v="month"]'); await wait(); await inspect('Statistics monthly');
  await page.click('[data-day="2026-10-27"]'); await wait(); await inspect('Heatmap day'); await close();
  await tab('settings'); await inspect('Settings');
  await page.click('[data-action=unit][data-unit=lb]'); await wait();
  for (const t of ['workout', 'history', 'progress', 'statistics']) { await tab(t); await inspect(`${t} in lb`); }
  await tab('settings'); await page.click('[data-action=unit][data-unit=kg]');
  await page.click('[data-action=manage-exercises]'); await wait(); await inspect('Exercise manager');
  await page.click('[data-action=exm-edit][data-id="bench"]'); await wait(); await inspect('Exercise editor');
  await page.click('[data-action=exd-cancel]'); await wait(); await close();
  await page.setInputFiles('#import-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'training-tracker', format: 1, schemaVersion: 2, data })) }); await wait(500);
  await inspect('Restore confirm'); await page.click('[data-action=restore-cancel]'); await wait();
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('nope') }); await wait(500);
  await inspect('Restore error'); await close();

  // Plans: setup, review, running program, session, schedule, planned workout, swap, finish, History
  const shut = async () => { await page.evaluate(() => closeSheet()); await wait(); };
  await page.evaluate(() => { state.active = null; save(); render(); }); // finish with no workout in progress
  await tab('plans'); await page.click('[data-action=plan-setup][data-id=upper-lower-4]'); await wait(); await inspect('Program setup');
  await page.evaluate(() => { const d = (new Date().getDay() + 6) % 7; ui.planSetup.days = [d, (d + 1) % 7, (d + 3) % 7, (d + 4) % 7]; openProgramSetup(ui.planSetup.id, true); }); await wait();
  await page.click('[data-action=ps-review]'); await wait(); await inspect('Program review');
  await page.click('[data-action=ps-start]'); await wait(); await inspect('Plans with a program');
  await page.click('.plan-card .plan-sess'); await wait(); await inspect('Plan session');
  await page.click('#sheet [data-action=plan-open]'); await wait(); await inspect('Plan schedule'); await shut();
  await tab('home'); await inspect('Today with a planned session');
  await page.click('#view [data-action=review][data-kind=planned]'); await wait(); await inspect('Planned review');
  await page.click('#sheet [data-action=begin]'); await wait(600); await inspect('Planned workout');
  await page.click('[data-action=entry-menu][data-entry="0"]'); await wait(); await inspect('Planned exercise menu');
  await page.click('#sheet [data-action=swap-exercise]'); await wait(); await inspect('Swap picker');
  await page.click('#sheet [data-action=pick-exercise] >> nth=0'); await wait(); await inspect('Swapped exercise');
  await page.fill('[data-field=weight][data-entry="1"][data-set="0"]', '50'); await page.fill('[data-field=reps][data-entry="1"][data-set="0"]', '8');
  await page.click('[data-action=toggle-set][data-entry="1"][data-set="0"]'); await wait();
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
  await page.click('[data-action=finish]'); await wait(); await inspect('Finish with planned vs actual');
  await page.click('#sheet [data-action=save-workout]:not([data-include])'); await wait(600);
  await tab('history'); await page.click('[data-action=open-workout] >> nth=0'); await wait(); await inspect('History planned workout'); await shut();
  // Running plan alongside the strength program
  await tab('plans'); await page.click('[data-action=run-setup][data-id="10k"]'); await wait(); await inspect('Running setup');
  await page.evaluate(() => { const d = (new Date().getDay() + 6) % 7; Object.assign(ui.runSetup, { days: [d, (d + 2) % 7, (d + 4) % 7], longDay: String((d + 4) % 7), recentDist: '5000', recentTime: '24:30', weekly: '20', runs: '3', longest: '9', experience: 'some', target: '50:00', maxHr: '190' }); openRunSetup('10k', true); }); await wait();
  await inspect('Running setup filled');
  await page.click('[data-action=rs-review]'); await wait(); await inspect('Running review');
  await page.click('[data-action=rs-start]'); await wait(); await inspect('Plans with a running plan');
  await page.click('.plan-card >> nth=1 >> .plan-sess >> nth=0'); await wait(); await inspect('Run session');
  await page.click('#sheet [data-action=plan-open]'); await wait(); await inspect('Running schedule'); await shut();
  await tab('home'); await inspect('Today with a run');
  await page.evaluate(() => { const x = todaysPlannedSessions().find((y) => y.session.targets?.run); if (x) openReview('planned', `${x.plan.id}|${x.session.key}`); }); await wait(); await inspect('Run review');
  if (await page.$('#sheet [data-action=begin]')) {
    await page.click('#sheet [data-action=begin]'); await wait(600); await inspect('Planned run');
    await page.fill('[data-field=distance][data-entry="0"][data-set="0"]', '6'); await page.fill('[data-field=duration][data-entry="0"][data-set="0"]', '36:00');
    await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
    if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
    await page.click('[data-action=finish]'); await wait(); await inspect('Finish run with planned vs actual');
    await page.click('#sheet [data-action=save-workout]:not([data-include])'); await wait(600);
  }
  // Swimming and cycling plans (one sport plan at a time: stop the running plan first)
  await page.evaluate(() => { const p = runningPlans(state).find((x) => x.kind === 'run'); if (p) stopPlan(state, p.id); state.active = null; save(); render(); });
  await tab('plans'); await page.click('[data-action=swim-setup]'); await wait(); await inspect('Swim setup');
  await page.evaluate(() => { const d = (new Date().getDay() + 6) % 7; Object.assign(ui.sportSetup, { goal: 'event', target: '1500', eventDate: sKey(sAddDays(new Date(), 70)), cont: '800', pace: '2:00', sessions: '3', weekly: '5000', experience: 'some', days: [d, (d + 2) % 7, (d + 4) % 7] }); openSportSetup('swim', true); }); await wait();
  await inspect('Swim setup filled');
  await page.click('[data-action=ss-review]'); await wait(); await inspect('Swim review');
  await page.click('[data-action=ss-start]'); await wait(); await inspect('Plans with a swim plan');
  await page.click('.plan-card >> nth=1 >> .plan-sess >> nth=0'); await wait(); await inspect('Swim session');
  await page.click('#sheet [data-action=review][data-kind=planned]'); await wait();
  if (await page.$('#sheet [data-action=begin]')) {
    await inspect('Swim review before start');
    await page.click('#sheet [data-action=begin]'); await wait(600); await inspect('Planned swim');
    await page.fill('[data-field=distance][data-entry="0"][data-set="0"]', '1200'); await page.fill('[data-field=duration][data-entry="0"][data-set="0"]', '30:00');
    await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
    if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
    await page.click('[data-action=finish]'); await wait(); await inspect('Finish swim with planned vs actual');
    await page.click('#sheet [data-action=save-workout]:not([data-include])'); await wait(600);
  }
  await shut();
  await page.evaluate(() => { const p = runningPlans(state).find((x) => x.kind === 'swim'); if (p) stopPlan(state, p.id); state.active = null; save(); render(); });
  await tab('plans'); await page.click('[data-action=ride-setup]'); await wait(); await inspect('Cycling setup');
  await page.evaluate(() => { const d = (new Date().getDay() + 6) % 7; Object.assign(ui.sportSetup, { goal: 'event', target: '100', eventDate: sKey(sAddDays(new Date(), 70)), weekly: '3', rides: '3', longest: '1.5', speed: '25', ftp: '220', maxHr: '185', setting: 'both', experience: 'some', days: [d, (d + 2) % 7, (d + 4) % 7, (d + 5) % 7], longDay: String((d + 5) % 7) }); openSportSetup('bike', true); }); await wait();
  await inspect('Cycling setup filled');
  await page.click('[data-action=ss-review]'); await wait(); await inspect('Cycling review');
  await page.click('[data-action=ss-start]'); await wait(); await inspect('Plans with a cycling plan');
  await page.click('.plan-card >> nth=1 >> .plan-sess >> nth=0'); await wait(); await inspect('Ride session');
  await page.click('#sheet [data-action=plan-open]'); await wait(); await inspect('Cycling schedule'); await shut();
  await page.screenshot({ path: `${SP}/crawl-${width}-${scheme}.png` });
  console.log(`width ${width} ${scheme}: ${screens} screens checked`);
  console.log('problems:', problems.length ? '\n  ' + [...new Set(problems)].join('\n  ') : 'none');
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})();
