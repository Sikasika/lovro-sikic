// Structured strength programs (programs.js registerStrengthProgram): a fixed number of weeks,
// each with its own workouts and changes; warm-ups, RIR, rest, techniques, substitutes.
// Uses a made-up example program (TEST_PROGRAM below), registered before the app starts.
// Usage: node structured-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const BEFORE = 'b5623fa'; // the release before structured programs
const OLD_PORT = 3250 + (scheme === 'dark' ? 2 : 0) + (width === 320 ? 1 : 0);
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const up = (port) => new Promise((res) => http.get(`http://localhost:${port}/training-tracker/`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));

// A made-up 12-week program: two 6-week blocks, five workouts a week, an intro week, lighter weeks.
const X = (name, category, sets, reps, more = {}) => ({ name, category, sets, reps, ...more });
const TEST_PROGRAM = {
  id: 'test-structured', version: 1, name: 'Test Program (5-Day)', author: 'Test Author', level: 'Intermediate',
  summary: 'A made-up program used by the tests.', daysPerWeek: 5, defaultDays: [0, 1, 3, 4, 5],
  notes: ['Warm up before the first exercise.', 'Add weight when you reach the top of the rep range at the target RIR.'],
  blocks: [{ name: 'Block 1', from: 1, to: 6, note: 'Foundation' }, { name: 'Block 2', from: 7, to: 12, note: 'Intensity techniques' }],
  workouts: {
    U1: { title: 'Upper #1', exercises: [
      X('Bench Press', 'Chest', 3, [6, 8], { warmup: [2, 3], rir: '1–2', rest: [180, 240], subs: ['Machine Chest Press', 'Push-up'] }),
      X('Barbell Row', 'Back', 3, [8, 10], { warmup: 1, rir: 1, rest: 120 }),
      X('Lateral Raise', 'Shoulders', 2, [12, 15], { rir: 0, rest: 60 })] },
    L1: { title: 'Lower #1', exercises: [
      X('Squat', 'Legs', 3, [6, 8], { warmup: [2, 4], rir: '1–2', rest: [180, 300] }),
      X('Leg Curl', 'Legs', 3, [10, 12], { rir: 1, rest: 90 })] },
    U2: { title: 'Upper #2', exercises: [
      X('Overhead Press', 'Shoulders', 3, [8, 10], { warmup: 2, rir: 1, rest: 150 }),
      X('Lat Pulldown', 'Back', 3, [10, 12], { rir: 1, rest: 120, note: 'Pull to the upper chest.' })] },
    L2: { title: 'Lower #2', exercises: [
      X('Romanian Deadlift', 'Legs', 3, [8, 10], { warmup: 2, rir: 2, rest: 180 }),
      X('Test Hip Thrust Variant', 'Legs', 3, [10, 12], { rir: 1, rest: 120 })] },
    AD: { title: 'Arms + Delts', exercises: [
      X('Barbell Curl', 'Arms', 3, [10, 12], { rir: 0, rest: 90 }),
      X('Tricep Pushdown', 'Arms', 3, [10, 12], { rir: 0, rest: 90 })] },
    U1B: { title: 'Upper #1', exercises: [
      X('Incline Dumbbell Press', 'Chest', 3, [8, 10], { warmup: 2, rir: '0–1', rest: [150, 180] }),
      X('Lateral Raise', 'Shoulders', 2, [12, 15], { rir: 0, rest: 60, technique: 'drop' })] },
    ADB: { title: 'Arms + Delts', exercises: [
      X('Barbell Curl', 'Arms', 2, [10, 12], { rir: 0, rest: 90, technique: 'myo' }),
      X('Tricep Pushdown', 'Arms', 3, [10, 12], { rir: 0, rest: 90, technique: 'drop', dropSets: 2 })] }
  },
  weeks: [
    { label: 'Intro week', note: 'Lighter introduction.', workouts: ['U1', 'L1', 'U2', 'L2', 'AD'], changes: { U1: { '*': { rir: '3' }, 'Bench Press': { sets: 2 } }, L1: { 0: { sets: 2 } } } },
    ...[2, 3, 4, 5].map(() => ({ workouts: ['U1', 'L1', 'U2', 'L2', 'AD'] })),
    { label: 'Lighter week', deload: true, workouts: ['U1', 'L1', 'U2', 'L2', 'AD'], changes: { U1: { '*': { sets: 2, rir: '3–4' } } } },
    ...[7, 8, 9, 10, 11].map(() => ({ workouts: ['U1B', 'L1', 'U2', 'L2', 'ADB'] })),
    { label: 'Lighter week', deload: true, workouts: ['U1B', 'L1', 'U2', 'L2', 'ADB'], changes: { ADB: { '*': { technique: '', sets: 2 } } } }
  ]
};

