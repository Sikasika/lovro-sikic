// Built-in strength programs: schedules, setup → review → start, snapshot, planned sessions in
// the logger, exercise swaps, planned vs actual, rep-range recommendations, statuses and
// conflicts on the Plans tab, backup/restore, stopping. Usage: node program-test.js <outDir> <light|dark>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.argv[2] || '.'), scheme = process.argv[3] || 'light';
const DIR = `${OUT}/backup-files/program-${scheme}`;
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got).slice(0, 400)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const RUN_DEF = `({ id: 'test-run', version: 1, kind: 'run', name: 'Test run plan',
  build: (a, start) => [{ week: 1, sessions: [{ key: 'r1', date: '2026-11-11', type: 'easy', title: 'Easy run' }, { key: 'r2', date: '2026-11-12', type: 'easy', title: 'Easy run 2' }, { key: 'r3', date: '2026-11-15', type: 'long', title: 'Long run' }] }] })`;

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const setDay = (iso) => page.clock.setFixedTime(new Date(iso));
  await setDay('2026-11-09T09:00:00+01:00'); // Monday
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 250) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const st = () => ev((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const view = () => page.innerText('#view');
  const sheet = async () => (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#view *, #sheet *')].every((el) => el.offsetParent === null || el.closest('svg') || el.getBoundingClientRect().right <= window.innerWidth + 1));
  const closeSheet = async () => { await ev(() => closeSheet()); await wait(100); };

  // An earlier workout (for "previous" values and recommendations) and a template.
  await ev(() => {
    const id = (n) => state.exercises.find((e) => e.name === n).id;
    state.workouts.push({ id: 'prev1', name: 'Earlier', notes: '', start: new Date('2026-11-05T18:00:00+01:00').toISOString(), end: new Date('2026-11-05T19:00:00+01:00').toISOString(),
      entries: [{ exerciseId: id('Squat'), sets: [{ weight: 80, reps: '10', done: true }, { weight: 80, reps: '10', done: true }] },
        { exerciseId: id('Bench Press'), sets: [{ weight: 60, reps: '10', done: true }, { weight: 60, reps: '10', done: true }] }] });
    state.templates.push({ id: 'tplA', name: 'My Push', entries: [{ exerciseId: id('Bench Press'), sets: [{ weight: 60, reps: 10 }] }] });
    state.exercises = state.exercises.filter((e) => e.name !== 'Lunge'); // will be added back by the program
    save(); render();
  });

  /* A. Schedules (pure rules) */
  const sched = (id, a, start) => ev(([id, a, start]) => buildProgramWeeks(findProgram(id), a, start).map((w) => `${w.week}${w.deload ? 'L' : ''}:${w.sessions.map((s) => `${s.date.slice(5)}=${s.targets.workout}/${s.targets.exercises.map((x) => x.sets).join('')}`).join(',')}`).join(' '), [id, a, start]);
  check('A Full Body: Mon/Wed/Fri, A/B rotation, lighter week 4', await sched('full-body-3', { days: [0, 2, 4], weeks: 4, deload: 4 }, '2026-11-09'),
    '1:11-09=A/33322,11-11=B/33332,11-13=A/33322 2:11-16=B/33332,11-18=A/33322,11-20=B/33332 3:11-23=A/33322,11-25=B/33332,11-27=A/33322 4L:11-30=B/22222,12-02=A/22222,12-04=B/22222');
  check('A start mid-week: week = 7 days from the start date', (await sched('full-body-3', { days: [0, 2, 4], weeks: 4, deload: 0 }, '2026-11-11')).split(' ').slice(0, 2).join(' '),
    '1:11-11=A/33322,11-13=B/33332,11-16=A/33322 2:11-18=B/33332,11-20=A/33322,11-23=B/33332');
  check('A Upper/Lower: 4 days, UA/LA/UB/LB', (await sched('upper-lower-4', { days: [0, 1, 3, 4], weeks: 4, deload: 0 }, '2026-11-09')).split(' ')[0], '1:11-09=UA/443322,11-10=LA/43333,11-12=UB/443322,11-13=LB/33333');
  check('A lighter weeks: every 6th / none', `${(await sched('upper-lower-4', { days: [0, 1, 3, 4], weeks: 12, deload: 6 }, '2026-11-09')).split(' ').filter((w) => /^\d+L/.test(w)).map((w) => w.split(':')[0]).join(',')}|${/L:/.test(await sched('full-body-3', { days: [0, 2, 4], weeks: 12, deload: 0 }, '2026-11-09'))}`, '6L,12L|false');
  // Invariants over many combinations
  const inv = await ev(() => {
    const bad = [];
    let n = 0;
    const starts = ['2026-11-09', '2026-11-12', '2026-11-15', '2026-12-28', '2027-02-26'];
    for (const p of STRENGTH_PROGRAMS) for (const weeks of p.weekOptions) for (const deload of [0, 4, 6]) for (const start of starts) {
      for (let mask = 0; mask < 128; mask++) {
        const days = [...Array(7).keys()].filter((d) => mask & (1 << d));
        if (days.length !== p.daysPerWeek) continue;
        n++;
        const r = createPlan(PLAN_LIBRARY.get(p.id), { days, weeks, deload }, start);
        if (!r.ok) { bad.push(`${p.id} ${days} ${start}: ${r.errors}`); continue; }
        const ss = planSessions(r.plan);
        const keys = new Set(ss.map((s) => s.key));
        const startD = sFromKey(start);
        if (ss.length !== weeks * p.daysPerWeek || keys.size !== ss.length) bad.push(`${p.id} count`);
        r.plan.weeks.forEach((w, i) => {
          const lo = sKey(sAddDays(startD, i * 7)), hi = sKey(sAddDays(startD, i * 7 + 6));
          if (w.sessions.some((s) => s.date < lo || s.date > hi)) bad.push(`${p.id} week window`);
          if (w.sessions.some((s, j) => j && s.date <= w.sessions[j - 1].date)) bad.push(`${p.id} order`);
          if (!!w.deload !== (deload > 0 && (i + 1) % deload === 0)) bad.push(`${p.id} deload week ${i + 1}`);
          for (const s of w.sessions) {
            if (!days.includes((sFromKey(s.date).getDay() + 6) % 7)) bad.push(`${p.id} rest day used ${s.date}`);
            for (const x of s.targets.exercises) {
              const base = p.workouts[s.targets.workout].exercises.find((e) => e.name === x.name);
              if (x.min !== base.min || x.max !== base.max || x.sets !== (w.deload ? Math.max(1, Math.ceil(base.sets * 2 / 3)) : base.sets)) bad.push(`${p.id} targets`);
            }
          }
        });
        const order = ss.map((s) => s.targets.workout);
        if (order.some((wid, i) => wid !== p.rotation[i % p.rotation.length])) bad.push(`${p.id} rotation`);
        if (r.plan.endDate !== ss[ss.length - 1].date) bad.push('end date');
      }
    }
    return `${n}|${[...new Set(bad)].slice(0, 5).join(';')}`;
  });
  check('A every combination (programs × lengths × lighter weeks × starts × day sets): rules hold', inv, (v) => /^\d{3,}\|$/.test(v));
  check('A setup problems', await ev(() => { const p = findProgram('full-body-3'); return [programSetupProblems(p, { days: [0, 2], weeks: 8, deload: 4 }, '2026-11-09'), programSetupProblems(p, { days: [0, 2, 4], weeks: 7, deload: 4 }, '2026-11-09'), programSetupProblems(p, { days: [0, 2, 4], weeks: 8, deload: 4 }, '2026-11-08')].map((x) => x.join(' ')).join(' | '); }),
    "Choose exactly 3 training days (2 chosen). | Choose the program length. | The start date can't be in the past.");
  check('A day warnings', await ev(() => [programDayWarnings(findProgram('full-body-3'), [0, 1, 3]).length, programDayWarnings(findProgram('full-body-3'), [6, 0, 3]).length, programDayWarnings(findProgram('full-body-3'), [0, 2, 4]).length, programDayWarnings(findProgram('upper-lower-4'), [0, 1, 2, 3]).length, programDayWarnings(findProgram('upper-lower-4'), [0, 1, 3, 4]).length].join(',')), '1,1,0,1,0');

  /* B. Setup → review → start (Plans tab) */
  await go(page, 'plans'); await wait();
  check('B library lists both programs', `${(await view()).includes('Full Body 3×/week')}|${(await view()).includes('Upper/Lower 4×/week')}|${await noOverflow()}`, 'true|true|true');
  await page.click('[data-action=plan-setup][data-id=full-body-3]'); await wait();
  check('B setup defaults: today, Mon/Wed/Fri, 8 weeks, every 4th week', `${await page.inputValue('#ps-start')}|${await page.$$eval('.day-picker button.on', (b) => b.map((x) => x.textContent).join(','))}|${await page.inputValue('#ps-weeks')}|${await page.innerText('[data-action=ps-deload].on')}`, '2026-11-09|Mon,Wed,Fri|8|Every 4th week');
  await page.click('[data-action=ps-day][data-d="4"]'); await wait();
  check('B two days: review disabled', `${await page.isDisabled('[data-action=ps-review]')}|${(await sheet()).includes('2 of 3 chosen')}`, 'true|true');
  await page.click('[data-action=ps-day][data-d="1"]'); await wait();
  check('B back-to-back days: advice shown', (await sheet()).includes('back-to-back days'), true);
  await page.click('[data-action=ps-day][data-d="1"]'); await page.click('[data-action=ps-day][data-d="4"]'); await wait();
  await page.selectOption('#ps-weeks', '6'); await wait();
  await page.click('[data-action=ps-deload][data-v="0"]'); await wait();
  check('B setup fits the screen', await noOverflow(), true);
  await page.click('[data-action=ps-review]'); await wait();
  let t = await sheet();
  check('B review: dates, length, sessions, days', t.includes('Mon, 9 Nov – Fri, 18 Dec') && t.includes('6 weeks · 18 sessions · Mon, Wed, Fri'), true);
  check('B review: missing exercise will be added', t.includes('Added to your exercise library when you start: Lunge'), true);
  check('B review lists every week; no lighter week chosen', `${(t.match(/week \d+/gi) || []).length}|${t.includes('Lighter week')}|${await noOverflow()}`, '6|false|true');
  await page.click('[data-action=ps-back]'); await wait();
  check('B back keeps the choices', `${await page.inputValue('#ps-weeks')}|${await page.innerText('[data-action=ps-deload].on')}`, '6|None');
  await page.click('[data-action=ps-review]'); await wait();
  await page.click('[data-action=ps-start]'); await wait();
  let s = await st();
  const plan = s.plans[0];
  const PID = plan.id;
  check('B plan saved', `${s.plans.length}|${plan.kind}|${plan.source.defId}|${plan.source.defVersion}|${plan.startDate}|${plan.endDate}|${plan.weeks.length}|${JSON.stringify(plan.answers)}`, '1|strength|full-body-3|1|2026-11-09|2026-12-18|6|{"days":[0,2,4],"weeks":6,"deload":0}');
  check('B every planned exercise points at the library; Lunge added once', `${plan.weeks.every((w) => w.sessions.every((x) => x.targets.exercises.every((e) => s.exercises.some((ex) => ex.id === e.exerciseId))))}|${s.exercises.filter((e) => e.name === 'Lunge').length}`, 'true|1');
  check('B Plans tab: program card, week 1, today first', `${(await view()).includes('Week 1 of 6')}|${await page.$$eval('.plan-card .plan-sess', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')).join(' / '))}`, (v) => v.replace(/STRENGTH /gi, '').startsWith('true|Full Body A Mon, 9 Nov Today / Full Body B Wed, 11 Nov Upcoming / Full Body A Fri, 13 Nov Upcoming') && (v.match(/STRENGTH /gi) || []).length === 3);
  check('B one strength program at a time: library disabled', `${await page.isDisabled('[data-action=plan-setup][data-id=upper-lower-4]')}|${(await view()).includes('One strength program at a time')}`, 'true|true');
  check('B second program refused by the rules too', await ev(() => startProgram(findProgram('upper-lower-4'), { days: [0, 1, 3, 4], weeks: 8, deload: 4 }, '2026-11-09').error), (v) => v.includes('already running'));
  check('B Plans fits the screen', await noOverflow(), true);
  // Snapshot: the library changes (an app update) — the running plan doesn't
  const snap = JSON.stringify(plan.weeks);
  await ev(() => { const p = findProgram('full-body-3'); p.workouts.A.exercises[0].sets = 9; p.version = 2; registerPlanDefinition({ ...p, build: (a, s) => buildProgramWeeks(p, a, s) }); });
  check('B library change: plan unchanged, update only noted', `${JSON.stringify((await st()).plans[0].weeks) === snap}|${await ev(() => planUpdateAvailable(state.plans[0]))}`, 'true|true');
  await page.reload(); await wait(300);
  check('B after reload (programs back to built-in): plan still the snapshot', `${JSON.stringify((await st()).plans[0].weeks) === snap}|${await ev(() => planUpdateAvailable(state.plans[0]))}`, 'true|false');

  /* C. Planned session in the logger */
  await go(page, 'home'); await wait();
  check('C Today shows today\'s planned session', `${(await view()).includes('Today: Full Body A')}|${await page.isVisible('#view [data-action=review][data-kind=planned]')}`, 'true|true');
  check('C week strip marks planned days', await page.$$eval('.wk-day.planned', (d) => d.length), 3);
  await page.click('#view [data-action=start-flow]'); await wait();
  check('C Train chooser offers the planned session first', `${/from your plan/i.test(await sheet())}|${(await sheet()).toLowerCase().indexOf('from your plan') < (await sheet()).toLowerCase().indexOf('from a template')}`, 'true|true');
  await page.click('#sheet [data-action=review][data-kind=planned]'); await wait();
  t = await sheet();
  check('C review shows plan context and targets', t.includes('Full Body 3×/week · Week 1') && t.includes('Squat') && t.includes('3 × 6–10 reps') && t.includes('Begin Workout'), true);
  check('C reviewing does not start anything', `${(await st()).active}`, 'null');
  await page.click('#sheet [data-action=begin]'); await wait(600);
  let a = (await st()).active;
  check('C active workout linked, with planned record', `${a.name}|${JSON.stringify(a.plan)}|${a.planned.title}|${a.planned.week}|${a.planned.items.length}|${a.entries.map((e) => `${e.sets.length}:${e.planned.min}-${e.planned.max}`).join(',')}`,
    `Full Body A|{"planId":"${PID}","sessionKey":"w1-1"}|Full Body A|1|5|3:6-10,3:6-10,3:8-12,2:8-12,2:10-15`);
  check('C session in progress', await ev((id) => sessionStatus(findPlan(state, id), 'w1-1').status, PID), 'in-progress');
  check('C banner and targets on screen', `${await page.isVisible('.plan-banner')}|${await page.$$eval('.ex-card .ex-target', (x) => x.length)}|${(await page.innerText('.ex-card[data-entry="0"] .ex-target')).replace(/\s+/g, ' ')}`, 'true|5|TARGET 3 × 6–10 reps');
  check('C previous values still shown', await page.innerText('.ex-card[data-entry="0"] .set-row[data-set="0"] .prev'), '80×10');
  check('C recommendation from last time uses the program range', (await page.innerText('.ex-card[data-entry="0"] .prog')).replace(/\s+/g, ' '), (v) => v.includes('Increase weight → 82.5 kg') && v.includes('target 6–10 reps'));
  // Ticking: blank values fill from last time, rest timer starts (unchanged logging)
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
  a = (await st()).active;
  check('C tick fills from last time; rest timer runs', `${a.entries[0].sets[0].weight}|${a.entries[0].sets[0].reps}|${await page.isVisible('#sb-rest')}`, '80|10|true');
  await page.click('[data-action=rest-skip]');
  await page.fill('[data-field=weight][data-entry="0"][data-set="1"]', '82.5'); await page.fill('[data-field=reps][data-entry="0"][data-set="1"]', '8');
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="1"]'); await wait();
  await page.click('[data-action=rest-skip]').catch(() => {});
  check('C live recommendation from today keeps program range', (await page.innerText('.ex-card[data-entry="0"] .prog')).replace(/\s+/g, ' '), (v) => v.includes('Keep 82.5 kg') && v.includes('based on today so far · target 6–10 reps'));

  /* D. Swapping an exercise */
  await page.fill('[data-field=weight][data-entry="2"][data-set="0"]', '50');
  await page.click('[data-action=entry-menu][data-entry="2"]'); await wait();
  check('D swap offered for planned exercises', await page.isVisible('#sheet [data-action=swap-exercise]'), true);
  await page.click('#sheet [data-action=swap-exercise]'); await wait();
  check('D picker titled Swap Exercise', (await sheet()).includes('Swap Exercise'), true);
  const rowId = await ev(() => state.exercises.find((e) => e.name === 'Seated Cable Row').id);
  const barbellRow = await ev(() => state.exercises.find((e) => e.name === 'Barbell Row').id);
  dialogs.length = 0;
  await page.click(`#sheet [data-action=pick-exercise][data-id="${rowId}"]`); await wait();
  a = (await st()).active;
  check('D swap asks before clearing entered values, then records the planned exercise', `${dialogs.length && dialogs[0].includes('will be cleared')}|${a.entries[2].exerciseId === rowId}|${a.entries[2].swappedFrom === barbellRow}|${a.entries[2].sets.length}|${a.entries[2].sets.every((x) => x.weight === '' && !x.done)}|${JSON.stringify(a.entries[2].planned)}`,
    'true|true|true|3|true|{"sets":3,"min":8,"max":12}');
  check('D swap shown on the card', (await page.innerText('.ex-card[data-entry="2"] .ex-target')).includes('instead of Barbell Row'), true);
  check('D plan and templates unchanged by the swap', `${JSON.stringify((await st()).plans[0].weeks) === snap}|${(await st()).templates.length}`, 'true|1');
  await page.click('[data-action=entry-menu][data-entry="2"]'); await wait();
  await page.click('#sheet [data-action=swap-exercise]'); await wait();
  await page.click(`#sheet [data-action=pick-exercise][data-id="${barbellRow}"]`); await wait();
  check('D swapping back removes the record', 'swappedFrom' in (await st()).active.entries[2], false);
  await page.click('[data-action=entry-menu][data-entry="2"]'); await wait();
  await page.click('#sheet [data-action=swap-exercise]'); await wait();
  await page.click(`#sheet [data-action=pick-exercise][data-id="${rowId}"]`); await wait();
  for (const [e, j, kg, r] of [[2, 0, 50, 12], [2, 1, 50, 12], [1, 0, 60, 10]]) {
    await page.fill(`[data-field=weight][data-entry="${e}"][data-set="${j}"]`, String(kg)); await page.fill(`[data-field=reps][data-entry="${e}"][data-set="${j}"]`, String(r));
    await page.click(`[data-action=toggle-set][data-entry="${e}"][data-set="${j}"]`); await wait(150);
  }
  await page.click('[data-action=rest-skip]').catch(() => {});
  check('D the swapped exercise uses the planned range (12 = top of 8–12 → increase)', (await page.innerText('.ex-card[data-entry="2"] .prog')).replace(/\s+/g, ' '), (v) => v.includes('Increase weight → 52.5 kg'));
  check('D live workout fits the screen', await noOverflow(), true);

  /* E. Finish: planned vs actual; History */
  await page.click('[data-action=finish]'); await wait();
  t = await sheet();
  check('E finish shows planned vs actual', /planned vs actual/i.test(t) && t.includes('Full Body A · Week 1 · 5 of 13 planned sets · 1 swap'), true);
  check('E rows: done/partial/not done, swap, reps vs range', ['Squat 2/3 sets · target 6–10 reps · reps 10, 8 · in range Partly done', 'Seated Cable Row instead of Barbell Row 2/3 sets · target 8–12 reps · reps 12, 12 · in range Partly done', 'Overhead Press 0/2 sets · target 8–12 reps Not done'].map((x) => t.includes(x)).join(','), 'true,true,true');
  check('E finish fits the screen', await noOverflow(), true);
  await page.click('#sheet [data-action=save-workout]:not([data-include])'); await wait(600);
  s = await st();
  const saved = s.workouts.find((w) => w.planned);
  check('E saved with link, planned record, targets (3 exercises with sets) and swap', `${JSON.stringify(saved.plan)}|${saved.planned.items.length}|${saved.entries.filter((e) => e.planned).length}|${saved.entries.find((e) => e.swappedFrom)?.exerciseId === rowId}`, `{"planId":"${PID}","sessionKey":"w1-1"}|5|3|true`);
  check('E session completed', await ev((id) => sessionStatus(findPlan(state, id), 'w1-1').status, PID), 'completed');
  await go(page, 'history'); await wait();
  check('E History list tags plan workouts', await page.$$eval('.hist-item .plan-tag', (x) => x.length), 1);
  await page.click(`[data-action=open-workout][data-id="${saved.id}"]`); await wait();
  t = await sheet();
  check('E History detail: plan context, planned vs actual, swap, targets', t.includes('Full Body 3×/week · Week 1 · Full Body A (planned Mon, 9 Nov)') && /planned vs actual/i.test(t) && t.includes('instead of Barbell Row') && t.includes('3 × 6–10 reps'), true);
  check('E History recommendation uses the program range', t, (v) => v.includes('from this session · target 6–10 reps'));
  check('E History detail fits the screen', await noOverflow(), true);
  await page.click('#sheet [data-action=edit-workout]'); await wait();
  await page.click('[data-action=save-wedit]'); await wait();
  const edited = (await st()).workouts.find((w) => w.id === saved.id);
  check('E editing keeps link, planned record, targets and swap', `${JSON.stringify(edited.plan) === JSON.stringify(saved.plan)}|${JSON.stringify(edited.planned) === JSON.stringify(saved.planned)}|${JSON.stringify(edited.entries.map((e) => [e.planned, e.swappedFrom])) === JSON.stringify(saved.entries.map((e) => [e.planned, e.swappedFrom]))}`, 'true|true|true');
  await page.click('#sheet [data-action=save-history-template]'); await wait();
  const tpl = (await st()).templates.slice(-1)[0];
  check('E Save as Template: no plan fields', JSON.stringify(tpl).includes('planned') || JSON.stringify(tpl).includes('swappedFrom') || 'plan' in tpl, false);
  await page.click('#sheet [data-action=repeat]'); await wait();
  await page.click('#sheet [data-action=begin]'); await wait(600);
  a = (await st()).active;
  check('E Repeat: a normal workout (no plan, targets or swap)', `${'plan' in a}|${'planned' in a}|${a.entries.some((e) => e.planned || e.swappedFrom)}|${await page.isVisible('.plan-banner')}`, 'false|false|false|false');
  await page.click('[data-action=entry-menu][data-entry="0"]'); await wait();
  check('E no swap option outside planned workouts', await page.isVisible('#sheet [data-action=swap-exercise]'), false);
  await closeSheet();
  await page.fill('[data-field=weight][data-entry="0"][data-set="0"]', '82.5'); await page.fill('[data-field=reps][data-entry="0"][data-set="0"]', '10');
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
  await page.click('[data-action=rest-skip]').catch(() => {});
  check('E outside a program the default 8–12 range applies (10 reps → keep)', (await page.innerText('.ex-card[data-entry="0"] .prog')).replace(/\s+/g, ' '), (v) => v.includes('Keep 82.5 kg') && !v.includes('target'));
  await ev(() => { state.active = null; save(); render(); });

  /* F. Recommendation rules with ranges */
  const adv = (reps, range) => ev(([reps, range]) => progressionAdvice(reps.map((r) => ({ weight: 100, reps: String(r), done: true })), 2.5, range)?.action, [reps, range]);
  const R = { min: 5, max: 8 };
  check('F 5–8: all at 8 → increase; one at 9 → increase; 6,7 → keep; all under 5 → decrease',
    [await adv([8, 8, 8], R), await adv([9, 6], R), await adv([6, 7], R), await adv([4, 4], R)].join(','), 'increase,increase,keep,decrease');
  check('F default 8–12 unchanged: 12,12 / 13,8 / 7,7 / 10,9', [await adv([12, 12]), await adv([13, 8]), await adv([7, 7]), await adv([10, 9])].join(','), 'increase,increase,decrease,keep');
  check('F the same sets differ by range: 10,10 → keep at 8–12, increase at 6–10', [await adv([10, 10]), await adv([10, 10], { min: 6, max: 10 })].join(','), 'keep,increase');
  check('F invalid ranges fall back to 8–12', [await adv([12, 12], { min: 9, max: 3 }), await adv([12, 12], { min: 0, max: 8 }), await adv([12, 12], null)].join(','), 'increase,increase,increase');

  /* G. Statuses, skip, move, mark done, conflicts */
  await setDay('2026-11-12T09:00:00+01:00'); // Thursday: Wed's session was missed
  await go(page, 'plans'); await wait();
  const rows = async () => (await page.$$eval('.plan-card .plan-sess', (r) => r.map((x) => x.querySelector('.pstatus').textContent).join(',')));
  check('G Thursday: Mon done, Wed missed, Fri upcoming', await rows(), 'Done,Missed,Upcoming');
  check('G counts', (await page.innerText('.plan-counts')).replace(/\s+/g, ' '), '1 done 1 missed 0 skipped 16 to go');
  await page.click(`.plan-sess[data-id="${PID}|w1-2"]`); await wait();
  t = await sheet();
  check('G missed session: start, skip, mark done, move offered', ['Start Workout', 'Skip Session', 'Mark as Done', 'move to another day'].map((x) => t.toLowerCase().includes(x.toLowerCase())).join(','), 'true,true,true,true');
  check('G session sheet fits the screen', await noOverflow(), true);
  await page.fill('#plan-move-date', '2026-11-14');
  await page.click('#sheet [data-action=plan-move]'); await wait();
  check('G move: only that session, shown as moved', `${await ev((id) => sessionStatuses(findPlan(state, id)).map((x) => x.date).slice(0, 6).join(','), PID)}|${(await sheet()).includes('moved from Wed, 11 Nov')}`, '2026-11-09,2026-11-14,2026-11-13,2026-11-16,2026-11-18,2026-11-20|true');
  await page.click('#sheet [data-action=plan-skip]'); await wait();
  check('G skip', await ev((id) => sessionStatus(findPlan(state, id), 'w1-2').status, PID), 'skipped');
  await page.click('#sheet [data-action=plan-clear]'); await wait();
  check('G undo skip', await ev((id) => sessionStatus(findPlan(state, id), 'w1-2').status, PID), 'upcoming');
  await closeSheet();
  await page.click(`.plan-sess[data-id="${PID}|w1-1"]`); await wait();
  check('G done session: view and unlink offered', `${(await sheet()).includes('View Workout')}|${(await sheet()).includes('Unlink Workout')}`, 'true|true');
  await closeSheet();
  // Conflicts with a sport plan on the same days
  await ev((d) => { const def = registerPlanDefinition(eval(d)); addPlan(state, createPlan(def, {}, '2026-11-11', { id: 'run1' }).plan); save(); render(); }, RUN_DEF);
  await go(page, 'plans'); await wait();
  check('G no same-day sessions yet: no warning (the strength session moved off Wed; past days ignored)', `${await ev(() => planConflicts(state).length)}|${(await view()).includes('Sessions from two plans on the same day')}`, '0|false');
  await ev(() => { moveSession(state, 'run1', 'r3', '2026-11-13'); save(); render(); });
  await go(page, 'plans'); await wait();
  check('G conflict after a move', `${await ev(() => planConflicts(state).map((c) => c.date).join(','))}|${(await view()).includes('Sessions from two plans on the same day')}|${(await view()).includes('Long run (Test run plan)')}`, '2026-11-13|true|true');

  /* H. Backup and restore */
  await go(page, 'settings'); await wait();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
  const file = `${DIR}/programs.json`; await dl.saveAs(file);
  const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('H export: format 2 with plans, planned records and swaps', `${exp.format}|${exp.counts.plans}|${exp.data.workouts.filter((w) => w.planned).length}|${exp.data.workouts.some((w) => w.entries.some((e) => e.swappedFrom))}`, '2|2|1|true');
  const before = await st();
  await ev(() => { state.plans = []; state.workouts = state.workouts.filter((w) => !w.planned); save(); render(); });
  await page.setInputFiles('#import-file', file); await wait(400);
  if (await page.$('#sheet [data-action=restore-toggle-copy][aria-checked=true]')) await page.click('#sheet [data-action=restore-toggle-copy]');
  await page.click('#sheet [data-action=restore-confirm]'); await wait(500);
  const after = await st();
  check('H restore: plans, links, planned records and swaps back exactly', `${JSON.stringify(after.plans) === JSON.stringify(before.plans)}|${JSON.stringify(after.workouts) === JSON.stringify(before.workouts)}`, 'true|true');
  check('H statuses after restore', await ev((id) => sessionStatuses(findPlan(state, id)).slice(0, 3).map((x) => x.status).join(','), PID), 'completed,upcoming,upcoming');
  const broken = JSON.parse(JSON.stringify(exp)); broken.data.workouts.find((w) => w.planned).entries[0].planned = { sets: 3, min: 12, max: 6 };
  const keep = await ev((k) => localStorage.getItem(k), KEY);
  await ev(() => closeSheet());
  await go(page, 'settings'); await wait();
  fs.writeFileSync(`${DIR}/broken.json`, JSON.stringify(broken));
  await page.setInputFiles('#import-file', `${DIR}/broken.json`); await wait(400);
  check('H damaged program target: refused, nothing changed', `${(await sheet()).includes('invalid program target')}|${await ev((k) => localStorage.getItem(k), KEY) === keep}`, 'true|true');
  const brokenPlan = JSON.parse(JSON.stringify(exp)); brokenPlan.data.plans.find((p) => p.kind === 'strength').weeks[0].sessions[0].targets.exercises[0].sets = 0;
  check('H damaged plan targets refused', await ev((b) => validateBackup(b).errors?.join(' ') || 'accepted', brokenPlan), (v) => v.includes('invalid exercise targets'));
  await closeSheet();

  /* I. Stop the program */
  await go(page, 'plans'); await wait();
  await page.click(`.plan-card [data-action=plan-open][data-id="${PID}"]`); await wait();
  check('I full schedule lists 6 weeks', ((await sheet()).match(/week \d+/gi) || []).length >= 6, true);
  check('I schedule fits the screen', await noOverflow(), true);
  await page.click('#sheet [data-action=plan-stop]'); await wait();
  s = await st();
  check('I stopped: future sessions cancelled, done session kept', `${s.plans.find((p) => p.id === PID).status}|${await ev((id) => sessionStatuses(findPlan(state, id)).slice(0, 4).map((x) => x.status).join(','), PID)}`, 'stopped|completed,cancelled,cancelled,cancelled');
  check('I library available again; past plans listed', `${await page.isDisabled('[data-action=plan-setup][data-id=upper-lower-4]')}|${/past plans/i.test(await view())}`, 'false|true');
  check('I workouts kept', (await st()).workouts.some((w) => w.planned), true);

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
