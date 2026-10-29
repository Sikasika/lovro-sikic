// Plan core (plans.js + backup): snapshots, derived session statuses, no automatic shifting,
// one strength + one sport plan, workout links, stop/delete, backup and restore rules.
// Usage: node plan-test.js <outDir> <light|dark>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const fs = require('fs');
const OUT = process.argv[2] || '.', scheme = process.argv[3] || 'light';
const DIR = `${OUT}/backup-files`;
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got).slice(0, 300)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const L = (s) => new Date(s).toISOString();
const S = (weight, reps) => ({ weight, reps: String(reps), done: true });
const W = (id, day, extra = {}) => ({ id, name: `Session ${id}`, notes: '', start: L(`${day}T18:00:00+01:00`), end: L(`${day}T19:00:00+01:00`),
  entries: [{ exerciseId: 'bench', sets: [S(60, 10), S(60, 9)] }], ...extra });
const exercises = [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'run', name: 'Running', category: 'Cardio' }];
// Existing user data from before plans existed (no plans field anywhere).
const oldData = { schemaVersion: 2, cardioExercisesAdded: true, active: null, templates: [], exercises,
  settings: { unit: 'kg', rest: 90, theme: 'system', plateauWeeks: 6, weightStepKg: 2.5, weightStepLb: 5 },
  bodyweights: [{ id: 'b1', date: '2026-11-09', kg: 81 }],
  workouts: [W('old1', '2026-10-30'), W('old2', '2026-10-27')] };

// Test-only definition: Mon/Wed/Fri for N weeks from a Monday. Defined in the page.
const DEF_V1 = `({ id: 'test-3x', version: 1, kind: 'strength', name: 'Test 3×/week',
  build: (a, start) => Array.from({ length: a.weeks || 3 }, (_, i) => ({ week: i + 1, ...(i === 2 ? { deload: true } : {}),
    sessions: [0, 2, 4].map((d, j) => ({ key: 'w' + (i + 1) + '-' + (j + 1), date: sKey(sAddDays(sFromKey(start), i * 7 + d)), type: 'strength', title: ['A', 'B', 'A'][j],
      targets: { exercises: [{ exerciseId: 'bench', sets: 3, reps: { min: 8, max: 12 } }] } })) })) })`;
const DEF_V2 = DEF_V1.replace("version: 1", "version: 2").replace("['A', 'B', 'A']", "['X', 'Y', 'Z']").replace('[0, 2, 4]', '[1, 3]');
const RUN_DEF = `({ id: 'test-run', version: 1, kind: 'run', name: 'Test run plan',
  build: (a, start) => [{ week: 1, sessions: [{ key: 'r1', date: start, type: 'easy', title: 'Easy run' }, { key: 'r2', date: sKey(sAddDays(sFromKey(start), 2)), type: 'long', title: 'Long run' }] }] })`;
