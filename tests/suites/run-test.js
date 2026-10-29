// Running plans (5K/10K): fitness estimate and paces, missing/inconsistent answers, goal checks,
// schedule rules across many runners (progression, recovery, long-run share, taper, race week),
// setup → review → start, snapshot, sessions in the logger, planned vs actual, conflicts with a
// strength program, backup/restore. Usage: node run-test.js <outDir> <light|dark>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.argv[2] || '.'), scheme = process.argv[3] || 'light';
const DIR = `${OUT}/backup-files/run-${scheme}`;
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got).slice(0, 500)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.clock.setFixedTime(new Date('2026-11-10T09:00:00+01:00')); // Tuesday
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 250) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const st = () => ev((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const view = () => page.innerText('#view');
  const sheet = async () => (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#view *, #sheet *')].every((el) => el.offsetParent === null || el.closest('svg') || el.getBoundingClientRect().right <= window.innerWidth + 1));
  const assess = (a, start = '2026-11-10') => ev(([a, s]) => assessRun(a, s), [a, start]);
  const base = { distance: '5k', weeks: 8, days: [1, 3, 5, 6], longDay: 6, experience: 'some', limitation: 'none', weeklyKm: 15, runsPerWeek: 3, longestKm: 7 };

  /* A. Fitness estimate and paces */
  let as = await assess({ ...base, recent: { distanceM: 5000, timeSec: 1500, ago: 'month' } });
  check('A 5K 25:00 → 10K by Riegel (25:00 × 2^1.06 ≈ 52:07)', `${as.fitness.source}|${as.fitness.confidence}|${as.fitness.est['5k']}|${as.fitness.est['10k']}`, 'result|good|1500|3127');
  check('A paces from 5K pace 5:00/km: easy 6:06–6:51, long 6:15–7:00, tempo 5:18–5:30, 5K reps 4:54–5:06',
    ['easy', 'long', 'tempo', 'i5k'].map((k) => as.fitness.paces[k].join('-')).join(' '), '366-411 375-420 318-330 294-306');
  check('A pace order: easy slower than tempo slower than intervals', as.fitness.paces.easy[0] > as.fitness.paces.tempo[1] && as.fitness.paces.tempo[0] > as.fitness.paces.i5k[1], true);
  as = await assess({ ...base, distance: '10k', recent: { distanceM: 10000, timeSec: 3000, ago: 'month' } });
  check('A 10K 50:00 → 5K ≈ 23:59; 10K-pace reps from 10K pace', `${as.fitness.est['5k']}|${as.fitness.paces.i10k.join('-')}`, '1439|297-306');
  as = await assess({ ...base, recent: { distanceM: 5000, timeSec: 1500, ago: 'half' } });
  check('A 3–6-month-old result: 3% slower, confidence fair, said so', `${as.fitness.est['5k']}|${as.fitness.confidence}|${as.notes.some((n) => n.includes('3–6 months'))}`, '1545|fair|true');
  as = await assess({ ...base, recent: { distanceM: 5000, timeSec: 1500, ago: 'older' } });
  check('A result older than 6 months: not used, effort-based', `${as.fitness.source}|${as.fitness.paces}|${as.notes.some((n) => n.includes('more than 6 months'))}`, 'none|null|true');
  as = await assess({ ...base, recent: { distanceM: 21097, timeSec: 2 * 3600, ago: 'month' } });
  check('A half-marathon result converts with fair confidence and a note', `${as.fitness.confidence}|${as.notes.some((n) => n.includes('less reliable'))}`, 'fair|true');
  as = await assess({ ...base });
  check('A no result: effort-based, no paces, says so', `${as.ok}|${as.fitness.source}|${as.fitness.paces}|${as.notes.some((n) => n.includes('effort-based'))}`, 'true|none|null|true');
  check('A target time never changes paces', JSON.stringify((await assess({ ...base, recent: { distanceM: 5000, timeSec: 1500, ago: 'month' }, targetSec: 1200 })).fitness.paces) === JSON.stringify((await assess({ ...base, recent: { distanceM: 5000, timeSec: 1500, ago: 'month' } })).fitness.paces), true);
  check('A heart-rate zones only with a measured max', `${(await assess({ ...base })).fitness.hr}|${JSON.stringify((await assess({ ...base, maxHr: 190 })).fitness.hr.easy)}|${(await assess({ ...base, maxHr: 300 })).warnings.some((w) => w.includes('Maximum heart rate ignored'))}`, 'null|[124,148]|true');

  /* B. Missing and inconsistent answers */
  as = await assess({ distance: '5k', weeks: 8, days: [1, 3, 6] });
  check('B nothing about current training: conservative assumptions, labelled', `${as.ok}|${as.base.experience}|${as.base.weeklyKm}|${as.assumptions.length}|${as.assumptions.some((m) => m.includes('assumed no regular running'))}`, 'true|new|0|2|true');
  as = await assess({ ...base, weeklyKm: null, runsPerWeek: 4, longestKm: 8 });
  check('B partial: weekly distance estimated from the other answers and labelled', `${as.ok}|${as.base.weeklyKm > 8}|${as.assumptions.some((m) => m.includes('Weekly distance not given'))}`, 'true|true|true');
  const probs = async (a, start) => (await assess(a, start)).problems.join(' ');
  check('B longest run longer than the week', await probs({ ...base, weeklyKm: 10, longestKm: 15 }), (v) => v.includes('longer than your weekly distance'));
  check('B longest run shorter than the average run', await probs({ ...base, weeklyKm: 30, runsPerWeek: 3, longestKm: 6 }), (v) => v.includes('shorter than your average run'));
  check('B 0 runs but a weekly distance', await probs({ ...base, runsPerWeek: 0 }), (v) => v.includes('0 runs a week'));
  check('B fewer than 2 running days', await probs({ ...base, days: [6] }), (v) => v.includes('at least 2 days'));
  check('B neither race date nor length', await probs({ ...base, weeks: null }), (v) => v.includes('race date or a plan length'));
  check('B race too soon (10 days)', await probs({ ...base, eventDate: '2026-11-20' }), (v) => v.includes('too soon for a training plan'));
  check('B race before the start', await probs({ ...base, eventDate: '2026-11-01' }), (v) => v.includes('before the start date'));
  check('B result faster than the world record', await probs({ ...base, recent: { distanceM: 5000, timeSec: 600, ago: 'month' } }), (v) => v.includes('faster than the world record'));
  check('B result distance without a time', await probs({ ...base, recent: { distanceM: 5000, timeSec: null, ago: 'month' } }), (v) => v.includes('Enter the time'));
  check('B injured and not running: refused with advice', await probs({ ...base, weeklyKm: 0, runsPerWeek: 0, longestKm: 0, limitation: 'injury' }), (v) => v.includes('Get cleared to run'));
  check('B start date in the past', await probs({ ...base }, '2026-11-01'), (v) => v.includes('in the past'));
  as = await assess({ ...base, eventDate: '2027-06-20' });
  check('B race more than 16 weeks away: plan starts 16 weeks before, explained', `${as.ok}|${as.schedule.weeks}|${as.schedule.start}|${as.notes.some((n) => n.includes('more than 16 weeks away'))}`, 'true|16|2027-03-01|true');
  as = await assess({ ...base, eventDate: '2026-12-06' });
  check('B short run-up (4 weeks): allowed with a warning', `${as.ok}|${as.schedule.weeks}|${as.warnings.some((w) => w.includes('enough to sharpen up'))}`, 'true|4|true');

  /* C. Goal checks (unrealistic targets flagged, with the reason) */
  const goal = async (targetSec, extra = {}) => (await assess({ ...base, recent: { distanceM: 5000, timeSec: 1650, ago: 'month' }, targetSec, ...extra })).goal;
  check('C 27:30 now → 27:00 in 8 weeks: realistic', (await goal(1620)).status, 'realistic');
  check('C → 26:15: ambitious', (await goal(1575)).status, 'ambitious');
  const unl = await goal(1440);
  check('C → 24:00: unlikely, with numbers and why', `${unl.status}|${unl.text.includes('27:30')}|${unl.text.includes('12.7% faster')}|${unl.text.includes('not the target')}`, 'unlikely|true|true|true');
  check('C unlikely target also listed as a warning', (await assess({ ...base, recent: { distanceM: 5000, timeSec: 1650, ago: 'month' }, targetSec: 1440 })).warnings.some((w) => w.includes('unlikely')), true);
  check('C target already reached', (await goal(1700)).status, 'reached');
  check('C target without a result: can\'t be checked (no pretend precision)', (await assess({ ...base, targetSec: 1500 })).goal.status, 'unknown');
  check('C feasibility described as a rough guide, not a prediction', `${(await goal(1575)).text.includes('as a rough guide')}|${(await goal(1575)).text.includes('individual progress varies')}`, 'true|true');
  check('C current injury lowers the realistic gain', (await goal(1590, { limitation: 'injury' })).status, (v) => v !== 'realistic');

  /* D. Schedules across many runners: the rules hold */
  const grid = await ev(() => {
    const out = { plans: 0, bad: [] };
    const seen = new Set();
    const bad = (m) => { const kind = m.replace(/[\d.]+/g, '#'); if (!seen.has(kind) && out.bad.length < 12) { seen.add(kind); out.bad.push(m); } };
    const profiles = [];
    for (const distance of ['5k', '10k']) for (const experience of ['new', 'some', 'experienced']) for (const weeklyKm of [0, 1, 4, 8, 15, 30, 60]) for (const limitation of ['none', 'injury'])
      for (const days of [[1, 3, 6], [0, 2, 4, 6], [0, 1, 2, 3, 4, 5, 6], [5, 6]]) for (const ev of [null, '2027-01-17', '2026-12-13']) for (const recent of [null, { distanceM: 5000, timeSec: 1500, ago: 'month' }]) {
        const runsPerWeek = weeklyKm === 0 ? 0 : Math.max(2, Math.min(6, Math.round(weeklyKm / 7)));
        const longestKm = weeklyKm === 0 ? 0 : Math.min(weeklyKm, Math.max(Math.round(weeklyKm * 0.35), Math.ceil(weeklyKm / runsPerWeek)));
        profiles.push({ distance, experience, weeklyKm, runsPerWeek, longestKm, limitation, days, longDay: 6, eventDate: ev, weeks: ev ? null : 8, recent });
      }
    out.refusedInjured = 0;
    for (const a of profiles) {
      const as = assessRun(a, '2026-11-10');
      // Injured and not running: no plan, with the reason (fix 1).
      if (a.limitation === 'injury' && a.weeklyKm * 0.75 < 2) {
        if (as.ok || !as.problems.some((p) => p.includes('Get cleared to run'))) bad(`injured non-runner not refused`); else out.refusedInjured++;
        continue;
      }
      if (!as.ok) { bad(`assess ${JSON.stringify(a)}: ${as.problems}`); continue; }
      const def = PLAN_LIBRARY.get(`run-${a.distance}`);
      const r = createPlan(def, a, as.schedule.start);
      if (!r.ok) { bad(`create: ${r.errors}`); continue; }
      out.plans++;
      const W = r.plan.weeks;
      const tag = `${a.distance}/${a.experience}/${a.weeklyKm}km/${a.limitation}/${a.days.length}d/${a.eventDate || 'noevent'}`;
      const cap = as.plan.longCap;
      if (a.limitation !== 'injury' && cap < RUN_LONG_CAP[a.distance][as.base.experience]) bad(`${tag} long cap below table`);
      const inj = a.limitation === 'injury';
      // Fix 1: injury at ~75% of current volume, long run ≤ 75% of current longest, "Steady" weeks.
      // ~75% of current, or less only when the runs can't hold it (and the plan says so).
      const inj75 = Math.round(a.weeklyKm * 0.75 * 2) / 2;
      if (inj && (as.plan.startKm > inj75 + 0.01 || (Math.abs(as.plan.startKm - inj75) > 0.01 && !as.notes.some((m) => m.includes('More running days'))))) bad(`${tag} injury start ${as.plan.startKm} vs 75% of ${a.weeklyKm}`);
      if (inj && a.longestKm > 0 && cap > a.longestKm * 0.75 + 0.01) bad(`${tag} injury long cap ${cap} > 75% of ${a.longestKm}`);
      if (inj && !as.warnings.some((m) => m.startsWith('Only use this plan if you can run without pain or have been cleared to run'))) bad(`${tag} injury warning missing`);
      // Fix 2: readiness warning exactly when the goal is more than 1.6× the longest training run.
      const sum = r.plan.summary;
      const trainLongest = Math.max(...W.flatMap((w) => w.sessions.filter((x) => x.type !== 'race' && x.type !== 'time-trial').map((x) => x.targets.run.km)));
      const goalKm = RUN_GOALS[a.distance].m / 1000;
      const warned = sum.warnings.find((m) => m.includes('not to the full'));
      if (goalKm > 1.6 * trainLongest + 1e-9) {
        // Wording: what the training covers, with the numbers; never a verdict or a promise.
        const fullRun = W.some((w) => w.sessions.some((x) => x.type === 'time-trial'));
        if (!warned || !warned.includes(`This plan builds up to runs of ${fmtKm(trainLongest)}, not to the full ${RUN_GOALS[a.distance].label} distance (${fmtKm(goalKm)}, about ${Math.round(goalKm / trainLongest * 10) / 10} times your longest planned run).`) ||
            /race-ready|fully prepare|guarantee|\bsafe|you will be ready|you will finish|you can complete|you can't (finish|complete)|won't be able|unable to/i.test(warned) ||
            (a.eventDate && !warned.includes("doesn't decide on its own whether you can finish")) ||
            (!a.eventDate && fullRun !== warned.includes('optional'))) bad(`${tag} readiness warning wrong: ${warned}`);
        if (sum.readiness?.ratio == null || Math.abs(sum.readiness.ratio - goalKm / trainLongest) > 0.01) bad(`${tag} readiness ratio`);
      } else if (warned) bad(`${tag} readiness warning without need`);
      let lastBuild = null, lastLong = null, peak = 0;
      W.forEach((w, i) => {
        const ss = w.sessions;
        const kmOf = (s) => s.targets.run.km;
        const long = ss.find((s) => s.type === 'long');
        const hard = ss.filter((s) => ['tempo', 'intervals'].includes(s.type));
        const total = ss.reduce((n, s) => n + kmOf(s), 0);
        if (Math.abs(total - w.km) > 0.15) bad(`${tag} w${w.week} total mismatch`);
        if (ss.length > as.plan.runs + (a.eventDate && i === W.length - 1 ? 1 : 0)) bad(`${tag} w${w.week} too many runs`);
        for (const s of ss) if (s.type !== 'race' && !a.days.includes((sFromKey(s.date).getDay() + 6) % 7)) bad(`${tag} run on a rest day ${s.date}`);
        if (new Set(ss.map((s) => s.date)).size !== ss.length) bad(`${tag} two runs one day`);
        // Progression: never more than 10% or 1.5 km above the last build week (+0.5 km rounding)
        if (!w.deload && !w.taper && lastBuild != null && w.km > Math.max(lastBuild * 1.1, lastBuild + 1.5) + 0.6) bad(`${tag} w${w.week} jump ${lastBuild}→${w.km}`);
        if (w.deload && lastBuild != null && w.km >= lastBuild) bad(`${tag} w${w.week} recovery not lighter`);
        if (w.deload && hard.length) bad(`${tag} w${w.week} hard session in recovery week`);
        if (!w.deload && !w.taper) { lastBuild = w.km; peak = Math.max(peak, w.km); }
        // Volume proportionate to current training
        const trainKm = w.km - ss.filter((x) => x.type === 'race' || x.type === 'time-trial').reduce((n, x) => n + kmOf(x), 0);
        const growthBase = a.weeklyKm < 6 ? Math.max(as.plan.startKm, as.plan.runs * 2) : as.plan.startKm;
        if (trainKm > Math.max(growthBase * 1.6, as.plan.startKm) + 1.5) bad(`${tag} w${w.week} volume ${trainKm} vs start ${as.plan.startKm}`);
        if (a.limitation === 'injury' && w.km - ss.filter((x) => x.type === 'race').reduce((n, x) => n + kmOf(x), 0) > as.plan.startKm + 0.6) bad(`${tag} injury volume rises`);
        if (inj && w.km - ss.filter((x) => x.type === 'race').reduce((n, x) => n + kmOf(x), 0) > a.weeklyKm * 0.75 + 0.6) bad(`${tag} w${w.week} injury above 75%`);
        if (inj && long && long.targets.run.km > Math.max(1.5, a.longestKm * 0.75) + 0.01) bad(`${tag} w${w.week} injury long ${long.targets.run.km}`);
        if (inj && w.label === 'Build') bad(`${tag} injury week labelled Build`);
        if (inj && !w.deload && !w.taper && w.label !== 'Steady') bad(`${tag} injury week not Steady: ${w.label}`);
        // Fix 3: week 1 at most current + 1.5 km (never more just to fill minimum run lengths).
        if (i === 0 && !inj && w.km > a.weeklyKm + 1.5 + 0.1) bad(`${tag} week 1 ${w.km} > current ${a.weeklyKm} + 1.5`);
        if (ss.some((x) => x.type !== 'race' && x.type !== 'time-trial' && kmOf(x) < 0.99)) bad(`${tag} run under 1 km`);
        // Fix 4: the first long run keeps the current longest (up to 40% of week 1, the cap and +1 km),
        // and build-week long runs never drop below the previous build week's.
        if (i === 0 && !inj && long && a.longestKm > 0) {
          const keep = Math.min(cap, a.longestKm, 0.4 * w.km);
          if (long.targets.run.parts[0].km + 0.51 < keep) bad(`${tag} first long ${long.targets.run.parts[0].km} below kept ${keep}`);
        }
        if (long && !w.deload && !w.taper && lastLong != null && long.targets.run.parts[0].km + 0.01 < lastLong && w.week > 1) bad(`${tag} w${w.week} long dropped ${lastLong}→${long.targets.run.parts[0].km}`);
        if (i === 0 && Math.abs(w.km - as.plan.startKm) > Math.max(1.5, as.plan.startKm * 0.15)) bad(`${tag} week 1 ${w.km} vs ${as.plan.startKm}`);
        // Long run: share, cap, growth, longer than easy runs
        if (long) {
          const share = kmOf(long) / total;
          if (ss.filter((x) => x.type !== 'race').length > 1 && share > (ss.length <= 2 ? 0.6 : 0.47)) bad(`${tag} w${w.week} long share ${share.toFixed(2)}`);
          if (long.targets.run.parts[0].km > cap + 0.01) bad(`${tag} long over cap`);
          if (lastLong != null && !w.deload && !w.taper && long.targets.run.parts[0].km > lastLong + 1.51) bad(`${tag} long jump`);
          if (ss.some((s) => s.type === 'easy' && s.targets.run.parts[0].km > long.targets.run.parts[0].km + 0.01)) bad(`${tag} easy longer than long`);
          if (!w.deload && !w.taper) lastLong = long.targets.run.parts[0].km;
        }
        // Intensity only where it belongs, and in proportion
        if ((as.base.experience === 'new' || a.limitation === 'injury') && hard.some((s) => !s.title.startsWith('Race-pace'))) bad(`${tag} hard session for new/injured`);
        if (a.limitation === 'injury' && ss.some((s) => s.type === 'time-trial' || s.targets.run.parts.some((p) => p.t === 'strides'))) bad(`${tag} injured: time trial or strides`);
        if (hard.length > (as.base.experience === 'experienced' ? 2 : 1)) bad(`${tag} too many hard sessions`);
        for (const h of hard) {
          const p = h.targets.run.parts.find((x) => x.t === 'reps' || x.t === 'tempo');
          const mainKm = p.t === 'reps' ? p.n * p.m / 1000 : p.min * 60 / paceFor(as, 'tempo');
          if (!h.title.startsWith('Race-pace') && !(p.t === 'tempo' && p.min === 10) && mainKm > Math.max((p.t === 'reps' ? 0.08 : 0.10) * w.km, 1.6) + 0.5) bad(`${tag} w${w.week} hard part ${mainKm.toFixed(1)} of ${w.km}`);
          const prev = sKey(sAddDays(sFromKey(h.date), -1));
          if (long && long.date === prev && a.days.length >= 4) bad(`${tag} hard session the day after the long run`);
        }
        // Paces in sessions come only from the estimate
        for (const s of ss) if (!!s.targets.run.pace !== !!as.fitness.paces) bad(`${tag} pace presence`);
      });
      const last = W[W.length - 1];
      if (a.eventDate) {
        const race = last.sessions[last.sessions.length - 1];
        if (race.type !== 'race' || race.date !== a.eventDate) bad(`${tag} race not last / not on event day`);
        if (last.km - RUN_GOALS[a.distance].m / 1000 > peak * 0.6) bad(`${tag} no taper: ${last.km} km in race week vs peak ${peak}`);
        for (const s of last.sessions) {
          const d = sDaysBetween(sFromKey(s.date), sFromKey(a.eventDate));
          if (s.type === 'intervals' && d < 3) bad(`${tag} hard session ${d} days before race`);
          if (s.type !== 'race' && d < 2) bad(`${tag} run the day before race`);
        }
        if (a.distance === '10k' && W.length >= 6 && !(W[W.length - 2].taper && W[W.length - 2].km < peak + 0.01)) bad(`${tag} 10K taper week`);
      } else if (last.km > peak + 0.01 && a.limitation !== 'injury' && as.base.experience !== 'new') bad(`${tag} last week not lighter`);
    }
    return out;
  });
  check(`D every generated plan follows the rules (${grid.plans} plans)`, grid.bad.join(' || ') || 'ok', 'ok');
  check('D injured non-runners refused in every combination', grid.refusedInjured, (n) => n >= 100);
  check('D many plans checked', grid.plans, (n) => n > 1000);

  // Sensible across fitness levels: same goal, different runners
  const shape = (a) => ev((a) => { const as = assessRun(a, '2026-11-10'); const W = createPlan(PLAN_LIBRARY.get(`run-${a.distance}`), a, as.schedule.start).plan.weeks;
    return { start: W[0].km, peak: Math.max(...W.map((w) => w.km)), long: Math.max(...W.flatMap((w) => w.sessions.filter((s) => s.type === 'long').map((s) => s.targets.run.km))), hard: W.reduce((n, w) => n + w.sessions.filter((s) => ['tempo', 'intervals'].includes(s.type)).length, 0), runs: as.plan.runs }; }, a);
  const newbie = await shape({ distance: '5k', weeks: 8, days: [1, 3, 6], experience: 'new', weeklyKm: 0, runsPerWeek: 0, longestKm: 0 });
  const mid = await shape({ distance: '5k', weeks: 8, days: [1, 3, 5, 6], experience: 'some', weeklyKm: 15, runsPerWeek: 3, longestKm: 6 });
  const vet = await shape({ distance: '5k', weeks: 8, days: [0, 1, 2, 3, 4, 5, 6], experience: 'experienced', weeklyKm: 40, runsPerWeek: 5, longestKm: 12 });
  check('D beginner from zero: week 1 is 1.5 km (one run/walk), builds to ≤ 10 km/week, no hard sessions', `${newbie.start}|${newbie.peak <= 10}|${newbie.peak >= 8}|${newbie.long <= 4}|${newbie.hard}|${newbie.runs}`, '1.5|true|true|true|0|3');
  check('D some experience: builds from 15 to ~24 km, 1 hard session most weeks', `${Math.abs(mid.start - 15) <= 0.5}|${mid.peak >= 20 && mid.peak <= 24.5}|${mid.hard >= 4 && mid.hard <= 7}`, 'true|true|true');
  check('D experienced at 40 km: volume kept (already above a 5K peak), quality added', `${vet.start}|${vet.peak <= 40.5}|${vet.hard >= 8}`, '40|true|true');

  /* E. Setup → review → start (Plans tab) */
  await ev(() => { state.exercises = state.exercises.filter((e) => e.name !== 'Running'); save(); render(); }); // Running is added back by the plan
  await go(page, 'plans'); await wait();
  check('E running plans listed', `${(await view()).includes('5K plan')}|${(await view()).includes('10K plan')}`, 'true|true');
  await page.click('[data-action=run-setup][data-id="5k"]'); await wait();
  check('E setup fits the screen', await noOverflow(), true);
  await page.click('[data-action=rs-review]'); await wait();
  let t = await sheet();
  check('E review without experience/training: plan built on labelled assumptions, effort-based', `${t.includes('Assumed (not from your answers)')}|${t.includes('Effort-based plan')}|${t.includes('Start Plan')}`, 'true|true|true');
  await page.click('[data-action=rs-back]'); await wait();
  await page.fill('[data-rs=weekly]', '10'); await page.fill('[data-rs=longest]', '14');
  await page.click('[data-action=rs-review]'); await wait();
  t = await sheet();
  check('E inconsistent answers: no plan, explained, Start disabled', `${t.includes('longer than your weekly distance')}|${await page.isVisible('[data-action=rs-start]')}`, 'true|false');
  await page.click('#sheet [data-action=rs-back] >> nth=0'); await wait();
  await page.click('[data-action=rs-set][data-k=hasEvent][data-v=true]'); await wait();
  await page.fill('[data-rs=eventDate]', '2027-01-17'); await page.dispatchEvent('[data-rs=eventDate]', 'change');
  await page.fill('[data-rs=target]', '24:00');
  await page.selectOption('[data-rs=recentDist]', '5000'); await wait();
  await page.fill('[data-rs=recentTime]', '27:30');
  await page.fill('[data-rs=weekly]', '15'); await page.selectOption('[data-rs=runs]', '3'); await page.fill('[data-rs=longest]', '7');
  await page.click('[data-action=rs-set][data-k=experience][data-v=some]'); await wait();
  check('E typed answers survive redraws', `${await page.inputValue('[data-rs=weekly]')}|${await page.inputValue('[data-rs=recentTime]')}|${await page.inputValue('[data-rs=target]')}`, '15|27:30|24:00');
  await page.click('[data-action=rs-review]'); await wait();
  t = await sheet();
  check('E review: fitness estimate, paces, goal flagged, weeks', ['Estimated now: 5K 27:30', 'Easy runs', '6:43–7:32 /km', 'Target 5K: unlikely in this time', 'week 10 · race week', 'race: 5k'].map((x) => t.toLowerCase().includes(x.toLowerCase())).join(','), 'true,true,true,true,true,true');
  check('E review fits the screen', await noOverflow(), true);
  await page.click('[data-action=rs-start]'); await wait();
  let s = await st();
  const plan = s.plans[0];
  const PID = plan.id;
  check('E plan saved: run kind, source, answers, summary, race last', `${plan.kind}|${plan.source.defId}|${plan.name}|${plan.answers.weeklyKm}|${plan.summary.fitness.est['5k']}|${plan.summary.goalCheck.status}|${plan.weeks.length}|${plan.weeks[9].sessions.slice(-1)[0].date}`,
    'run|run-5k|5K plan · race Sun, 17 Jan|15|1650|unlikely|10|2027-01-17');
  check('E Running added back to the library and linked from every session', `${s.exercises.filter((e) => e.name === 'Running').length}|${plan.weeks.every((w) => w.sessions.every((x) => x.targets.run.exerciseId === s.exercises.find((e) => e.name === 'Running').id))}`, '1|true');
  check('E Plans: running card with week distance', (await view()).replace(/\s+/g, ' '), (v) => v.includes('5K plan · race Sun, 17 Jan') && /week 1 · build · 0 km of 15\.\d km/i.test(v));
  check('E one running plan at a time', `${await page.isDisabled('[data-action=run-setup][data-id="10k"]')}|${await ev(() => startRunPlan({ distance: '10k', weeks: 8, days: [1, 3, 6], experience: 'some', weeklyKm: 10, runsPerWeek: 3, longestKm: 5 }, todayKey()).error)}`, (v) => v.startsWith('true|') && v.includes('already running'));
  // Snapshot: a later engine change does not change the running plan
  const snap = JSON.stringify(plan.weeks);
  await ev(() => { RUN_PEAK['5k'].some = 99; PACE_FACTORS.easy = [2, 3]; });
  check('E engine change: plan unchanged (snapshot)', JSON.stringify((await st()).plans[0].weeks) === snap, true);
  await page.reload(); await wait(300);

  /* F. A session in the logger; planned vs actual; History */
  await go(page, 'home'); await wait();
  check('E Today shows today\'s run with distance and time', (await view()).replace(/\s+/g, ' '), (v) => v.includes('Today: Easy run') && /3(\.\d)? km · about \d+ min/.test(v));
  await page.click('#view [data-action=review][data-kind=planned]'); await wait();
  t = await sheet();
  check('F review: steps with pace, effort, total', t.includes('easy at 6:43–7:32 /km') && /effort/i.test(t) && t.includes('conversational') && /About [\d.]+ km · \d+ min/.test(t), true);
  await page.click('#sheet [data-action=begin]'); await wait(600);
  let a = (await st()).active;
  const target = a.entries[0].sets[0].target;
  check('F one Running entry with distance/time target, linked, run instructions kept', `${a.entries.length}|${a.entries[0].exerciseId === s.exercises.find((e) => e.name === 'Running').id}|${target.distance > 0}|${target.duration > 0}|${a.planned.kind}|${a.planned.run.parts.length > 0}|${JSON.stringify(a.plan)}`,
    `1|true|true|true|run|true|{"planId":"${PID}","sessionKey":"w1-1"}`);
  check('F banner shows the steps', (await page.innerText('.plan-banner')).includes('Log the whole run as one set'), true);
  check('F target shown as placeholders', `${await page.getAttribute('[data-field=distance][data-entry="0"][data-set="0"]', 'placeholder')}`, (v) => /^\d+(\.\d+)?$/.test(v));
  await page.fill('[data-field=distance][data-entry="0"][data-set="0"]', '3.5'); await page.fill('[data-field=duration][data-entry="0"][data-set="0"]', '21:00');
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
  await page.click('[data-action=finish]'); await wait();
  t = await sheet();
  check('F finish: distance vs plan, time, pace too fast for an easy run', t.includes('Distance 3.5 km of') && t.includes('Time 21:00') && t.includes('pace 6:00 /km') && t.includes('faster than the easy range'), true);
  await page.click('#sheet [data-action=save-workout]:not([data-include])'); await wait(600);
  check('F session completed by the logged run', await ev((id) => sessionStatus(findPlan(state, id), 'w1-1').status, PID), 'completed');
  await go(page, 'history'); await wait();
  await page.click('[data-action=open-workout] >> nth=0'); await wait();
  t = await sheet();
  check('F History: plan context and planned vs actual', t.includes('5K plan · race Sun, 17 Jan · Week 1') && /planned vs actual/i.test(t) && t.includes('Distance 3.5 km of'), true);
  check('F History fits the screen', await noOverflow(), true);
  await ev(() => closeSheet());
  await go(page, 'plans'); await wait();
  check('F week distance done counts the logged run', (await view()).replace(/\s+/g, ' '), (v) => /3\.5 km of 15\.\d km/i.test(v));
  await page.click(`.plan-sess[data-id="${PID}|w1-3"]`); await wait();
  t = await sheet();
  check('F session sheet: run steps, start/skip/move', /effort/i.test(t) && t.includes('Start Workout') && t.includes('Skip Session') && /move to another day/i.test(t), true);
  await ev(() => closeSheet());

  /* G. Alongside a strength program: same-day conflicts */
  const r = await ev(() => startProgram(findProgram('full-body-3'), { days: [1, 3, 5], weeks: 8, deload: 4 }, '2026-11-10'));
  check('G strength program allowed alongside, conflicts reported', `${r.ok}|${r.conflicts.length > 0}`, 'true|true');
  await ev(() => save());
  await go(page, 'plans'); await wait();
  check('G Plans warns about same-day sessions', (await view()).replace(/\s+/g, ' '), (v) => v.includes('Sessions from two plans on the same day') && v.includes('Full Body') && v.includes('Easy run'));
  await page.clock.setFixedTime(new Date('2026-11-12T09:00:00+01:00')); // Thursday: a run and a strength session
  await page.reload(); await wait(300);
  check('G Thursday: both planned sessions open', `${(await ev(() => todaysPlannedSessions().map((x) => x.session.title).sort().join('+')))}`, 'Easy run+Full Body B');
  await go(page, 'home'); await wait();
  check('G Today: one to start, the other offered too', (await view()).includes('Also today:'), true);

  /* H. Backup and restore */
  await go(page, 'settings'); await wait();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
  const file = `${DIR}/runs.json`; await dl.saveAs(file);
  const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('H export: format 2, both plans, run summary and planned run record', `${exp.format}|${exp.counts.plans}|${!!exp.data.plans.find((p) => p.kind === 'run').summary}|${exp.data.workouts.some((w) => w.planned?.kind === 'run')}`, '2|2|true|true');
  const before = await st();
  await ev(() => { state.plans = []; save(); render(); });
  await page.setInputFiles('#import-file', file); await wait(400);
  if (await page.$('#sheet [data-action=restore-toggle-copy][aria-checked=true]')) await page.click('#sheet [data-action=restore-toggle-copy]');
  await page.click('#sheet [data-action=restore-confirm]'); await wait(500);
  const after = await st();
  check('H restore: plans and workouts exactly back; run session still completed', `${JSON.stringify(after.plans) === JSON.stringify(before.plans)}|${JSON.stringify(after.workouts) === JSON.stringify(before.workouts)}|${await ev((id) => sessionStatus(findPlan(state, id), 'w1-1').status, PID)}`, 'true|true|completed');
  const broken = JSON.parse(JSON.stringify(exp)); broken.data.plans.find((p) => p.kind === 'run').weeks[0].sessions[0].targets.run.km = 'far';
  check('H damaged run target refused', await ev((b) => validateBackup(b).errors?.join(' ') || 'accepted', broken), (v) => v.includes('invalid run'));
  const broken2 = JSON.parse(JSON.stringify(exp)); broken2.data.workouts.find((w) => w.planned?.kind === 'run').planned.items[0].distanceM = 'x';
  check('H damaged planned run record refused', await ev((b) => validateBackup(b).errors?.join(' ') || 'accepted', broken2), (v) => v.includes('invalid planned session record'));
  await ev(() => closeSheet());

  /* I. Imperial units */
  await ev(() => { state.settings.unit = 'lb'; save(); render(); });
  await go(page, 'plans'); await wait();
  await page.click(`.plan-sess[data-id="${PID}|w1-3"]`); await wait();
  check('I miles: paces /mi and distances in mi', (await sheet()), (v) => v.includes('/mi') && / mi /.test(v) && !v.includes('/km'));
  await ev(() => { closeSheet(); state.settings.unit = 'kg'; save(); render(); });

  /* R. The five review profiles: whole schedules */
  const prof = (a) => ev(([a]) => {
    const as = assessRun(a, todayKey());
    if (!as.ok) return { problems: as.problems };
    const plan = createPlan(PLAN_LIBRARY.get(`run-${a.distance}`), a, as.schedule.start).plan;
    return { start: as.plan.startKm, notes: as.notes, warnings: plan.summary.warnings, goal: as.goal.text || '',
      weeks: plan.weeks.map((w) => ({ km: w.km, label: w.label, n: w.sessions.length, long: w.sessions.find((x) => x.type === 'long')?.targets.run.km ?? null,
        hard: w.sessions.filter((x) => ['tempo', 'intervals'].includes(x.type)).length, strides: w.sessions.some((x) => x.targets.run.parts.some((p) => p.t === 'strides')), tt: w.sessions.some((x) => x.type === 'time-trial'), race: w.sessions.some((x) => x.type === 'race') })) };
  }, [a]);
  const R1 = await prof({ distance: '5k', weeks: 8, weeklyKm: 4, runsPerWeek: 2, longestKm: 2.5, days: [1, 3, 5], longDay: 5, experience: 'new', limitation: 'none' });
  check('R1 beginner 5K: week 1 = 5.5 km (4 + 1.5), not 6', `${R1.start}|${R1.weeks[0].km}|${R1.weeks[0].n}`, '5.5|5.5|3');
  check('R1 beginner 5K: gentle build ≤ 1.5 km/week, recovery week 4, no hard sessions', `${R1.weeks.map((w) => w.km).join(',')}|${R1.weeks[3].label}|${R1.weeks.every((w) => !w.hard)}`, (v) => { const [km, lab, h] = v.split('|'); const k = km.split(',').map(Number); return k.slice(1, 3).every((x, i) => x - k[i] <= 1.6) && lab === 'Recovery week' && h === 'true' && Math.max(...k) <= 10; });
  const R2 = await prof({ distance: '10k', eventDate: '2027-01-17', weeklyKm: 8, runsPerWeek: 2, longestKm: 4, days: [1, 3, 6], longDay: 6, experience: 'new', limitation: 'none' });
  const r2w = R2.warnings.find((m) => m.includes('not to the full'));
  check('R2 beginner 10K race: warning says the plan builds to 4.5 km, not the full 10 km (2.2×), gap is not a verdict', r2w,
    "This plan builds up to runs of 4.5 km, not to the full 10K distance (10 km, about 2.2 times your longest planned run). Race day will be well beyond anything in your training. That gap doesn't decide on its own whether you can finish; it means your training won't have covered the distance. Consider a 5K first, a later race date, or planning walk breaks during the race.");
  check('R2 beginner 10K race: taper and race on the day', `${R2.weeks[8].label}|${R2.weeks[9].label}|${R2.weeks[9].race}|${R2.weeks[9].km < R2.weeks[7].km}`, 'Taper|Race week|true|true');
  const R2b = await prof({ distance: '10k', weeks: 12, weeklyKm: 8, runsPerWeek: 2, longestKm: 4, days: [1, 3, 6], longDay: 6, experience: 'new', limitation: 'none' });
  const r2bw = R2b.warnings.find((m) => m.includes('not to the full'));
  check('R2b beginner 10K no race: a step towards 10K, no 10K time trial', `${r2bw}|${R2b.weeks.some((w) => w.tt)}`,
    'This plan builds up to runs of 4.5 km, not to the full 10K distance (10 km, about 2.2 times your longest planned run). Treat it as a step towards 10K: follow it with another plan (or aim for a 5K first), and plan walk breaks when you first try the full distance.|false');
  const r1w = R1.warnings.find((m) => m.includes('not to the full'));
  const r1Long = Math.max(...R1.weeks.map((w) => w.long || 0));
  check('R1 beginner 5K: warning only when 5 km > 1.6× the longest run; optional 5K run kept', `${!!r1w === 5 > 1.6 * r1Long}|${R1.weeks[R1.weeks.length - 1].tt}`, 'true|true');
  // A beginner whose plan ends with the optional 5K run and still triggers the warning (0 km/week start)
  const R1z = await prof({ distance: '5k', weeks: 8, weeklyKm: 0, runsPerWeek: 0, longestKm: 0, days: [1, 3, 5], longDay: 5, experience: 'new', limitation: 'none' });
  const r1zw = R1z.warnings.find((m) => m.includes('not to the full')) || '';
  check('R1z beginner from zero: optional 5K run explained as a first try at the full distance, with walk breaks and stopping if it hurts',
    `${R1z.weeks[R1z.weeks.length - 1].tt}|${/^This plan builds up to runs of [\d.]+ km, not to the full 5K distance \(5 km, about [\d.]+ times your longest planned run\)\. The optional 5K run in the last week is a first try at the full distance: take walk breaks whenever you need them, and stop if anything hurts\. Another plan afterwards can build you up to it\.$/.test(r1zw)}`, 'true|true');
  const R3 = await prof({ distance: '5k', eventDate: '2027-01-03', recent: { distanceM: 5000, timeSec: 1560, ago: 'month' }, targetSec: 1500, weeklyKm: 20, runsPerWeek: 3, longestKm: 8, days: [1, 3, 5, 6], longDay: 6, experience: 'some', limitation: 'none' });
  check('R3 intermediate 5K: long run stays 8 km (40% of week 1), never drops in build weeks', `${R3.weeks[0].long}|${R3.weeks.filter((w) => w.label === 'Build').every((w) => w.long >= 8)}|${R3.weeks[3].label}|${R3.weeks[3].long < 8}`, '8|true|Recovery week|true');
  check('R3 intermediate 5K: one hard session in build weeks 2+, race-week sharpener, goal as rough guide', `${R3.weeks.slice(1, 7).filter((w) => w.label === 'Build').every((w) => w.hard === 1)}|${R3.weeks[7].race}|${R3.goal.includes('as a rough guide')}|${R3.warnings.some((m) => m.includes('not to the full'))}`, 'true|true|true|false');
  const R4 = await prof({ distance: '10k', eventDate: '2027-01-31', recent: { distanceM: 10000, timeSec: 2400, ago: 'month' }, targetSec: 2340, weeklyKm: 60, runsPerWeek: 6, longestKm: 18, days: [0, 1, 2, 3, 4, 5, 6], longDay: 6, experience: 'experienced', limitation: 'none' });
  check('R4 experienced 10K: volume held ~60, long 18, recovery 4 & 8, 2-week taper, race', `${R4.weeks.filter((w) => w.label === 'Build').every((w) => w.km >= 58 && w.km <= 60.1)}|${R4.weeks[0].long}|${R4.weeks[3].label}|${R4.weeks[7].label}|${R4.weeks[10].label}|${R4.weeks[11].race}|${Math.max(...R4.weeks.map((w) => w.hard))}`, 'true|18|Recovery week|Recovery week|Taper|true|2');
  const R5 = await prof({ distance: '10k', weeks: 8, recent: { distanceM: 5000, timeSec: 1500, ago: 'month' }, targetSec: 3000, weeklyKm: 25, runsPerWeek: 4, longestKm: 10, days: [0, 2, 4, 6], longDay: 6, experience: 'some', limitation: 'injury', limitationNote: 'sore Achilles' });
  check('R5 injury: 19 km (75% of 25), long ≤ 7.5 (75% of 10), Steady weeks, no hard/strides/time trial', `${R5.start}|${Math.max(...R5.weeks.map((w) => w.km))}|${Math.max(...R5.weeks.map((w) => w.long))}|${[...new Set(R5.weeks.map((w) => w.label))].join(',')}|${R5.weeks.some((w) => w.hard || w.strides || w.tt)}`, '19|19|7.5|Steady,Recovery week,Lighter week|false');
  check('R5 injury: warning text as agreed', R5.warnings.some((m) => m.startsWith('Only use this plan if you can run without pain or have been cleared to run')), true);

  // On screen: the review shows the readiness and injury warnings and the Steady weeks
  await ev(() => { state.plans = []; save(); render(); });
  await go(page, 'plans'); await wait();
  await page.click('[data-action=run-setup][data-id="10k"]'); await wait();
  await page.evaluate(() => { Object.assign(ui.runSetup, { hasEvent: false, weeks: '12', weekly: '8', runs: '2', longest: '4', experience: 'new', days: [1, 3, 6], longDay: '6' }); });
  await page.click('[data-action=rs-review]'); await wait();
  t = await sheet();
  check('R review shows the readiness warning', t.includes('This plan builds up to runs of 4.5 km, not to the full 10K distance') && t.includes('about 2.2 times your longest planned run'), true);
  await page.click('#sheet [data-action=rs-back]'); await wait();
  await page.evaluate(() => { Object.assign(ui.runSetup, { weekly: '25', runs: '4', longest: '10', experience: 'some', limitation: 'injury', days: [0, 2, 4, 6] }); });
  await page.click('[data-action=rs-review]'); await wait();
  t = await sheet();
  check('R review shows the injury warning and Steady weeks', t.includes('Only use this plan if you can run without pain or have been cleared to run') && t.includes('Steady') && !t.includes('Build'), true);
  await ev(() => closeSheet());

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
