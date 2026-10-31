// Back from a break: pick up where you left off (shift by whole weeks), event plans, undo, backups.
// Usage: node break-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { go } = require('./nav');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const V31 = '24cd54f'; // the release before this feature
const OLD_PORT = 3210 + (scheme === 'dark' ? 2 : 0) + (width === 320 ? 1 : 0);
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const up = (port) => new Promise((res) => http.get(`http://localhost:${port}/training-tracker/`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));

const TODAY = new Date('2026-11-25T09:00:00+01:00'); // Wednesday

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  let dialogs = [], answer = true;
  page.on('dialog', (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await page.clock.setFixedTime(TODAY);
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 200) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const sheet = async () => (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  const view = async () => (await page.innerText('#view')).replace(/\s+/g, ' ');
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#view *, #sheet *')].every((el) => el.offsetParent === null || el.closest('svg') || el.getBoundingClientRect().right <= window.innerWidth + 1));

  // Test helpers inside the page: build plans, link workouts, read schedules.
  await ev(() => {
    window.T = {
      reset() { localStorage.clear(); state = defaultState(); ui.brk = null; ui.breakDismissed = {}; save(); },
      strength(start = '2026-11-02', weeks = 8, days = [0, 2, 4]) { const p = createPlan(PLAN_LIBRARY.get('full-body-3'), { days, weeks, deload: 4 }, start).plan; state.plans.push(p); save(); return p.id; },
      swim(a, start) { const as = assessSwim(a, start); if (!as.ok) throw new Error(as.problems.join(' ')); const p = createPlan(PLAN_LIBRARY.get('swim'), a, start, { name: 'Swim plan' }).plan; state.plans.push(p); save(); return p.id; },
      ride(a, start) { const p = createPlan(PLAN_LIBRARY.get('bike'), a, start, { name: 'Ride plan' }).plan; state.plans.push(p); save(); return p.id; },
      keys(id) { return planSessions(findPlan(state, id)).map((s) => s.key); },
      link(id, key, wid = `w-${key}`) { const s = findSession(findPlan(state, id), key); state.workouts.push({ id: wid, name: s.title, notes: '', start: `${s.date}T08:00:00`, end: `${s.date}T09:00:00`, plan: { planId: id, sessionKey: key }, entries: [{ exerciseId: state.exercises[0].id, sets: [{ weight: 50, reps: 5, done: true }] }] }); save(); },
      st(id) { return sessionStatuses(findPlan(state, id), state).map((s) => ({ key: s.key, date: s.date, orig: s.originalDate, moved: s.moved, status: s.status })); },
      plan(id) { return JSON.parse(JSON.stringify(findPlan(state, id))); },
      dow(k) { return sFromKey(k).getDay(); }
    };
  });
  const reset = () => ev(() => T.reset());

  /* A. When it is offered, and the pick-up session */
  await reset();
  let P = await ev(() => T.strength());
  let K = await ev((id) => T.keys(id), P);
  await ev(([id, k]) => { T.link(id, k[0]); T.link(id, k[1]); }, [P, K]);
  let o = await ev((id) => { const x = breakOptions(state, id); return x && { event: x.event, missed: x.missed.map((s) => s.key) }; }, P);
  check('A 2 done, then 8 missed: offered; pick-up = first missed after the last done', `${o.event}|${o.missed[0]}|${o.missed.length}`, `false|${K[2]}|8`);
  await reset(); P = await ev(() => T.strength('2026-11-20'));
  K = await ev((id) => T.keys(id), P);
  await ev(([id, k]) => T.link(id, k[0]), [P, K]);
  check('A only one missed session: not offered', await ev((id) => breakOptions(state, id), P), null);
  await reset(); P = await ev(() => T.strength());
  K = await ev((id) => T.keys(id), P);
  await ev(([id, k]) => { T.link(id, k[3]); T.link(id, k[8]); }, [P, K]); // missed 0-2, done 3, missed 4-7, done 8, missed 9 (Mon 23) only
  check('A a completed session after the missed run: not offered (only 1 missed since)', await ev((id) => breakOptions(state, id), P), null);
  await ev(([id, k]) => { state.workouts = state.workouts.filter((w) => w.plan.sessionKey !== k[8]); save(); }, [P, K]);
  o = await ev((id) => breakOptions(state, id).missed.map((s) => s.key), P);
  check('A earlier misses before a done session are not part of the run', o.join(','), K.slice(4, 10).join(','));
  await ev(([id, k]) => { skipSession(state, id, k[5]); save(); }, [P, K]);
  o = await ev((id) => breakOptions(state, id).missed.map((s) => s.key), P);
  check('A a past skipped session counts like a done one (run starts after it)', o.join(','), K.slice(6, 10).join(','));
  await ev((id) => { stopPlan(state, id); save(); }, P);
  await ev(([id, k]) => { clearSessionStatus(state, id, k[5]); T.link(id, k[20]); }, [P, K]);
  check('A a session completed ahead of its day after the run: not offered', await ev((id) => breakOptions(state, id), P), null);
  check('A stopped plan: not offered', await ev((id) => breakOptions(state, id), P), null);
  await reset(); P = await ev(() => T.strength('2026-11-30'));
  check('A plan not started yet: not offered', await ev((id) => breakOptions(state, id), P), null);

  /* B. What moves and what stays */
  await reset(); P = await ev(() => T.strength());
  K = await ev((id) => T.keys(id), P);
  await ev(([id, k]) => {
    T.link(id, k[0]); T.link(id, k[1]); // done before the break
    moveSession(state, id, k[14], '2026-12-05'); // a future session moved by hand (Fri 4 Dec → Sat 5 Dec)
    skipSession(state, id, k[16]);       // a future skipped session
    save();
  }, [P, K]);
  const before = await ev((id) => T.plan(id), P);
  const beforeSt = await ev((id) => T.st(id), P);
  const workoutsBefore = await ev(() => JSON.stringify(state.workouts));
  let pv = await ev((id) => { const p = previewShift(state, id, {}); return { ok: p.ok, error: p.error, needed: p.needed, weeks: p.weeks, pickup: p.pickup.key, moving: p.items[0].moving.map((s) => s.key), left: p.items[0].leftMissed.map((s) => s.key), kept: p.items[0].keptDone.map((s) => s.key), after: p.items[0].after, beforeEnd: p.items[0].before }; }, P);
  check('B default: fewest whole weeks putting the pick-up session on today or later (Fri 6 Nov → 3 weeks)', `${pv.ok}|${pv.needed}|${pv.weeks}|${pv.pickup}`, `true|3|3|${K[2]}`);
  const expectMove = K.slice(2);
  check('B moves the pick-up session and every later one that isn\'t done (incl. skipped and moved ones)', pv.moving.join(','), expectMove.join(','));
  check('B nothing missed left behind', `${pv.kept.length}|${pv.left.length}`, '0|0');
  check('B a done, in-progress or linked session is never in the moving set', await ev(() => sessionsToShift([{ key: 'a', date: '2026-11-02', status: 'missed' }, { key: 'b', date: '2026-11-03', status: 'completed' }, { key: 'c', date: '2026-11-04', status: 'in-progress' }, { key: 'd', date: '2026-11-05', status: 'upcoming', workoutId: 'w' }, { key: 'e', date: '2026-11-06', status: 'skipped' }], '2026-11-01').map((x) => x.key).join(',')), 'a,e');
  check('B nothing changed by the preview', JSON.stringify(await ev((id) => T.plan(id), P)) === JSON.stringify(before), true);
  pv = await ev((id) => { const p = previewShift(state, id, { weeks: 2 }); return p.ok + '|' + p.error; }, P);
  check('B fewer weeks than needed refused', pv, (v) => v.startsWith('false|Choose 3 to 8 weeks'));
  pv = await ev((id) => { const p = previewShift(state, id, { weeks: 9 }); return p.ok + '|' + p.error; }, P);
  check('B more than 8 weeks refused', pv, (v) => v.startsWith('false|Choose 3 to 8 weeks'));
  await ev((id) => { applyShift(state, previewShift(state, id, { weeks: 4 })); save(); }, P);
  const after = await ev((id) => T.st(id), P);
  const byKey = (list) => new Map(list.map((s) => [s.key, s]));
  const b0 = byKey(beforeSt), a0 = byKey(after);
  const moved = expectMove.every((k) => {
    const x = b0.get(k), y = a0.get(k);
    const days = (Date.parse(y.date) - Date.parse(x.date)) / 864e5, odays = (Date.parse(y.orig) - Date.parse(x.orig)) / 864e5;
    return days === 28 && odays === 28;
  });
  check('B every moved session is exactly 4 weeks later (its day and its "moved from" day)', moved, true);
  check('B weekdays kept for every moved session', await ev(([b, a, ks]) => ks.every((k) => T.dow(b.find((s) => s.key === k).date) === T.dow(a.find((s) => s.key === k).date)), [beforeSt, after, expectMove]), true);
  check('B untouched: done sessions, with their days', [K[0], K[1]].every((k) => JSON.stringify(b0.get(k)) === JSON.stringify(a0.get(k))), true);
  check('B skipped stays skipped; manually moved stays "moved" (Sat 2 Jan, from Fri 1 Jan)', `${a0.get(K[16]).status}|${a0.get(K[14]).moved}|${a0.get(K[14]).date}|${a0.get(K[14]).orig}`, 'skipped|true|2027-01-02|2027-01-01');
  const pAfter = await ev((id) => T.plan(id), P);
  check('B end date extended by 4 weeks; plan still valid; workouts untouched', `${before.endDate}→${pAfter.endDate}|${await ev((id) => planProblems(findPlan(state, id)).length, P)}|${await ev(() => JSON.stringify(state.workouts)) === workoutsBefore}`, '2026-12-25→2027-01-22|0|true');
  check('B shift recorded for undo', `${pAfter.shifts.length}|${pAfter.shifts[0].weeks}|${Object.keys(pAfter.shifts[0].prev.sessions).length}|${pAfter.shifts[0].prev.endDate}`, `1|4|${expectMove.length}|2026-12-25`);
  /* Existing views follow the new dates */
  let pr = await ev((id) => planProgress(findPlan(state, id)), P);
  check('B status counts and week: no missed now, Week 1 of 8 (the week being resumed)', `${pr.missed}|${pr.completed}|${pr.week}|${pr.weeks}`, '0|2|1|8');
  await ev(() => { ui.tab = 'plans'; render(); }); await wait();
  let t = await view();
  check('B Plans card: Week 1 of 8, picked-up session on Fri 4 Dec, move noted with Undo', `${t.includes('Week 1 of 8')}|${t.includes('Fri, 4 Dec') || t.includes('Fri 4 Dec')}|${t.includes('Moved 4 weeks later')}|${!!(await page.$('[data-action=break-undo]'))}`, 'true|true|true|true');
  check('B no break prompt once nothing is missed', !!(await page.$('[data-action=break-open]')), false);
  await page.clock.setFixedTime(new Date('2026-12-04T09:00:00+01:00')); await ev(() => render()); await go(page, 'home'); await wait();
  check('B Today on the new day shows the picked-up session', (await view()).includes('Today: Full Body'), true);
  await page.clock.setFixedTime(TODAY);

  /* C. Undo restores exactly */
  await ev((id) => { undoShift(state, id); save(); }, P);
  const undone = await ev((id) => T.plan(id), P);
  check('C undo: plan exactly as before (dates, end date, overrides incl. statuses), workouts untouched', `${JSON.stringify(undone) === JSON.stringify(before)}|${await ev(() => JSON.stringify(state.workouts)) === workoutsBefore}`, 'true|true');
  // Undo after changes since
  await ev((id) => { applyShift(state, previewShift(state, id, {})); save(); }, P);
  const k5 = await ev((id) => planSessions(findPlan(state, id))[5].key, P);
  await ev(([id, k]) => { skipSession(state, id, k); save(); }, [P, k5]);
  await ev(() => { ui.tab = 'plans'; render(); }); await wait();
  dialogs = []; answer = false;
  await page.click('[data-action=break-undo]'); await wait();
  check('C undo after changes: says what will be undone; Cancel changes nothing', `${dialogs[0] || ''}|${(await ev((id) => T.plan(id), P)).shifts.length}`, (v) => v.includes('1 moved session changed since (moved, skipped or done); it goes back as it was before the move. Your workouts stay as they are.') && v.endsWith('|1'));
  answer = true;
  await page.click('[data-action=break-undo]'); await wait();
  check('C undo confirmed: exactly the data from before the move', JSON.stringify(await ev((id) => T.plan(id), P)) === JSON.stringify(before), true);
  check('C nothing left to undo', await ev((id) => undoShift(state, id).error, P), 'There is no move to undo.');

  /* D. Choosing a later pick-up session */
  pv = await ev(([id, k]) => { const p = previewShift(state, id, { pickupKey: k }); return { ok: p.ok, pickup: p.pickup.key, needed: p.needed, first: p.items[0].moving[0].key, left: p.items[0].leftMissed.map((s) => s.key) }; }, [P, K[5]]);
  check('D later pick-up: moves from there; earlier missed sessions stay missed', `${pv.ok}|${pv.pickup}|${pv.first}|${pv.left.join(',')}|${pv.needed}`, `true|${K[5]}|${K[5]}|${K.slice(2, 5).join(',')}|2`);
  await ev(() => { ui.tab = 'plans'; render(); }); await wait();
  await page.click('[data-action=break-open]'); await wait();
  await page.selectOption('#brk-pickup', K[5]); await wait();
  t = await sheet();
  check('D sheet: preview lists pick-up, sessions moving, new end date, sessions staying missed', ['Picking up from', 'Moving', 'Plan now ends', '(was ', 'Stay as missed', '3 sessions'].map((x) => t.includes(x)).join(','), 'true,true,true,true,true,true');
  check('D weeks offered: 2 to 8', JSON.stringify(await page.$$eval('#brk-weeks option', (x) => x.map((e) => e.value))), JSON.stringify(['2', '3', '4', '5', '6', '7', '8']));
  check('D sheet fits the screen', await noOverflow(), true);
  await page.click('#sheet [data-action=close-sheet] >> nth=0'); await wait();
  check('D cancel: nothing changed', JSON.stringify(await ev((id) => T.plan(id), P)) === JSON.stringify(before), true);
  await page.clock.setFixedTime(new Date('2027-01-20T09:00:00+01:00'));
  const P9 = await ev(() => { const id = T.strength('2026-11-02', 12); const k = T.keys(id); T.link(id, k[0]); T.link(id, k[1]); return id; });
  check('D break longer than 8 weeks: refused with advice', await ev((id) => previewShift(state, id, {}).error, P9), (v) => typeof v === 'string' && v.includes('longer than 8 weeks'));
  await ev((id) => { deletePlan(state, id); save(); }, P9);
  await page.clock.setFixedTime(TODAY);

  /* E. Strength + sport: conflicts and moving both */
  await reset();
  P = await ev(() => T.strength('2026-11-02', 4));
  K = await ev((id) => T.keys(id), P);
  await ev(([id, k]) => { T.link(id, k[0]); T.link(id, k[1]); }, [P, K]);
  const S = await ev(() => T.swim({ goal: 'fitness', weeks: 8, poolLen: 25, poolUnit: 'm', contDist: 400, sessionsPerWeek: 2, weeklyDist: 2000, days: [0, 3], experience: 'some', limitation: 'none' }, '2026-11-30'));
  const swimBefore = await ev((id) => T.plan(id), S);
  pv = await ev((id) => { const p = previewShift(state, id, {}); return { ok: p.ok, conflicts: p.conflicts.map((c) => c.date), other: p.other && p.other.id, movable: p.otherMovable }; }, P);
  check('E strength shift into the swim plan\'s weeks: same-day conflicts listed (Mondays)', `${pv.ok}|${pv.conflicts.length > 0}|${pv.conflicts.every((d) => new Date(`${d}T12:00`).getDay() === 1)}|${pv.other === S}|${pv.movable}`, 'true|true|true|true|true');
  await ev(() => { ui.tab = 'plans'; render(); }); await wait();
  await page.click('[data-action=break-open] >> nth=0'); await wait();
  t = await sheet();
  check('E sheet: exact conflicting dates and the "Also move" option (off)', `${t.includes('Same day as your other plan:')}|${t.includes('Also move “Swim plan” by the same 3 weeks')}|${await page.getAttribute('[data-action=break-also]', 'aria-checked')}|${t.includes('Also moving')}`, 'true|true|false|false');
  await page.click('[data-action=break-also]'); await wait();
  t = await sheet();
  check('E "Also move" on: both plans previewed before confirming', `${t.includes('Also moving “Swim plan”')}|${(t.match(/Plan now ends/g) || []).length}`, 'true|2');
  check('E nothing moved yet', JSON.stringify(await ev((id) => T.plan(id), S)) === JSON.stringify(swimBefore), true);
  await page.click('[data-action=break-also]'); await wait();
  await page.click('[data-action=break-apply]'); await wait();
  check('E confirmed without "Also move": swim plan not moved', JSON.stringify(await ev((id) => T.plan(id), S)) === JSON.stringify(swimBefore), true);
  await ev((id) => { undoShift(state, id); save(); }, P);
  await ev((id) => { applyShift(state, previewShift(state, id, { alsoOther: true })); save(); }, P);
  const sAfter = await ev((id) => T.st(id), S);
  const sPlan = await ev((id) => T.plan(id), S);
  check('E with "Also move": swim sessions 3 weeks later, weekdays kept, linked as a pair', `${sAfter.every((s) => s.date === s.orig)}|${new Date(`${sAfter[0].date}T12:00`).getDay()}|${sAfter[0].date}|${!!sPlan.shifts[0].pair}`, 'true|1|2026-12-21|true');
  check('E no same-day conflicts left after moving both', await ev(() => planConflicts(state).length), 0);
  await ev(() => { ui.tab = 'plans'; render(); }); await wait();
  const swimWeek = await ev((id) => { const p = findPlan(state, id); const pr = planProgress(p); const n = Math.max(1, Math.min(pr.week || 1, p.weeks.length)); const w = p.weeks[n - 1]; return { week: n, text: `${swimText(0, p.summary?.pool)} of ${swimText(w.m || 0, p.summary?.pool)}` }; }, S);
  check('E swim card after the move: its first week, week total from that week', `${swimWeek.week}|${(await view()).toLowerCase().includes(swimWeek.text.toLowerCase())}|${sPlan.startDate}|${(await view()).includes('Starts Mon, 21 Dec') || (await view()).includes('Starts Mon 21 Dec')}`, '1|true|2026-12-21|true');
  // Moving the swim plan on its own later blocks the paired undo
  check('E undo of the pair restores both exactly', await ev(([p, s, sb]) => { const r = undoShift(state, p); return `${r.ok}|${JSON.stringify(T.plan(s)) === JSON.stringify(sb)}`; }, [P, S, swimBefore]), 'true|true');
  // Event plan as the other plan: can't be moved along
  await reset();
  P = await ev(() => T.strength('2026-11-02', 4));
  K = await ev((id) => T.keys(id), P);
  await ev(([id, k]) => { T.link(id, k[0]); T.link(id, k[1]); }, [P, K]);
  await ev(() => T.swim({ goal: 'event', targetDist: 1500, eventDate: '2027-02-14', poolLen: 25, poolUnit: 'm', contDist: 800, sessionsPerWeek: 2, weeklyDist: 3000, days: [0, 3], experience: 'some', limitation: 'none' }, '2026-11-30'));
  pv = await ev((id) => { const p = previewShift(state, id, { alsoOther: true }); return `${p.ok}|${p.otherMovable}|${p.otherReason}|${p.items.length}`; }, P);
  check('E other plan has an event: never moved along, reason given', pv, 'true|false|“Swim plan” has an event date, so it can\'t be moved.|1');

  /* F. Finished plan: not brought back while another plan of its group runs */
  await reset();
  P = await ev(() => T.strength('2026-10-05', 4)); // ended 30 Oct
  K = await ev((id) => T.keys(id), P);
  await ev(([id, k]) => { T.link(id, k[0]); T.link(id, k[1]); }, [P, K]);
  await page.clock.setFixedTime(new Date('2026-11-03T09:00:00+01:00'));
  const P2 = await ev(() => T.strength('2026-11-02', 6, [1, 3, 5]));
  check('F finished plan + another strength program running: blocked', await ev((id) => previewShift(state, id, { weeks: 5 }).error, P), (v) => typeof v === 'string' && v.includes('is running. Stop it first: one strength program at a time.'));
  await ev((id) => { deletePlan(state, id); save(); }, P2);
  pv = await ev((id) => { const p = previewShift(state, id, { weeks: 5 }); const r = applyShift(state, p); return `${r.ok}|${planPhase(findPlan(state, id))}`; }, P);
  check('F finished plan alone: can be picked up again (active again)', pv, 'true|active');
  await page.clock.setFixedTime(TODAY);

  /* G. Event plans: never rescheduled */
  await reset();
  await page.clock.setFixedTime(new Date('2026-10-12T09:00:00+02:00'));
  const E = await ev(() => T.swim({ goal: 'event', targetDist: 1500, eventDate: '2026-12-06', poolLen: 25, poolUnit: 'm', contDist: 800, sessionsPerWeek: 3, weeklyDist: 4000, days: [0, 2, 4], experience: 'some', limitation: 'none' }, '2026-10-12'));
  await page.clock.setFixedTime(TODAY);
  const EK = await ev((id) => T.keys(id), E);
  await ev(([id, k]) => { for (let i = 0; i < 6; i++) T.link(id, k[i], `e${i}`); }, [E, EK]);
  const eBefore = await ev((id) => T.plan(id), E);
  o = await ev((id) => { const x = breakOptions(state, id); return `${x.event}|${x.eventDate}|${x.missed.length >= 2}`; }, E);
  check('G event plan detected (event date in its setup answers)', o, 'true|2026-12-06|true');
  check('G detection also from the race/event session alone', await ev((id) => { const p = T.plan(id); delete p.answers.eventDate; return `${isEventPlan(p)}|${planEventDate(p)}`; }, E), 'true|2026-12-06');
  check('G and from an event date alone; plain plans are not event plans', await ev(() => `${isEventPlan({ answers: { eventDate: '2027-01-10' }, weeks: [{ sessions: [] }] })}|${isEventPlan(createPlan(PLAN_LIBRARY.get('full-body-3'), { days: [0, 2, 4], weeks: 4, deload: 4 }, '2026-11-02').plan)}`), 'true|false');
  check('G a shift is refused for event plans', await ev((id) => previewShift(state, id, {}).error, E), (v) => v.includes('event can\'t move'));
  await ev(() => { ui.tab = 'plans'; render(); }); await wait();
  check('G card prompt', (await view()).includes('Missed a few sessions? What to do now'), true);
  await page.click('[data-action=break-open]'); await wait();
  t = await sheet();
  check('G sheet explains: date can\'t move, taper, don\'t make up sessions', `${t.includes("Your event date can't move (Sun, 6 Dec)") || t.includes("Your event date can't move (Sun 6 Dec)")}|${t.includes('Moving sessions later would cut into your taper.')}|${t.includes("Don't try to make up missed sessions")}`, 'true|true|true');
  check('G near-event warning (11 days)', t.includes('Your event is in 11 days. Consider a shorter event or a later date if the missed time was long.'), true);
  check('G taper warning when the next session is in the taper', `${await ev((id) => { const p = findPlan(state, id); const n = sessionStatuses(p, state).filter((s) => s.date >= todayKey()).sort((a, b) => (a.date < b.date ? -1 : 1))[0]; return p.weeks.some((w) => w.taper && w.sessions.some((s) => s.key === n.key)); }, E)}|${t.includes("You're in the taper. Missed training can't be made up now; keep the remaining sessions easy.")}`, (v) => v === 'true|true' || v === 'false|false');
  check('G event sheet fits the screen', await noOverflow(), true);
  await page.click('[data-action=break-continue]'); await wait();
  check('G Continue from This Week: no schedule change; prompt hidden', `${JSON.stringify(await ev((id) => T.plan(id), E)) === JSON.stringify(eBefore)}|${!!(await page.$('[data-action=break-open]'))}`, 'true|false');
  await ev(() => { ui.breakDismissed = {}; render(); }); await wait();
  await page.click('[data-action=break-open]'); await wait();
  const missedKeys = await ev((id) => breakOptions(state, id).missed.map((s) => s.key), E);
  await page.click(`[data-action=break-skip-pick][data-id="${missedKeys[0]}"]`); await wait();
  dialogs = []; answer = false;
  await page.click('[data-action=break-skip]'); await wait();
  check('G Skip asks first; Cancel changes nothing', `${dialogs[0] || ''}|${JSON.stringify(await ev((id) => T.plan(id), E)) === JSON.stringify(eBefore)}`, (v) => v.startsWith(`Mark ${missedKeys.length - 1} missed session`) && v.endsWith('|true'));
  answer = true;
  await page.click('[data-action=break-skip]'); await wait();
  const est = await ev((id) => T.st(id), E);
  const sb = byKey(est);
  check('G confirmed: only the selected missed sessions skipped, on their days; the unselected one stays missed', `${missedKeys.slice(1).every((k) => sb.get(k).status === 'skipped' && !sb.get(k).moved)}|${sb.get(missedKeys[0]).status}|${(await ev((id) => T.plan(id), E)).endDate === eBefore.endDate}`, 'true|missed|true');

  /* H. Backups before and after a shift (current code and the real v31 code) */
  await reset();
  P = await ev(() => T.strength());
  K = await ev((id) => T.keys(id), P);
  await ev(([id, k]) => { T.link(id, k[0]); T.link(id, k[1]); }, [P, K]);
  const backupBefore = await ev(() => buildBackup());
  await ev((id) => { applyShift(state, previewShift(state, id, {})); save(); }, P);
  const backupAfter = await ev(() => buildBackup());
  const shifted = await ev((id) => T.plan(id), P);
  let r = await ev((b) => { const v = validateBackup(b); const s = restoredState(v, state, { source: 'file' }); return { ok: v.ok, same: JSON.stringify(s.plans) === JSON.stringify(state.plans), wk: JSON.stringify(s.workouts) === JSON.stringify(state.workouts) }; }, backupAfter);
  check('H backup after a shift: same format, validates and restores exactly (incl. undo record)', `${backupAfter.format}|${r.ok}|${r.same}|${r.wk}`, '2|true|true|true');
  r = await ev((b) => { const v = validateBackup(b); const rep = reconcilePlans(v.state).report; const s = restoredState(v, state, { source: 'file' }); return { ok: v.ok, end: s.plans[0].endDate, shifts: !!s.plans[0].shifts, links: s.workouts.filter((w) => w.plan).length, rep: rep.removedLinks + rep.duplicateLinks + rep.droppedChanges }; }, backupBefore);
  check('H backup from before the shift: restores the old schedule, links intact', `${r.ok}|${r.end}|${r.shifts}|${r.links}|${r.rep}`, 'true|2026-12-25|false|2|0');
  // Restore that older backup, then undo state is consistent (nothing to undo)
  await ev((b) => { const v = validateBackup(b); state = restoredState(v, state, { source: 'file' }); save(); }, backupBefore);
  check('H after restoring the older backup: nothing to undo, offered again', `${await ev((id) => undoShift(state, id).error, P)}|${!!(await ev((id) => breakOptions(state, id), P))}`, 'There is no move to undo.|true');
  // Restore the shifted backup, undo still exact
  await ev((b) => { const v = validateBackup(b); state = restoredState(v, state, { source: 'file' }); save(); }, backupAfter);
  check('H after restoring the shifted backup: undo restores the pre-shift plan exactly', await ev(([id, pb]) => { undoShift(state, id); const p = findPlan(state, id); const orig = pb.data.plans[0]; return JSON.stringify(p) === JSON.stringify(orig); }, [P, backupBefore]), true);
  // The real v31 app reads the shifted backup
  const site = path.join(os.tmpdir(), `v31-site-${scheme}-${width}`);
  fs.rmSync(site, { recursive: true, force: true }); fs.mkdirSync(site, { recursive: true });
  execSync(`git -C "${path.join(__dirname, '..', '..')}" archive ${V31} training-tracker | tar -x -C "${site}"`);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), site, String(OLD_PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up(OLD_PORT)); i++) await new Promise((res) => setTimeout(res, 100));
  try {
    const old = await ctx.newPage();
    old.on('pageerror', (e) => errors.push(`v31: ${e.message}`));
    await old.clock.setFixedTime(TODAY);
    await old.goto(`http://localhost:${OLD_PORT}/training-tracker/`);
    r = await old.evaluate((b) => { const v = validateBackup(b); if (!v.ok) return { ok: false, err: v.errors }; const s = restoredState(v, state, { source: 'file' }); const p = s.plans[0];
      const st = sessionStatuses(p, s); return { ok: true, cache: typeof BACKUP_FORMAT, end: p.endDate, missed: st.filter((x) => x.status === 'missed').length, done: st.filter((x) => x.status === 'completed').length, week: planProgress(p, s).week, probs: planProblems(p).length }; }, backupAfter);
    check('H real v31 app restores a shifted backup: same end date, statuses and week', `${r.ok}|${r.end}|${r.missed}|${r.done}|${r.week}|${r.probs}`, `true|${shifted.endDate}|0|2|1|0`);
    await old.close();
  } finally { server.kill(); }

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