const TRI_DEF = RUN_DEF.replace("'test-run'", "'test-tri'").replace("kind: 'run'", "kind: 'tri'").replace('Test run plan', 'Test tri');

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
  const page = await ctx.newPage();
  const F = require('./flow.js')(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.clock.setFixedTime(new Date('2026-11-11T12:00:00+01:00')); // Wednesday of week 2
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 250) => page.waitForTimeout(ms);
  const raw = () => page.evaluate((k) => localStorage.getItem(k), KEY);
  const st = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const load = async (data) => { await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, data]); await page.reload(); await wait(300); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const statuses = (planId, today) => ev(([id, t]) => sessionStatuses(findPlan(state, id), state, t || todayKey()).map((s) => `${s.key}:${s.status}${s.moved ? '@' + s.date : ''}`).join(' '), [planId, today]);
  const startTestPlan = (def = DEF_V1, answers = { weeks: 3 }, start = '2026-11-02', id = 'p1') => ev(([d, a, s, id]) => {
    const def = registerPlanDefinition(eval(d));
    const r = createPlan(def, a, s, { id });
    if (!r.ok) return r;
    const added = addPlan(state, r.plan);
    save();
    return added;
  }, [def, answers, start, id]);

  /* A. Existing data without plans */
  await load(oldData);
  const before = await raw();
  check('A old data loads: plans default to empty', await ev(() => JSON.stringify(state.plans)), '[]');
  check('A loading does not rewrite stored data', await raw() === before, true);
  check('A Today and History still render', `${await page.innerText('#title')}|${/recent training/i.test(await page.innerText('#view'))}`, 'Today|true');
  check('A no plan statuses without plans', await ev(() => JSON.stringify([runningPlans(state).length, planConflicts(state).length])), '[0,0]');

  /* B. Snapshot when a plan starts */
  const b1 = await startTestPlan();
  check('B plan added', `${b1.ok}|${(b1.warnings || []).length}`, 'true|0');
  let p = (await st()).plans[0];
  check('B stored as plain data with its source', `${p.kind}|${p.source.defId}|${p.source.defVersion}|${p.startDate}|${p.endDate}|${p.status}|${p.weeks.length}|${JSON.stringify(p.overrides)}`,
    'strength|test-3x|1|2026-11-02|2026-11-20|active|3|{}');
  check('B sessions in the snapshot', p.weeks.map((w) => w.sessions.map((s) => `${s.key}=${s.date}`).join(',')).join(' '),
    'w1-1=2026-11-02,w1-2=2026-11-04,w1-3=2026-11-06 w2-1=2026-11-09,w2-2=2026-11-11,w2-3=2026-11-13 w3-1=2026-11-16,w3-2=2026-11-18,w3-3=2026-11-20');
  check('B targets and deload week kept', `${JSON.stringify(p.weeks[0].sessions[0].targets)}|${p.weeks[2].deload}`, '{"exercises":[{"exerciseId":"bench","sets":3,"reps":{"min":8,"max":12}}]}|true');
  const snap = JSON.stringify(p.weeks);
  // The definition changes (an app update): the running plan must not change.
  await ev((d) => registerPlanDefinition(eval(d)), DEF_V2);
  check('B new definition version: plan unchanged, update only reported', `${JSON.stringify((await st()).plans[0].weeks) === snap}|${await ev(() => planUpdateAvailable(state.plans[0]))}`, 'true|true');
  check('B in-memory plan unchanged too', await ev((s) => JSON.stringify(state.plans[0].weeks) === s, snap), true);
  await page.reload(); await wait(300); // definitions are gone after a reload (as after an app update without them)
  check('B plan works without its definition', `${await ev(() => PLAN_LIBRARY.size)}|${JSON.stringify((await st()).plans[0].weeks) === snap}|${(await statuses('p1')).split(' ').length}`, '0|true|9');
  check('B setup answers copied, not shared', await ev((d) => { const a = { weeks: 2 }; const r = createPlan(eval(d), a, '2026-11-02'); a.weeks = 9; return `${r.plan.answers.weeks}|${r.plan.weeks.length}`; }, DEF_V1), '2|2');
  check('B invalid start date refused', await ev((d) => createPlan(eval(d), {}, '2026-13-40').ok, DEF_V1), false);
  check('B broken definition output refused', await ev(() => createPlan({ id: 'x', version: 1, kind: 'strength', name: 'X', build: () => [{ week: 1, sessions: [{ key: 'a', date: '2026-11-02', type: 'strength', title: 'A' }, { key: 'a', date: '2026-11-03', type: 'strength', title: 'B' }] }] }, {}, '2026-11-02').errors.join(' ')), (t) => t.includes('repeats the key'));

  /* C. Statuses come from the data */
  check('C by date: past missed, today, future upcoming', await statuses('p1'), 'w1-1:missed w1-2:missed w1-3:missed w2-1:missed w2-2:today w2-3:upcoming w3-1:upcoming w3-2:upcoming w3-3:upcoming');
  await ev(() => { state.workouts.unshift({ id: 'pw1', name: 'Plan A', notes: '', start: new Date('2026-11-02T18:00:00+01:00').toISOString(), end: new Date('2026-11-02T19:00:00+01:00').toISOString(), entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: '10', done: true }] }] }); save(); });
  let r = await ev(() => linkWorkout(state, 'pw1', 'p1', 'w1-1')); await ev(() => save());
  check('C linked workout → completed', `${r.ok}|${(await statuses('p1')).split(' ')[0]}|${JSON.stringify((await st()).workouts.find((w) => w.id === 'pw1').plan)}`, 'true|w1-1:completed|{"planId":"p1","sessionKey":"w1-1"}');
  check('C status names the workout', await ev(() => sessionStatus(state.plans[0], 'w1-1').workoutId), 'pw1');
  await ev(() => { state.workouts = state.workouts.filter((w) => w.id !== 'pw1'); save(); });
  check('C workout deleted → missed again (nothing stored to go stale)', (await statuses('p1')).split(' ')[0], 'w1-1:missed');
  r = await ev(() => skipSession(state, 'p1', 'w1-2'));
  check('C skip → skipped', `${r.ok}|${(await statuses('p1')).split(' ')[1]}`, 'true|w1-2:skipped');
  r = await ev(() => clearSessionStatus(state, 'p1', 'w1-2'));
  check('C clear skip → missed', `${r.ok}|${(await statuses('p1')).split(' ')[1]}|${await ev(() => 'w1-2' in state.plans[0].overrides)}`, 'true|w1-2:missed|false');
  r = await ev(() => markSessionDone(state, 'p1', 'w1-3'));
  check('C mark done without a workout → completed (manual)', `${r.ok}|${(await statuses('p1')).split(' ')[2]}|${await ev(() => sessionStatus(state.plans[0], 'w1-3').manual)}`, 'true|w1-3:completed|true');
  r = await ev(() => markSessionDone(state, 'p1', 'w3-1'));
  check('C can\'t mark a future session done', `${r.ok}|${r.error}`, "false|A session can't be marked done before its day.");
  check('C status is relative to the day asked', await statuses('p1', '2026-11-25'), 'w1-1:missed w1-2:missed w1-3:completed w2-1:missed w2-2:missed w2-3:missed w3-1:missed w3-2:missed w3-3:missed');
  check('C progress counts', await ev(() => JSON.stringify(planProgress(state.plans[0]))), JSON.stringify({ week: 2, weeks: 3, total: 9, completed: 1, skipped: 0, missed: 3, cancelled: 0, due: 5 }));

  /* D. No automatic shifting */
  const dates = async () => (await ev(() => sessionStatuses(state.plans[0]).map((s) => s.date).join(',')));
  const datesBefore = await dates();
  check('D missed sessions stay on their days', datesBefore, '2026-11-02,2026-11-04,2026-11-06,2026-11-09,2026-11-11,2026-11-13,2026-11-16,2026-11-18,2026-11-20');
  r = await ev(() => moveSession(state, 'p1', 'w2-1', '2026-11-12'));
  check('D move one missed session to tomorrow', `${r.ok}|${JSON.stringify(r.warnings)}|${(await statuses('p1')).split(' ')[3]}`, 'true|[]|w2-1:upcoming@2026-11-12');
  check('D no other session moved', (await dates()).split(',').filter((d, i) => i !== 3).join(','), datesBefore.split(',').filter((d, i) => i !== 3).join(','));
  check('D snapshot date kept; move stored as a change', await ev(() => `${state.plans[0].weeks[1].sessions[0].date}|${state.plans[0].overrides['w2-1'].date}`), '2026-11-09|2026-11-12');
  r = await ev(() => moveSession(state, 'p1', 'w2-3', '2026-11-16'));
  check('D move onto a busy day: allowed with a warning', `${r.ok}|${r.warnings.length}|${(r.warnings[0] || '').includes('“A”')}`, 'true|1|true');
  check('D the session already on that day stays', (await statuses('p1')).split(' ')[6], 'w3-1:upcoming');
  r = await ev(() => moveSession(state, 'p1', 'w2-3', '2026-11-13'));
  check('D moving back to its own day removes the change', `${r.ok}|${await ev(() => 'w2-3' in state.plans[0].overrides)}`, 'true|false');
  check('D can\'t move into the past', (await ev(() => moveSession(state, 'p1', 'w3-1', '2026-11-10'))).error, 'A session can only be moved to today or a later day.');
  check('D can\'t move outside the plan', (await ev(() => moveSession(state, 'p1', 'w3-1', '2026-11-21'))).error, "Choose a day within the plan's dates.");
  check('D can\'t move a completed session', (await ev(() => moveSession(state, 'p1', 'w1-3', '2026-11-14'))).error, 'This session is already done or in progress.');
  await ev(() => skipSession(state, 'p1', 'w3-2'));
  r = await ev(() => moveSession(state, 'p1', 'w3-2', '2026-11-19'));
  check('D moving a skipped session un-skips it', `${r.ok}|${(await statuses('p1')).split(' ')[7]}`, 'true|w3-2:upcoming@2026-11-19');
  check('D a day passing never moves anything', await ev(() => sessionStatuses(state.plans[0], state, '2026-11-30').map((s) => s.date).join(',')), '2026-11-02,2026-11-04,2026-11-06,2026-11-12,2026-11-11,2026-11-13,2026-11-16,2026-11-19,2026-11-20');
  await ev(() => save());

  /* E. Linking rules */
  await ev(() => { state.workouts.unshift({ id: 'e1', name: 'E1', notes: '', start: new Date('2026-11-11T08:00:00+01:00').toISOString(), end: new Date('2026-11-11T09:00:00+01:00').toISOString(), entries: [{ exerciseId: 'bench', sets: [{ weight: 62.5, reps: '10', done: true }] }] },
    { id: 'e2', name: 'E2', notes: '', start: new Date('2026-11-11T10:00:00+01:00').toISOString(), end: new Date('2026-11-11T11:00:00+01:00').toISOString(), entries: [{ exerciseId: 'bench', sets: [{ weight: 62.5, reps: '11', done: true }] }] }); });
  const trendBefore = await ev(() => { const w = state.workouts.find((x) => x.id === 'e1'); return JSON.stringify([progressionAdvice(progressionSets(w, 'bench')), strengthTrend(progressionSets(w, 'bench'), progressionSets(state.workouts.find((x) => x.id === 'old1'), 'bench'))]); });
  await ev(() => skipSession(state, 'p1', 'w2-2'));
  r = await ev(() => linkWorkout(state, 'e1', 'p1', 'w2-2'));
  check('E linking clears a skip; session completed', `${r.ok}|${(await statuses('p1')).split(' ')[4]}|${await ev(() => 'w2-2' in state.plans[0].overrides)}`, 'true|w2-2:completed|false');
  r = await ev(() => linkWorkout(state, 'e2', 'p1', 'w2-2'));
  check('E one workout per session', `${r.ok}|${r.error}|${r.linkedId}`, 'false|Another workout is already linked to this session.|e1');
  r = await ev(() => linkWorkout(state, 'e2', 'p1', 'w2-2', { replace: true }));
  check('E replace moves the link; the other workout is kept', `${r.ok}|${await ev(() => sessionStatus(state.plans[0], 'w2-2').workoutId)}|${await ev(() => JSON.stringify(state.workouts.find((w) => w.id === 'e1').plan))}|${await ev(() => state.workouts.some((w) => w.id === 'e1'))}`, 'true|e2|undefined|true');
  check('E can\'t skip a session with a workout', (await ev(() => skipSession(state, 'p1', 'w2-2'))).error, 'This session has a logged workout. Unlink the workout first.');
  check('E can\'t mark done over a workout', (await ev(() => markSessionDone(state, 'p1', 'w2-2'))).error, 'This session already has a logged workout.');
  r = await ev(() => unlinkWorkout(state, 'e2'));
  check('E unlink → today again', `${r.ok}|${(await statuses('p1')).split(' ')[4]}`, 'true|w2-2:today');
  await ev(() => linkWorkout(state, 'e1', 'p1', 'w2-2'));
  check('E linking leaves progression unchanged', await ev(() => { const w = state.workouts.find((x) => x.id === 'e1'); return JSON.stringify([progressionAdvice(progressionSets(w, 'bench')), strengthTrend(progressionSets(w, 'bench'), progressionSets(state.workouts.find((x) => x.id === 'old1'), 'bench'))]); }), trendBefore);
  check('E bad links refused', await ev(() => [linkWorkout(state, 'nope', 'p1', 'w2-2').error, linkWorkout(state, 'e2', 'nope', 'w2-2').error, linkWorkout(state, 'e2', 'p1', 'nope').error].join('|')), 'This workout no longer exists.|This plan no longer exists.|This session is not in the plan.');
  await ev(() => save());

  /* F. Logging keeps the link; repeating and templates don't copy it */
  await ev(() => { state.active = { id: 'act', name: 'Plan B', templateId: null, start: new Date().toISOString(), notes: '', plan: { planId: 'p1', sessionKey: 'w2-3' },
    entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: '10', done: true }, { weight: '', reps: '', done: false }] }] }; save(); render(); });
  check('F workout in progress → in-progress', (await statuses('p1')).split(' ')[5], 'w2-3:in-progress');
  check('F can\'t skip or move it while in progress', await ev(() => [skipSession(state, 'p1', 'w2-3').error, moveSession(state, 'p1', 'w2-3', '2026-11-14').error].join('|')), 'This session is in progress.|This session is already done or in progress.');
  await go(page, 'workout'); await wait();
  await F.finish();
  const saved = (await st()).workouts.find((w) => w.id === 'act');
  check('F finishing keeps the link on the saved workout', `${JSON.stringify(saved && saved.plan)}|${(await st()).active}`, '{"planId":"p1","sessionKey":"w2-3"}|null');
  check('F session completed by the logged workout', (await statuses('p1')).split(' ')[5], 'w2-3:completed');
  await go(page, 'history'); await wait();
  await page.click('[data-action=open-workout][data-id="act"]'); await wait();
  await page.click('[data-action=edit-workout]'); await wait();
  await page.fill('#wedit-name', 'Plan B edited').catch(() => {});
  await page.click('[data-action=save-wedit]'); await wait();
  check('F editing a past workout keeps its link', JSON.stringify((await st()).workouts.find((w) => w.id === 'act').plan), '{"planId":"p1","sessionKey":"w2-3"}');
  await page.click('#sheet [data-action=save-history-template]'); await wait();
  const tpl = (await st()).templates.slice(-1)[0];
  check('F save as template: no plan link', `${!!tpl}|${tpl && 'plan' in tpl}`, 'true|false');
  await page.click('#sheet [data-action=repeat]'); await wait();
  await F.begin();
  check('F repeat: new workout has no plan link', `${!!(await st()).active}|${'plan' in ((await st()).active || {})}`, 'true|false');
  await ev(() => { state.active = null; save(); render(); });

  /* G. One strength program + one sport plan */
  r = await startTestPlan(DEF_V1, { weeks: 1 }, '2026-11-16', 'p2');
  check('G second strength program refused', `${r.ok}|${r.error}`, 'false|“Test 3×/week” is already running. Stop it first: one strength program at a time.');
  r = await startTestPlan(RUN_DEF, {}, '2026-11-16', 'run1');
  check('G sport plan alongside: allowed, same-day conflict reported', `${r.ok}|${JSON.stringify(r.conflicts.map((c) => c.date))}`, 'true|["2026-11-16"]');
  check('G conflicts list both plans', await ev(() => JSON.stringify(planConflicts(state).map((c) => `${c.date}:${c.sessions.map((s) => s.title).join('+')}`))), JSON.stringify(['2026-11-16:A+Easy run']));
  r = await startTestPlan(TRI_DEF, {}, '2026-11-16', 'tri1');
  check('G second sport plan refused', `${r.ok}|${r.error}`, 'false|“Test run plan” is already running. Stop it first: one sport plan at a time.');
  check('G stopped plan frees its slot; triathlon warns about the strength program', await ev(() => { stopPlan(state, 'run1'); const c = canStartPlan(state, 'tri'); return `${c.ok}|${c.warnings.length}`; }), 'true|1');
  check('G finished plan frees its slot', await ev(() => canStartPlan(state, 'strength', '2026-11-21').ok), true);
  check('G planPhase', await ev(() => ['2026-11-01', '2026-11-11', '2026-11-21'].map((d) => planPhase(state.plans[0], d)).join(',')), 'upcoming,active,finished');

  /* H. Stop and delete */
  check('H stopped plan: future sessions cancelled, past kept', await ev(() => sessionStatuses(findPlan(state, 'run1')).map((s) => s.status).join(',')), 'cancelled,cancelled');
  await ev(() => { stopPlan(state, 'p1', '2026-11-13'); });
  check('H stop mid-plan (a session moved to the day before stopping stays missed)', (await statuses('p1', '2026-11-13')).split(' ').slice(2).join(' '), 'w1-3:completed w2-1:missed@2026-11-12 w2-2:completed w2-3:completed w3-1:cancelled w3-2:cancelled@2026-11-19 w3-3:cancelled');
  check('H earlier missed sessions stay missed', (await statuses('p1', '2026-11-13')).split(' ').slice(0, 2).join(' '), 'w1-1:missed w1-2:missed');
  await ev(() => { state.plans.find((x) => x.id === 'p1').status = 'active'; delete state.plans.find((x) => x.id === 'p1').stoppedOn; save(); });
  const wCount = (await st()).workouts.length;
  r = await ev(() => { const r = deletePlan(state, 'run1'); save(); return r; });
  check('H delete plan: gone, workouts untouched', `${r.ok}|${(await st()).plans.map((x) => x.id).join(',')}|${(await st()).workouts.length === wCount}`, 'true|p1|true');

  /* I. Backup and restore */
  await go(page, 'settings'); await wait();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
  const withPlans = `${DIR}/plans-backup.json`;
  await dl.saveAs(withPlans);
  const exp = JSON.parse(fs.readFileSync(withPlans, 'utf8'));
  const now = await st();
  check('I export: plans and links included, counted', `${exp.counts.plans}|${JSON.stringify(exp.data.plans) === JSON.stringify(now.plans)}|${exp.data.workouts.filter((w) => w.plan).length}`, '1|true|2');
  check('I export: same format number', exp.format, 1);
  const deviceState = now;
  const restore = async (file) => {
    await ev(() => closeSheet()); await wait(100);
    await go(page, 'settings'); await wait();
    await page.setInputFiles('#import-file', file); await wait(400);
    const text = (await page.innerText('#sheet')).replace(/\s+/g, ' ');
    if (await page.$('#sheet [data-action=restore-toggle-copy][aria-checked=true]')) await page.click('#sheet [data-action=restore-toggle-copy]');
    if (await page.$('#sheet [data-action=restore-confirm]')) { await page.click('#sheet [data-action=restore-confirm]'); await wait(500); }
    return text;
  };
  const write = (name, obj) => { const f = `${DIR}/${name}`; fs.writeFileSync(f, JSON.stringify(obj)); return f; };

  // I1: a backup with plans restores them normally (replacing this device's plans)
  await ev(() => { state.plans[0].name = 'Changed here'; save(); });
  let t = await restore(withPlans);
  check('I1 confirm lists the plans', t.includes('1 plan') && !t.includes('Your plans are kept'), true);
  check('I1 plans and links restored exactly', `${JSON.stringify((await st()).plans) === JSON.stringify(exp.data.plans)}|${(await st()).workouts.filter((w) => w.plan).length}`, 'true|2');

  // I2: an older backup without plans keeps this device's plans; links follow the restored workouts
  const older = { app: 'training-tracker', kind: 'backup', format: 1, schemaVersion: 2, exportedAt: L('2026-11-10T10:00:00Z'),
    data: { exercises, workouts: [W('x1', '2026-11-03'), { ...W('e1', '2026-11-11') }], templates: [], active: null, settings: oldData.settings, cardioExercisesAdded: true } };
  t = await restore(write('older.json', older));
  check('I2 confirm says plans are kept', t.includes('Your plans are kept') && t.includes('Sessions count as done only if their workout is in the restored data'), true);
  let after = await st();
  check('I2 plans kept', `${after.plans.length}|${after.plans[0].id}|${JSON.stringify(after.plans[0].overrides) === JSON.stringify(exp.data.plans[0].overrides)}`, '1|p1|true');
  check('I2 sessions whose workouts are gone are no longer completed', await statuses('p1'), 'w1-1:missed w1-2:missed w1-3:completed w2-1:upcoming@2026-11-12 w2-2:today w2-3:upcoming w3-1:upcoming w3-2:upcoming@2026-11-19 w3-3:upcoming');
  check('I2 workouts from the backup, no stray links', `${after.workouts.map((w) => w.id).join(',')}|${after.workouts.filter((w) => w.plan).length}`, 'x1,e1|0');

  // I3: undo goes back exactly (the copy has plans)
  await go(page, 'settings'); await wait();
  await page.click('[data-action=undo-restore]'); await wait(300);
  await page.click('#sheet [data-action=restore-confirm]'); await wait(500);
  after = await st();
  check('I3 undo restore: plans and links exactly as before', `${JSON.stringify(after.plans) === JSON.stringify(exp.data.plans)}|${after.workouts.filter((w) => w.plan).length}`, 'true|2');

  // I4: links that point nowhere, duplicates and malformed links are cleaned up
  const messy = JSON.parse(JSON.stringify(exp));
  messy.data.workouts.push({ ...W('dup', '2026-11-11'), plan: { planId: 'p1', sessionKey: 'w2-2' } });
  messy.data.workouts.push({ ...W('gone', '2026-11-05'), plan: { planId: 'nope', sessionKey: 'w1-1' } });
  messy.data.workouts.push({ ...W('bad', '2026-11-06'), plan: 'p1' });
  messy.data.plans[0].overrides.zzz = { status: 'skipped' };
  messy.counts.workouts = messy.data.workouts.length;
  t = await restore(write('messy.json', messy));
  check('I4 warns about the unreadable link', t.includes('1 workout has an unreadable link to a plan'), true);
  after = await st();
  check('I4 restored; earliest workout keeps a doubled session, bad links removed, workouts kept',
    `${after.workouts.length}|${JSON.stringify(after.workouts.find((w) => w.id === 'dup').plan)}|${'plan' in after.workouts.find((w) => w.id === 'gone')}|${'plan' in after.workouts.find((w) => w.id === 'bad')}|${'zzz' in after.plans[0].overrides}`,
    `${messy.data.workouts.length}|undefined|false|false|false`);
  check('I4 doubled session still counts once', await ev(() => sessionStatus(state.plans[0], 'w2-2').workoutId), 'e1');

  // I5: a damaged plan rejects the whole file; nothing changes
  const keep = await raw();
  const broken = JSON.parse(JSON.stringify(exp));
  broken.data.plans[0].weeks[0].sessions[0].date = 'soon';
  t = await restore(write('broken.json', broken));
  check('I5 damaged plan: file refused, data unchanged', `${t.includes("Can't restore this file")}|${t.includes('has no valid date')}|${await raw() === keep}`, 'true|true|true');
  const short = JSON.parse(JSON.stringify(exp)); short.data.plans = [];
  t = await restore(write('short.json', short));
  check('I5 plan count mismatch: refused as incomplete', `${t.includes('looks incomplete')}|${await raw() === keep}`, 'true|true');
  check('I5 pure checks', await ev((b) => { const r = validateBackup(b); return `${r.ok}|${r.plans.count}|${r.plans.field}`; }, exp), 'true|1|true');

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
