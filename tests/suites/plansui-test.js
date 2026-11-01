// Plans tab redesign: plan cards, next workout, progress, rows, catalogue, full schedule, session sheet.
// Usage: node plansui-test.js <light|dark> <width>
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
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#view *, #sheet *')].every((el) => el.offsetParent === null || el.closest('svg') || el.getBoundingClientRect().right <= window.innerWidth + 1));
  const reset = () => ev(() => { localStorage.clear(); state = defaultState(); ui.planCatalog = false; ui.schedPast = {}; ui.breakDismissed = {}; save(); closeSheet(); ui.tab = 'plans'; render(); });
  await ev(() => {
    window.P = {
      strength(start = '2026-11-09', weeks = 8) { const p = createPlan(PLAN_LIBRARY.get('full-body-3'), { days: [0, 2, 4], weeks, deload: 4 }, start).plan; resolveProgramExercises(p, state); state.plans.push(p); save(); return p.id; },
      ride(start = '2026-11-25') { const a = { goal: 'fitness', weeks: 8, weeklyMin: 150, ridesPerWeek: 3, longestMin: 60, days: [1, 3, 5], experience: 'some' }; const r = createPlan(PLAN_LIBRARY.get('bike'), a, start, { name: 'Cycling plan' }); if (!r.ok) throw new Error(r.errors.join(' ')); resolveProgramExercises(r.plan, state); state.plans.push(r.plan); save(); return r.plan.id; },
      link(id, key) { const p = findPlan(state, id); const s = findSession(p, key); state.workouts.push({ id: `w-${key}`, name: s.title, notes: '', start: `${s.date}T08:00:00`, end: `${s.date}T09:00:00`, plan: { planId: id, sessionKey: key }, entries: [{ exerciseId: state.exercises[0].id, sets: [{ weight: 50, reps: 5, done: true }] }] }); save(); },
      keys(id) { return planSessions(findPlan(state, id)).map((s) => s.key); }
    };
  });
  const card = (i = 0) => page.$$eval('.plan-card', (c, i) => (c[i] ? c[i].innerText.replace(/\s+/g, ' ') : null), i);

  /* A. No active plans */
  await reset();
  let v = await view();
  check('A no plans: no "Your plans", full catalogue (strength and sport)', `${/your plans/i.test(v)}|${await page.$$eval('[data-action=plan-setup]', (x) => x.length)}|${!!(await page.$('[data-action=swim-setup]'))}|${!!(await page.$('[data-action=plan-catalog]'))}`, 'false|2|true|false');

  /* B. One active plan (strength): header, progress, next workout, rows */
  await reset();
  const S = await ev(() => P.strength());
  const K = await ev((id) => P.keys(id), S);
  await ev(([id, k]) => { P.link(id, k[0]); P.link(id, k[1]); P.link(id, k[3]); skipSession(state, id, k[4]); moveSession(state, id, k[8], '2026-11-28'); save(); render(); }, [S, K]);
  await wait();
  let c = await card();
  check('B header: type tag once, name, week and end', `${await page.$$eval('.plan-card .sport-tag', (t) => t.map((x) => x.textContent).join(','))}|${c.includes('Full Body 3×/week')}|${c.includes('Week 3 of 8 · ends Fri, 1 Jan')}`, 'Strength|true|true');
  check('B progress: "3 of 24 completed", missed and skipped apart', `${c.includes('3 of 24 completed')}|${c.includes('3 missed')}|${c.includes('1 skipped')}`, 'true|true|true');
  r = await ev(() => { const s = [...document.querySelectorAll('.plan-card .plan-bar span')].map((x) => parseFloat(x.style.width).toFixed(1)); return s.join(','); });
  check('B bar segments: completed 3, missed 3, skipped 1 of 24 (missed/skipped never counted as completed)', r, [3, 3, 1].map((n) => (n / 24 * 100).toFixed(1)).join(','));
  check('B bar has a text alternative', await page.getAttribute('.plan-card .plan-bar', 'aria-label'), '3 of 24 sessions completed, 3 missed, 1 skipped');
  check('B next workout: today\'s session, with the Today tab\'s label', `${c.includes('Today · Wed, 25 Nov')}|${await page.innerText('.plan-next [data-action=review]')}`, "true|Start Today's Workout");
  check('B missed sessions are never the next workout; shown separately', `${await ev(() => document.querySelector('.plan-next').className.includes('missed'))}|${c.includes('Missed a few sessions?')}`, 'false|true');
  const rows = await page.$$eval('.plan-card .plan-sess', (r) => r.map((x) => `${x.querySelector('.plan-sess-title').textContent}|${x.querySelector('.pstatus')?.textContent || ''}|${x.querySelector('.plan-day').textContent}`));
  check('B this week: missed and today marked; upcoming without a marker; moved noted', JSON.stringify(rows), JSON.stringify(['Full Body A|Missed|Mon, 23 Nov', 'Full Body B|Today|Wed, 25 Nov', 'Full Body A||Sat, 28 Nov · moved from Fri, 27 Nov']));
  check('B other strength programs hidden while one runs; Browse all plans offered; sport catalogue shown', `${await page.$$eval('[data-action=plan-setup]', (x) => x.length)}|${!!(await page.$('[data-action=plan-catalog]'))}|${!!(await page.$('[data-action=ride-setup]'))}`, '0|true|true');
  await page.click('[data-action=plan-catalog]'); await wait();
  check('B Browse all plans shows them (disabled) and can be hidden again', `${await page.isDisabled('[data-action=plan-setup] >> nth=0')}|${(await view()).includes('One strength program at a time')}`, 'true|true');
  await page.click('[data-action=plan-catalog]'); await wait();
  check('B layout fits', await noOverflow(), true);
  // Start uses the review flow
  await page.click('.plan-next [data-action=review]'); await wait();
  check('B Start opens the review; nothing starts before Begin', `${!!(await page.$('#sheet [data-action=begin]'))}|${await ev(() => state.active)}`, 'true|null');
  await page.click('#sheet [data-action=begin]'); await wait(300);
  await ev(() => { ui.tab = 'plans'; render(); }); await wait();
  c = await card();
  check('B in progress first: Continue Workout in the next block, row marked', `${c.includes('In progress')}|${await page.innerText('.plan-next [data-action=continue-workout]')}|${await page.$$eval('.plan-card .pstatus', (x) => x.map((e) => e.textContent).join(','))}`, (x) => x.startsWith('true|Continue Workout|') && x.includes('In progress'));
  await ev(() => { state.active = null; save(); render(); });
  // Next upcoming when nothing today
  await ev(([id, k]) => { skipSession(state, id, k[7]); save(); render(); }, [S, K]);
  await wait();
  c = await card();
  check('B nothing open today: the next upcoming session, with View Session', `${c.includes('Next · Sat, 28 Nov')}|${(await page.innerText('.plan-next')).includes('View Session')}`, 'true|true');
  await page.click('.plan-next [data-action=plan-session]'); await wait();
  check('B View Session opens its session sheet', (await sheet()).includes('Start Workout'), true);
  await ev(() => closeSheet());

  /* C. Two active plans, same-day clash, order */
  const R = await ev(() => P.ride());
  await ev(() => render()); await wait();
  check('C two plans: two cards in the existing order (strength started first)', JSON.stringify(await page.$$eval('.plan-card .plan-name', (n) => n.map((x) => x.textContent.trim()))), JSON.stringify(['Strength Full Body 3×/week', 'Ride Cycling plan']));
  const c0 = await card(0), c1 = await card(1);
  check('C same-day clash shown in both cards and on the rows', `${c0.includes('Same day as your other plan: Sat, 28 Nov')}|${c1.includes('Same day as your other plan: Sat, 28 Nov')}|${/also Long ride/.test(c0)}|${/also Full Body A/.test(c1)}`, 'true|true|true|true');
  check('C both slots taken: one "Start a plan" line, no catalogue', `${(await view()).includes('A strength program and a sport plan are running')}|${await page.$$eval('[data-action=plan-setup], [data-action=run-setup], [data-action=swim-setup], [data-action=ride-setup]', (x) => x.length)}`, 'true|0');
  check('C sport card: its own type, next ride with length, week totals', `${/^ride cycling plan/i.test(c1)}|${/Next · Thu, 26 Nov Endurance ride \d+ min/.test(c1)}|${/This week · Week 1 · Build · 0 min of 2 h 30 min/.test(c1)}`, 'true|true|true');
  check('C two cards fit', await noOverflow(), true);
  // Menu
  await page.click('.plan-card [data-action=plan-menu] >> nth=0'); await wait();
  let t = await sheet();
  // Today's session was skipped above, which ends the missed run, so "Back from a break" isn't offered now
  check('C ••• menu: full schedule and stop; back from a break only when it applies', `${t.includes('Full schedule')}|${t.includes('Back from a break')}|${t.includes('Stop Program')}|${await ev((id) => !!breakOptions(state, id), S)}`, 'true|false|true|false');
  await ev(() => closeSheet());

  /* D. Full schedule */
  await page.click('.plan-card [data-action=plan-open] >> nth=0'); await wait();
  t = await sheet();
  check('D opens at the current week; earlier weeks folded with counts and an obvious way to open them', `${t.includes('Show earlier weeks · Weeks 1–2')}|${t.includes('3 completed · 2 missed · 1 skipped · tap to see every session')}|${await page.getAttribute('[data-action=sched-past]', 'aria-expanded')}|${t.includes('Week 3 This week') || /Week 3\s*This week/i.test(t)}|${!!(await page.$(`#sheet .plan-sess[data-id="${S}|${K[0]}"]`))}`, 'true|true|false|true|false');
  check('D schedule progress uses the same completed/missed/skipped wording', t.includes('3 of 24 completed'), true);
  await page.click('[data-action=sched-past]'); await wait();
  t = await sheet();
  check('D expanded: every earlier session is there; can be folded again', `${t.includes('Hide earlier weeks')}|${t.includes('Mon, 9 Nov')}|${t.includes('Wed, 18 Nov')}|${await page.getAttribute('[data-action=sched-past]', 'aria-expanded')}`, 'true|true|true|true');
  check('D week headings in normal case', await ev(() => getComputedStyle(document.querySelector('.sched-week')).textTransform), 'none');
  check('D stop and delete still there', `${!!(await page.$('#sheet [data-action=plan-stop]'))}|${!!(await page.$('#sheet [data-action=plan-delete]'))}`, 'true|true');
  check('D schedule fits', await noOverflow(), true);
  // Session sheet: actions first
  await page.click(`#sheet .plan-sess[data-id="${S}|${K[2]}"]`); await wait();
  r = await ev(() => { const b = document.querySelector('#sheet .sheet-body'); const a = b.querySelector('.btn-col'), d = b.querySelector('.review-list, .plan-objective'); return { order: !!(a.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING), btns: [...a.querySelectorAll('button')].map((x) => x.textContent.trim()) }; });
  check('E session sheet: actions (same ones) come before the session details', `${r.order}|${r.btns.join(',')}`, 'true|Start Workout,Skip Session,Mark as Done (no workout logged)');
  t = await sheet();
  check('E move section above the details too', t.indexOf('Move to another day'.toUpperCase()) >= 0 || t.indexOf('Move to another day') >= 0, true);
  check('E session sheet fits', await noOverflow(), true);
  await ev(() => closeSheet());

  /* F. Event plan and past plans */
  await reset();
  await page.clock.setFixedTime(new Date('2026-10-12T09:00:00+02:00'));
  const E = await ev(() => { const a = { goal: 'event', targetDist: 1500, eventDate: '2026-12-06', poolLen: 25, poolUnit: 'm', contDist: 800, sessionsPerWeek: 3, weeklyDist: 4000, days: [0, 2, 4], experience: 'some', limitation: 'none' };
    const p = createPlan(PLAN_LIBRARY.get('swim'), a, '2026-10-12', { name: 'Swim · event' }).plan; resolveProgramExercises(p, state); state.plans.push(p); save(); return p.id; });
  await page.clock.setFixedTime(new Date('2026-11-25T09:00:00+01:00'));
  await ev(() => render()); await wait();
  c = await card();
  check('F event plan: type tag, event date and days left in the header', `${/^swim swim · event/i.test(c)}|${c.includes('Event Sun, 6 Dec · in 11 days')}`, 'true|true');
  check('F event plan: next workout never a missed session', `${c.includes('Today · Wed, 25 Nov')}|${(await page.innerText('.plan-next [data-action=review]')).startsWith('Start ')}`, 'true|true');
  await ev((id) => { stopPlan(state, id); save(); render(); }, E); await wait();
  v = await view();
  check('F stopped plan: card gone, listed under Past plans and still opens', `${await page.$$eval('.plan-card', (x) => x.length)}|${/past plans/i.test(v)}|${!!(await page.$('[data-action=plan-open]'))}`, '0|true|true');
  await page.click('[data-action=plan-open]'); await wait();
  t = await sheet();
  check('F past plan schedule: every week shown (nothing folded)', `${!!(await page.$('[data-action=sched-past]'))}|${t.includes('Mon, 12 Oct')}`, 'false|true');
  await ev(() => closeSheet());

  /* G. Today tab and Plans tab agree */
  await reset();
  const S2 = await ev(() => P.strength('2026-11-23', 4));
  await go(page, 'home'); await wait();
  const homeLabel = await page.innerText('#view .hero-btn');
  await go(page, 'plans'); await wait();
  check('G same start label on Today and in Plans', `${homeLabel}|${await page.innerText('.plan-next [data-action=review]')}`, "Start Today's Workout|Start Today's Workout");
  check('G both open the same review', `${await page.getAttribute('.plan-next [data-action=review]', 'data-id')}`, await ev((id) => `${id}|${todaysPlannedSessions()[0].session.key}`, S2));
  check('G layout fits', await noOverflow(), true);

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
var r;
