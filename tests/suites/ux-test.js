// UX pass: Settings gear icon, contextual Today button, per-filter Stats views.
// Usage: node ux-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.clock.setFixedTime(new Date('2026-11-25T09:00:00+01:00')); // Wednesday
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 200) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const view = async () => (await page.innerText('#view')).replace(/\s+/g, ' ');
  const sheet = async () => (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  const sheetOpen = () => ev(() => !document.querySelector('#sheet').classList.contains('hidden'));
  const heroBtns = () => page.$$eval('#view .hero-btn', (b) => b.map((x) => x.textContent.trim()));
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#view *, #sheet *')].every((el) => el.offsetParent === null || el.closest('svg') || el.closest('#heat-scroll') || el.getBoundingClientRect().right <= window.innerWidth + 1));
  const reset = () => ev(() => { localStorage.clear(); state = defaultState(); ui.stats.filter = 'all'; ui.stats.period = '30d'; ui.stats.perfEx = null; save(); closeSheet(); ui.tab = 'home'; render(); });
  await ev(() => {
    window.U = {
      id: (n) => state.exercises.find((e) => e.name === n).id,
      w(d, entries, min = 60) { state.workouts.push({ id: `w${Math.random()}`, name: 'W', notes: '', start: `${d}T07:00:00`, end: new Date(Date.parse(`${d}T07:00:00`) + min * 60000).toISOString(),
        entries: entries.map(([n, sets]) => ({ exerciseId: state.exercises.find((e) => e.name === n)?.id || n, sets })) }); save(); },
      lift: (k, w = 60, r = 8) => Array.from({ length: k }, () => ({ weight: w, reps: r, done: true })),
      run: (m, s) => [{ distance: m, duration: s, done: true }],
      program(start = '2026-11-23') { const p = createPlan(PLAN_LIBRARY.get('full-body-3'), { days: [0, 2, 4], weeks: 4, deload: 4 }, start).plan; resolveProgramExercises(p, state); state.plans.push(p); save(); return p.id; }
    };
  });

  /* A. Settings icon */
  await reset();
  const gear = await ev(() => { const b = document.querySelector('.gear-btn'); return { label: b.getAttribute('aria-label'), action: b.dataset.action, paths: b.querySelectorAll('svg path').length, circles: b.querySelectorAll('svg circle').length, rays: (b.innerHTML.match(/M12 2\.5v3/g) || []).length }; });
  check('A Settings button: same button and label, now a gear (toothed outline + centre ring)', `${gear.label}|${gear.action}|${gear.paths}|${gear.circles}|${gear.rays}`, 'Settings|open-settings|1|1|0');
  await page.click('.gear-btn'); await wait();
  check('A it still opens Settings, where the light/dark controls are', `${await ev(() => ui.tab)}|${!!(await page.$('[data-action=theme][data-v=dark]'))}`, 'settings|true');

  /* B. Today button */
  await reset();
  check('B no plan, nothing done: "Start Workout"', JSON.stringify(await heroBtns()), '["Start Workout"]');
  await ev(() => { U.w('2026-11-25', [['Bench Press', U.lift(3)]]); render(); }); await wait();
  check('B trained already today: still "Start Workout" (no "Start Another Workout")', `${(await view()).includes('Nice work today')}|${JSON.stringify(await heroBtns())}|${(await view()).includes('Another')}`, 'true|["Start Workout"]|false');
  await ev(() => { state.active = { id: 'a1', name: 'Push', notes: '', start: new Date().toISOString(), entries: [] }; save(); ui.tab = 'home'; render(); }); await wait();
  check('B active workout: only Continue Workout, no start button', JSON.stringify(await heroBtns()), '["Continue Workout"]');
  await reset();
  const P = await ev(() => U.program());
  await ev(() => render()); await wait();
  check('B one strength session today: "Start Today\'s Workout" with the session shown', `${JSON.stringify(await heroBtns())}|${(await view()).includes('Today: Full Body')}`, '["Start Today\'s Workout"]|true');
  await page.click('#view .hero-btn'); await wait();
  check('B it opens the planned-session review first: nothing started, no timer', `${await sheetOpen()}|${!!(await page.$('#sheet [data-action=begin]'))}|${await ev(() => state.active)}|${await ev(() => ui.tab)}`, 'true|true|null|home');
  check('B review fits the screen', await noOverflow(), true);
  await page.click('#sheet [data-action=begin]'); await wait(300);
  const act = await ev(() => state.active && { plan: state.active.plan, kind: state.active.planned?.kind || 'strength', n: state.active.entries.length });
  check('B Begin starts the planned workout (linked to today\'s session)', `${!!act}|${act && act.plan.planId === (await ev((id) => id, P))}|${act && act.plan.sessionKey === await ev((id) => todaysPlannedSessions()[0]?.session.key || sessionStatuses(findPlan(state, id)).find((s) => s.date === todayKey()).key, P)}|${act && act.n > 0}`, 'true|true|true|true');
  await ev(() => { state.active = null; save(); ui.tab = 'home'; render(); });
  // Two strength sessions today (one moved here)
  await ev((id) => { const p = findPlan(state, id); const next = sessionStatuses(p).find((s) => s.date > todayKey()); moveSession(state, id, next.key, todayKey()); save(); render(); }, P);
  await wait();
  check('B two strength sessions today: one "Start Today\'s Workout" button', JSON.stringify(await heroBtns()), '["Start Today\'s Workout"]');
  await page.click('#view .hero-btn'); await wait();
  let t = await sheet();
  check('B it asks which one: both listed, nothing started', `${t.includes("Today's workouts")}|${await page.$$eval('#sheet [data-action=review][data-kind=planned]', (x) => x.length)}|${t.includes('moved from')}|${await ev(() => state.active)}`, 'true|2|true|null');
  check('B chooser fits the screen', await noOverflow(), true);
  await page.click('#sheet [data-action=review][data-kind=planned] >> nth=1'); await wait();
  check('B choosing one opens its review (Begin), still nothing started', `${!!(await page.$('#sheet [data-action=begin]'))}|${await ev(() => state.active)}`, 'true|null');
  await ev(() => closeSheet());
  // Sport plan session only (no strength session today): its own card stays as before
  await reset();
  await ev(() => { const a = { goal: 'fitness', weeks: 8, weeklyMin: 120, ridesPerWeek: 3, longestMin: 60, days: [0, 2, 4], experience: 'some' }; const p = (() => { const r = createPlan(PLAN_LIBRARY.get('bike'), a, '2026-11-25', { name: 'Ride plan' }); if (!r.ok) throw new Error(r.errors.join(' ')); return r.plan; })(); resolveProgramExercises(p, state); state.plans.push(p); save(); render(); });
  await wait();
  check('B only a cycling session today: no "Today\'s Workout" (that is for strength); its existing card is unchanged', JSON.stringify(await heroBtns()), (v) => !v.includes("Today's Workout") && /Start /.test(v));

  /* C. Stats filters */
  const filterView = async (f) => { await page.click(`[data-saction=filter][data-v="${f}"]`); await wait(); return view(); };
  const has = (v, list) => list.filter((x) => v.toLowerCase().includes(x.toLowerCase()));
  const ALL_ONLY = ['Day streak', 'Week streak', 'This month', 'By activity type'];
  // Empty
  await reset(); await go(page, 'progress'); await page.click('.subnav [data-tab=statistics]'); await wait();
  for (const f of ['all', 'weights', 'cardio', 'sports', 'other']) {
    const v = await filterView(f);
    check(`C empty data, ${f}: only "No completed workouts yet"`, `${v.includes('No completed workouts yet')}|${has(v, ['Summary', 'Training frequency', 'Performance', 'Breakdown']).length}`, (x) => x.startsWith('true|') && (f === 'all' || x.endsWith('|0')));
  }
  // Strength only
  await reset();
  await ev(() => { U.w('2026-11-23', [['Bench Press', [{ weight: 40, reps: 10, type: 'warmup', done: true }, ...U.lift(3, 80, 5)]], ['Barbell Row', U.lift(3, 60, 8)]]); U.w('2026-11-20', [['Squat', U.lift(4, 100, 5)]]); ui.tab = 'statistics'; render(); });
  await wait();
  let v = await filterView('weights');
  check('C strength only, Weights: strength summary with its own cards', has(v, ['Strength summary', 'Workouts with weights', 'Avg / week', 'This week', 'Sets', 'Volume (kg)', 'Exercises', 'Training frequency', 'Performance', 'Personal records', 'By day of the week', 'Sets by category', 'Progress → Muscles']).length, 13);
  check('C Weights: sets exclude warm-ups (10), volume = weight × reps (4,640 kg), exercises (3)', `${/(\d+) Sets/.exec(v)?.[1]}|${/([\d,.]+) Volume \(kg\)/.exec(v)?.[1]}|${/(\d+) Exercises/.exec(v)?.[1]}`, '10|4,640|3');
  check('C Weights: per-exercise rows', v.includes('Squat 1 session · 4 sets · 2,000 kg volume') && v.includes('Bench Press 1 session · 3 sets · 1,200 kg volume'), true);
  check('C Weights: no overall-only or cardio cards', has(v, [...ALL_ONLY, 'Cardio summary', 'Workouts with cardio', 'Body weight']).join(','), '');
  check('C Weights layout fits', await noOverflow(), true);
  v = await filterView('cardio');
  check('C strength only, Cardio: short empty state, no unrelated statistics', `${v.includes('No cardio logged yet')}|${has(v, ['Summary', 'Training frequency', 'Performance', 'Breakdown', 'Volume']).length}`, 'true|0');
  v = await filterView('all');
  check('C All: the full overview as before', has(v, ['Summary', 'Day streak', 'Week streak', 'Training frequency', 'Performance', 'By activity type', 'Sets by category']).length, 7);
  // Cardio only
  await reset();
  await ev(() => { U.w('2026-11-24', [['Running', U.run(5000, 1500)]], 30); U.w('2026-11-21', [['Cycling', U.run(20000, 3600)]], 60); ui.tab = 'statistics'; render(); });
  await wait();
  v = await filterView('cardio');
  check('C cardio only, Cardio: cardio summary, per activity, frequency, performance, day of week', has(v, ['Cardio summary', 'Workouts with cardio', 'Cardio time logged', 'Running 1 session · 5.00 km · 25:00 · avg 5:00 /km', 'Training frequency', 'Performance', 'By day of the week']).length, 7);
  check('C Cardio: no strength, overall-only or category cards', has(v, [...ALL_ONLY, 'Volume (', 'Strength summary', 'Sets by category']).join(','), '');
  check('C Cardio: performance lists cardio exercises only', JSON.stringify(await page.$$eval('#stats-perf-ex option', (o) => o.map((x) => x.textContent).sort())), JSON.stringify(['Cycling', 'Running']));
  check('C Cardio layout fits', await noOverflow(), true);
  v = await filterView('weights');
  check('C cardio only, Weights: short empty state', `${v.includes('No weights logged yet')}|${has(v, ['Summary', 'Training frequency', 'Performance']).length}`, 'true|0');
  // Mixed (+ sports)
  await reset();
  await ev(() => { state.exercises.push({ id: 'ten', name: 'Tennis', category: 'Sports' });
    U.w('2026-11-24', [['Running', U.run(5000, 1500)], ['Bench Press', U.lift(3, 80, 5)]], 60); U.w('2026-11-22', [['ten', [{ weight: '', reps: '', duration: 3600, done: true }]]], 60); U.w('2026-11-20', [['Squat', U.lift(2, 100, 5)]]); ui.tab = 'statistics'; render(); });
  await wait();
  v = await filterView('weights');
  check('C mixed, Weights: only weights exercises count (sets 5, volume 2,200 kg; running not counted)', `${/(\d+) Workouts with weights/.exec(v)?.[1]}|${/(\d+) Sets/.exec(v)?.[1]}|${/([\d,.]+) Volume \(kg\)/.exec(v)?.[1]}|${v.includes('Running')}`, '2|5|2,200|false');
  v = await filterView('cardio');
  check('C mixed, Cardio: the mixed workout counts as one with cardio', /(\d+) Workouts with cardio/.exec(v)?.[1], 1);
  v = await filterView('sports');
  check('C mixed, Sports: sports summary with its exercise; no volume or category cards', `${has(v, ['Sports summary', 'Workouts with sports', 'Tennis 1 session · 1 set', 'Training frequency', 'Performance', 'By day of the week']).length}|${has(v, ['Volume (', 'Sets by category', ...ALL_ONLY]).join(',')}`, '6|');
  v = await filterView('other');
  check('C mixed, Other: short empty state', v.includes('No other logged yet'), true);
  check('C filter controls unchanged', JSON.stringify(await page.$$eval('[data-saction=filter]', (b) => b.map((x) => x.textContent.trim()))), JSON.stringify(['All', 'Weights', 'Cardio', 'Sports', 'Other']));
  await page.click('[data-saction=filter][data-v=weights]'); await wait();
  await page.click('[data-saction=period][data-v="7d"]'); await wait();
  check('C period switch works in a filtered view (7D: 2 workouts with weights)', /(\d+) Workouts with weights/.exec(await view())?.[1], 2);
  await page.click('.stats-inline-link'); await wait();
  check('C the Muscles link opens Progress → Muscles', await ev(() => ui.tab), 'muscles');
  const before = await ev(() => localStorage.getItem('training-tracker.v1'));
  await ev(() => { ui.tab = 'statistics'; render(); });
  for (const f of ['all', 'weights', 'cardio', 'sports', 'other']) await filterView(f);
  check('C viewing statistics never changes saved data', await ev(() => localStorage.getItem('training-tracker.v1')) === before, true);

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