(async () => { try { await main(); } catch (e) { console.log(results.join('\n')); console.log('CRASH', e.stack.split('\n').slice(0, 12).join(' / ')); console.log('PASSES: 0  FAILS: 1'); process.exit(1); } })();
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 760 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  // Register the example program before the app's first render, on every load.
  await ctx.addInitScript((def) => { document.addEventListener('DOMContentLoaded', () => { try { registerStrengthProgram(def); } catch (e) { window.__regError = e.message; } }); }, TEST_PROGRAM);
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.clock.setFixedTime(new Date('2026-11-23T09:00:00+01:00')); // Monday
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 250) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // Text as one line, lower-case (section titles are shown in capitals by CSS)
  const txt = async (s) => (await page.innerText(s)).replace(/\s+/g, ' ').toLowerCase();
  const has = (t, x) => t.includes(x.toLowerCase());
  // Nothing wider than the screen, except inside rows that scroll sideways by design
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#view *, #sheet *')].every((el) => {
    if (el.offsetParent === null || el.closest('svg') || el.getBoundingClientRect().right <= window.innerWidth + 1) return true;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(p).overflowX)) return true;
    return false;
  }));

  /* A. Definitions */
  check('A example program registered without problems', `${await ev(() => window.__regError || 'ok')}|${await ev((d) => programDefinitionProblems(d).length, TEST_PROGRAM)}`, 'ok|0');
  const bad = await ev((d) => {
    const c = (f) => { const x = JSON.parse(JSON.stringify(d)); f(x); return programDefinitionProblems(x).join(' | '); };
    return {
      days: c((x) => { x.weeks[3].workouts.pop(); }),
      unknown: c((x) => { x.weeks[2].workouts[0] = 'NOPE'; }),
      reps: c((x) => { x.workouts.U1.exercises[0].reps = [10, 6]; }),
      change: c((x) => { x.weeks[0].changes.U1['Not There'] = { sets: 1 }; }),
      block: c((x) => { x.blocks[1].to = 14; })
    };
  }, TEST_PROGRAM);
  check('A incomplete definitions are caught (wrong number of workouts, unknown workout, bad reps, unknown exercise in changes, block past the end)',
    [bad.days.includes('week 4 must list 5 workouts'), bad.unknown.includes('unknown workout NOPE'), bad.reps.includes('reps must be'), bad.change.includes('unknown exercise Not There'), bad.block.includes('Block 2 has invalid weeks')].join(','), 'true,true,true,true,true');
  check('A registering an incomplete definition throws (never half-added)', await ev((d) => { const x = JSON.parse(JSON.stringify(d)); x.id = 'broken'; x.weeks.pop(); x.weeks[0].workouts = ['U1']; try { registerStrengthProgram(x); return 'added'; } catch (e) { return `${e.message.startsWith('Invalid program definition')}|${!!findProgram('broken')}`; } }, TEST_PROGRAM), 'true|false');

  /* B. Library, setup and review */
  await ev(() => { localStorage.clear(); state = defaultState(); save(); ui.tab = 'plans'; render(); }); await wait();
  const lib = await txt('#view');
  check('B listed with author, level, 5 days a week, 12 weeks; existing programs still listed', `${has(lib, 'Test Program (5-Day)')}|${has(lib, 'Test Author · Intermediate · 5 days a week · 12 weeks')}|${has(lib, 'Full Body 3×/week')}|${has(lib, 'Upper/Lower 4×/week')}`, 'true|true|true|true');
  await page.click('[data-action=plan-setup][data-id="test-structured"]'); await wait();
  let t = await txt('#sheet');
  check('B setup: 12 weeks set by the program with its blocks; no length or lighter-week choice', `${has(t, '12 weeks, set by the program (Block 1: weeks 1–6, Block 2: weeks 7–12)')}|${!!(await page.$('#ps-weeks'))}|${!!(await page.$('[data-action=ps-deload]'))}`, 'true|false|false');
  check('B setup: how it works (author, blocks, notes) and each block\'s workouts', `${has(t, 'By Test Author')}|${has(t, 'Foundation')}|${has(t, 'Warm up before the first exercise.')}|${has(t, 'Block 1 · week 1 workouts')}|${has(t, 'Block 2 · week 7 workouts')}`, 'true|true|true|true|true');
  check('B setup fits the screen', await noOverflow(), true);
  await page.click('[data-action=ps-review]'); await wait();
  t = await txt('#sheet');
  const weekHeads = await ev(() => [...document.querySelectorAll('#sheet .section-title')].map((x) => x.textContent.trim()).filter((x) => /^Week/i.test(x)));
  check('B review: all 12 weeks with block and week labels', JSON.stringify(weekHeads.map((x) => x.replace(/\s+/g, ' '))), (v) => { const a = JSON.parse(v); return a.length === 12 && /Week 1 · Block 1 · Intro week/i.test(a[0]) && /Week 6 · Block 1 · Lighter week/i.test(a[5]) && /Week 7 · Block 2$/i.test(a[6]) && /Week 12 · Block 2 · Lighter week/i.test(a[11]); });
  check('B review: 60 sessions, each expandable with its exercises', `${await ev(() => document.querySelectorAll('#sheet details.plan-sess-details').length)}|${has(t, '60 sessions')}`, '60|true');
  await page.click('#sheet details.plan-sess-details >> nth=0'); await wait(150);
  const s1 = await ev(() => document.querySelector('#sheet details.plan-sess-details[open]').innerText.replace(/\s+/g, ' ').toLowerCase());
  check('B week 1 Upper #1 expanded: intro changes applied (Bench 2 sets, RIR 3 for all), warm-ups, rest, substitutes, week note', `${has(s1, 'Bench Press 2 × 6–8 reps 2–3 warm-up sets RIR 3 Rest 3–4 min')}|${has(s1, 'Barbell Row 3 × 8–10 reps 1 warm-up set RIR 3 Rest 2 min')}|${has(s1, 'Substitutes: Machine Chest Press, Push-up')}|${has(s1, 'Lighter introduction.')}`, 'true|true|true|true');
  check('B review fits the screen (expanded)', await noOverflow(), true);
  await page.click('[data-action=ps-start]'); await wait(400);

  /* C. The saved plan */
  const plan = await ev(() => { const p = state.plans[0]; return { weeks: p.weeks.length, sessions: p.weeks.reduce((n, w) => n + w.sessions.length, 0), labels: p.weeks.map((w) => w.label || ''), deload: p.weeks.filter((w) => w.deload).map((w) => w.week),
    order: p.weeks.map((w) => w.sessions.map((s) => s.targets.workout).join(',')), dates: p.weeks[0].sessions.map((s) => s.date).join(','), end: p.endDate, guide: p.summary?.program,
    w1u1: p.weeks[0].sessions[0].targets.exercises.map((x) => `${x.name}:${x.sets}:${x.min}-${x.max}:${x.rir}:${(x.warmup || []).join('-')}:${(x.rest || []).join('-')}`),
    w2u1: p.weeks[1].sessions[0].targets.exercises.map((x) => `${x.name}:${x.sets}:${x.rir}`),
    w7: p.weeks[6].sessions.map((s) => `${s.title}:${s.targets.exercises.map((x) => x.name + (x.technique ? `[${x.technique}${x.dropSets ? x.dropSets : ''}]` : '')).join('+')}`),
    w12ad: p.weeks[11].sessions[4].targets.exercises.map((x) => `${x.name}:${x.sets}:${x.technique || '-'}`), resolved: p.weeks.every((w) => w.sessions.every((s) => s.targets.exercises.every((x) => x.exerciseId))) }; });
  check('C 12 weeks, 60 sessions, every exercise linked to the library', `${plan.weeks}|${plan.sessions}|${plan.resolved}`, '12|60|true');
  check('C weeks 1–6 use block 1 workouts, 7–12 block 2, always in program order', JSON.stringify(plan.order), JSON.stringify([...Array(6).fill('U1,L1,U2,L2,AD'), ...Array(6).fill('U1B,L1,U2,L2,ADB')]));
  check('C sessions on the chosen days (Mon, Tue, Thu, Fri, Sat); ends week 12 Saturday', `${plan.dates}|${plan.end}`, '2026-11-23,2026-11-24,2026-11-26,2026-11-27,2026-11-28|2027-02-13');
  check('C labels and lighter weeks', `${plan.labels[0]}|${plan.labels[6]}|${plan.labels[11]}|${plan.deload.join(',')}`, 'Block 1 · Intro week|Block 2|Block 2 · Lighter week|6,12');
  check('C week 1 targets exactly as prescribed after changes', JSON.stringify(plan.w1u1), JSON.stringify(['Bench Press:2:6-8:3:2-3:180-240', 'Barbell Row:3:8-10:3:1-1:120-120', 'Lateral Raise:2:12-15:3::60-60']));
  check('C week 2 back to the base prescription', JSON.stringify(plan.w2u1), JSON.stringify(['Bench Press:3:1–2', 'Barbell Row:3:1', 'Lateral Raise:2:0']));
  check('C block 2 workouts with their techniques', JSON.stringify(plan.w7), (v) => v.includes('Upper #1:Incline Dumbbell Press+Lateral Raise[drop1]') && v.includes('Arms + Delts:Barbell Curl[myo]+Tricep Pushdown[drop2]'));
  check('C week 12 change removes the technique and sets 2', JSON.stringify(plan.w12ad), JSON.stringify(['Barbell Curl:2:-', 'Tricep Pushdown:2:-']));
  check('C program guide saved with the plan', `${plan.guide?.author}|${plan.guide?.blocks.length}|${plan.guide?.notes.length}`, 'Test Author|2|2');
  check('C new exercise added to the library; existing ones reused (no duplicates)', await ev(() => `${state.exercises.filter((e) => e.name === 'Test Hip Thrust Variant').length}|${state.exercises.filter((e) => e.name === 'Bench Press').length}`), '1|1');

  /* D. Today's session: review, logger, rest, swap */
  await ev(() => { closeSheet(); ui.tab = 'home'; render(); }); await wait();
  await page.click('#view .hero-btn'); await wait();
  t = await txt('#sheet');
  check('D Today → review shows the prescription (warm-ups, RIR, rest) and the week label', `${has(t, 'Bench Press 2 × 6–8 reps 2–3 warm-up sets RIR 3 Rest 3–4 min')}|${has(t, 'Block 1 · Intro week')}`, 'true|true');
  check('D review fits', await noOverflow(), true);
  await page.click('#sheet [data-action=begin]'); await wait(400);
  const rows = await ev(() => state.active.entries.map((e) => e.sets.map((s) => (s.type || 'w')[0]).join('')));
  check('D logger rows: Bench 2 warm-up + 2 working; Row 1 + 3; Raises 2 working', JSON.stringify(rows), JSON.stringify(['wwww', 'wwww', 'ww']));
  check('D Bench rows are warm-up, warm-up, working, working', await ev(() => state.active.entries[0].sets.map((s) => s.type || 'working').join(',')), 'warmup,warmup,working,working');
  const target = await ev(() => [...document.querySelector('.ex-card[data-entry="0"] .ex-target').children].map((c) => c.textContent.trim()).join(' '));
  check('D target line in the logger: sets × reps · warm-ups · RIR · rest', target, 'Target 2 × 6–8 reps · 2–3 warm-up sets · RIR 3 · Rest 3–4 min');
  check('D logger fits the screen', await noOverflow(), true);
  // Rest: warm-up uses the usual rest; working set uses the program's rest (lower end)
  await page.fill('[data-field=weight][data-entry="0"][data-set="0"]', '40'); await page.fill('[data-field=reps][data-entry="0"][data-set="0"]', '10');
  await ev(() => { ui.tapGuardUntil = 0; }); await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
  check('D warm-up set: the usual rest (90 s)', await ev(() => Math.round((ui.restEnd - Date.now()) / 1000)), (v) => v >= 88 && v <= 90);
  await page.fill('[data-field=weight][data-entry="0"][data-set="2"]', '80'); await page.fill('[data-field=reps][data-entry="0"][data-set="2"]', '7');
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="2"]'); await wait();
  check('D working set: the program\'s rest (3 min, lower end of 3–4)', await ev(() => Math.round((ui.restEnd - Date.now()) / 1000)), (v) => v >= 178 && v <= 180);
  // Swap with a program substitute that isn't in the library yet
  await page.click('[data-action=entry-menu][data-entry="0"]'); await wait();
  await page.click('[data-action=swap-exercise]'); await wait(400);
  t = await txt('#sheet');
  check('D Swap shows the program\'s substitutes first', `${has(t, 'Substitutes from the program')}|${t.indexOf('machine chest press') < t.indexOf('all exercises')}`, 'true|true');
  check('D swap sheet fits', await noOverflow(), true);
  await page.click('[data-action=pick-sub][data-name="Machine Chest Press"]'); await wait(400);
  const sw = await ev(() => { const e = state.active.entries[0]; return `${exName(e.exerciseId)}|${exName(e.swappedFrom)}|${exById(e.exerciseId).category}|${e.planned.rir}|${e.sets.map((s) => s.type || 'working').join(',')}`; });
  check('D picked: added to the library (Chest), swapped for this workout, target and row types kept', sw, 'Machine Chest Press|Bench Press|Chest|3|warmup,warmup,working,working');
  // Log the session and finish
  await ev(() => { state.active.entries.forEach((e) => e.sets.forEach((s) => { s.weight = 50; s.reps = '8'; s.done = true; })); save(); render(); });
  await page.click('[data-action=finish]'); await wait();
  await page.click('#sheet .save-btn[data-action=save-workout]'); await wait(500);
  const done = await ev(() => { const w = state.workouts[0]; const s = sessionStatuses(state.plans[0])[0]; return { status: s.status, linked: s.workoutId === w.id, warm: w.entries[0].sets.filter((x) => x.type === 'warmup').length, planned: JSON.stringify(w.entries[0].planned), stats: completedWorkouts().items.length, vol: summarizeWorkouts(completedWorkouts().items).volume }; });
  check('D finished: session completed and linked; warm-ups saved as warm-ups; plan target saved on the entry', `${done.status}|${done.linked}|${done.warm}|${done.planned.includes('"rir":"3"')}&${done.planned.includes('"restSec":180')}`, 'completed|true|2|true&true');
  check('D statistics count it; volume leaves out the warm-ups (2+3+2 working sets of 50 × 8)', `${done.stats}|${done.vol}`, '1|2800');
  await ev(() => { openSheet(renderWorkoutDetail(state.workouts[0])); }); await wait();
  check('D History shows the same target line', has(await txt('#sheet'), 'Target 2 × 6–8 reps · 2–3 warm-up sets · RIR 3 · Rest 3–4 min'), true);
  await ev(() => closeSheet());

  /* E. Block 2 session in the logger: drop sets and myo-reps */
  const ad = await ev(() => { const p = state.plans[0]; const s = sessionStatuses(p).find((x) => x.week === 7 && x.title === 'Arms + Delts'); const w = plannedWorkout(p, s); return { rows: w.entries.map((e) => e.sets.map((x) => x.type || 'working').join(',')), tech: w.entries.map((e) => e.planned.technique) }; });
  check('E week 7 Arms + Delts: curls 2 working (myo-reps), pushdowns 3 working + 2 drop sets', JSON.stringify(ad), JSON.stringify({ rows: ['working,working', 'working,working,working,drop,drop'], tech: ['myo', 'drop'] }));

  /* F. Missed, skipped, resume */
  await page.clock.setFixedTime(new Date('2026-11-27T09:00:00+01:00')); // Friday
  await ev(() => { ui.tab = 'plans'; render(); }); await wait();
  const st1 = await ev(() => sessionStatuses(state.plans[0]).slice(0, 5).map((s) => s.status).join(','));
  check('F Friday: Mon completed, Tue and Thu missed, Fri today, Sat upcoming', st1, 'completed,missed,missed,today,upcoming');
  await ev(() => { const p = state.plans[0]; skipSession(state, p.id, p.weeks[0].sessions[1].key); save(); });
  await page.reload(); await wait(500);
  const st2 = await ev(() => `${state.plans.length}|${sessionStatuses(state.plans[0]).slice(0, 5).map((s) => s.status).join(',')}|${planProgress(state.plans[0]).completed}`);
  check('F after a reload: plan and statuses kept (skip kept), progress 1 completed', st2, '1|completed,skipped,missed,today,upcoming|1');
  await ev(() => openPlanSchedule(state.plans[0].id)); await wait();
  t = await txt('#sheet');
  check('F schedule shows week labels and how to follow the program', `${has(t, 'Week 1 · Block 1 · Intro week')}|${has(t, 'How to follow this program')}|${has(t, 'Add weight when you reach the top')}`, 'true|true|true');
  check('F schedule fits', await noOverflow(), true);
  await ev(() => closeSheet());

  /* G. Backups: round trip, and the previous release reads the new plan */
  const backup = await ev(() => buildBackup());
  check('G backup round trip: plan and workouts identical', await ev((b) => { const v = validateBackup(JSON.parse(JSON.stringify(b))); const s = restoredState(v, defaultState(), { source: 'file' }); return `${v.ok}|${JSON.stringify(s.plans) === JSON.stringify(state.plans)}|${JSON.stringify(s.workouts) === JSON.stringify(state.workouts)}`; }, backup), 'true|true|true');
  check('G a malformed program detail in a backup is reported', await ev((b) => { const x = JSON.parse(JSON.stringify(b)); x.data.plans[0].weeks[0].sessions[0].targets.exercises[0].rest = 'long'; return validateBackup(x).ok; }, backup), false);
  const site = path.join(os.tmpdir(), `pre-structured-${scheme}-${width}`);
  fs.rmSync(site, { recursive: true, force: true }); fs.mkdirSync(site, { recursive: true });
  execSync(`git -C "${path.join(__dirname, '..', '..')}" archive ${BEFORE} training-tracker | tar -x -C "${site}"`);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), site, String(OLD_PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up(OLD_PORT)); i++) await new Promise((res) => setTimeout(res, 100));
  try {
    const old = await (await browser.newContext({ ...devices['iPhone 14'], timezoneId: 'Europe/Zagreb', locale: 'en-GB' })).newPage();
    old.on('pageerror', (e) => errors.push(`v42: ${e.message}`));
    await old.clock.setFixedTime(new Date('2026-11-27T09:00:00+01:00'));
    await old.goto(`http://localhost:${OLD_PORT}/training-tracker/`); await old.waitForTimeout(300);
    const r = await old.evaluate((b) => { const v = validateBackup(b); if (!v.ok) return 'invalid'; state = restoredState(v, state, { source: 'file' }); save(); ui.tab = 'plans'; render();
      const sch = sessionStatuses(state.plans[0]).slice(0, 5).map((s) => s.status).join(','); openPlanSession(`${state.plans[0].id}|${state.plans[0].weeks[0].sessions[3].key}`);
      return `${v.ok}|${sch}|${document.querySelector('#sheet').innerText.includes('Romanian Deadlift')}`; }, backup);
    check('G the previous release (v42) restores the backup and shows the plan and a session\'s exercises (extra details ignored)', r, 'true|completed,skipped,missed,today,upcoming|true');
    // Existing programs build exactly the same plans as before
    const same = async (p) => {
      const args = { days: [0, 2, 4], weeks: 8, deload: 4 };
      const a = await old.evaluate(([id, x]) => { const r = createPlan(PLAN_LIBRARY.get(id), x.id === 'upper-lower-4' ? { ...x.a, days: [0, 1, 3, 4] } : x.a, '2026-11-30', { id: 'P', now: new Date(0) }); return JSON.stringify(r.plan); }, [p, { id: p, a: args }]);
      const b = await page.evaluate(([id, x]) => { const r = createPlan(PLAN_LIBRARY.get(id), x.id === 'upper-lower-4' ? { ...x.a, days: [0, 1, 3, 4] } : x.a, '2026-11-30', { id: 'P', now: new Date(0) }); return JSON.stringify(r.plan); }, [p, { id: p, a: args }]);
      return a === b && a.length > 1000;
    };
    check('G Full Body 3×/week and Upper/Lower 4×/week build byte-identical plans to v42', `${await same('full-body-3')}|${await same('upper-lower-4')}`, 'true|true');
  } finally { server.kill(); }

  /* H. Existing program setup unchanged */
  await ev(() => { ui.tab = 'plans'; ui.planCatalog = true; render(); }); await wait();
  await ev(() => openProgramSetup('full-body-3')); await wait();
  check('H Full Body setup still offers length and lighter weeks; its workouts list is unchanged', `${!!(await page.$('#ps-weeks'))}|${!!(await page.$('[data-action=ps-deload]'))}|${has(await txt('#sheet'), 'Squat 3×6–10')}`, 'true|true|true');
  await ev(() => closeSheet());

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
}
