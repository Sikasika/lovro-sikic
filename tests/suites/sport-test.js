// Swimming and cycling plans: setup validation, whole generated schedules across many athletes
// (ability limits, progression, recovery, structure, taper, injury, data-free plans), the
// setup → review → start flow, sessions in the logger, planned vs actual, statuses, conflicts,
// one sport plan at a time, backup/restore. Usage: node sport-test.js <outDir> <light|dark>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(process.argv[2] || '.'), scheme = process.argv[3] || 'light';
const DIR = `${OUT}/backup-files/sport-${scheme}`;
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got).slice(0, 600)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

process.on('unhandledRejection', (e) => { console.log(results.join('\n')); console.log(`CRASH ${e.message.split('\n')[0]}`); console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length + 1}`); process.exit(1); });
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

  /* A. Swim setup validation */
  const S0 = { goal: 'fitness', weeks: 8, poolLen: 25, poolUnit: 'm', contDist: 200, sessionsPerWeek: 2, weeklyDist: 1200, days: [1, 3, 5], experience: 'some', limitation: 'none' };
  const sp = async (a) => (await ev(([a]) => assessSwim(a, todayKey()), [a])).problems.join(' ');
  check('A swim: continuous distance is required (asked, not guessed)', await sp({ ...S0, contDist: null }), (v) => v.includes('How far can you swim without stopping'));
  check('A swim: can\'t swim a length yet → lessons first', await sp({ ...S0, contDist: 15 }), (v) => v.includes('at least one length') && v.includes('learn-to-swim'));
  check('A swim: longest swim longer than the week', await sp({ ...S0, contDist: 1500, weeklyDist: 1000 }), (v) => v.includes('longer than your weekly distance'));
  check('A swim: 0 sessions with a weekly distance', await sp({ ...S0, sessionsPerWeek: 0 }), (v) => v.includes('0 sessions a week'));
  check('A swim: pace faster than world-class', await sp({ ...S0, pace100: 40 }), (v) => v.includes('faster than world-class'));
  check('A swim: invalid pool', await sp({ ...S0, poolLen: 33 }), (v) => v.includes('pool length'));
  check('A swim: event too soon / before start / no target', `${await sp({ ...S0, goal: 'event', targetDist: 1500, eventDate: '2026-11-20' })}|${await sp({ ...S0, goal: 'event', targetDist: 1500, eventDate: '2026-11-01' })}|${await sp({ ...S0, goal: 'distance', targetDist: null })}`, (v) => v.includes('too soon') && v.includes('before the start date') && v.includes('Enter the target distance'));
  check('A swim: injured and barely swimming → refused', await sp({ ...S0, limitation: 'injury', weeklyDist: 200, sessionsPerWeek: 1, contDist: 100 }), (v) => v.includes('Get cleared'));
  let as = await ev(([a]) => assessSwim(a, todayKey()), [{ ...S0, pace100: 130, contDist: 150, weeklyDist: 900 }]);
  check('A swim: pace from a swim under 200 not used (effort instead), said so', `${as.ok}|${as.paces}|${as.notes.some((n) => n.includes('isn\'t reliable'))}`, 'true|null|true');
  as = await ev(([a]) => assessSwim(a, todayKey()), [{ ...S0, sessionsPerWeek: null, weeklyDist: null, experience: null }]);
  check('A swim: missing current swimming and experience → conservative, labelled', `${as.ok}|${as.base.experience}|${as.assumptions.length >= 2}|${as.assumptions.some((m) => m.includes('no regular swimming'))}`, 'true|new|true|true');
  as = await ev(([a]) => assessSwim(a, todayKey()), [{ ...S0, pace100: 120, contDist: 800, weeklyDist: 4000, sessionsPerWeek: 3 }]);
  check('A swim: paces from pace 2:00 over 800: easy slower than steady slower than threshold', `${as.paces.easy.join('-')}|${as.paces.steady.join('-')}|${as.paces.threshold.join('-')}`, '132-140|125-132|117-122');

  /* B. Ride setup validation */
  const R0 = { goal: 'fitness', weeks: 8, weeklyMin: 180, ridesPerWeek: 3, longestMin: 90, days: [1, 3, 6], longDay: 6, experience: 'some', limitation: 'none', setting: 'outdoor' };
  const rp = async (a) => { const x = await ev(([a]) => assessRide(a, todayKey()), [a]); return `${x.problems.join(' ')}||${x.warnings.join(' ')}`; };
  check('B ride: weekly time but 0 rides', await rp({ ...R0, ridesPerWeek: 0 }), (v) => v.includes('0 rides a week'));
  check('B ride: longest longer than the week', await rp({ ...R0, longestMin: 300 }), (v) => v.includes('longer than your weekly riding time'));
  check('B ride: longest shorter than the average ride', await rp({ ...R0, longestMin: 30 }), (v) => v.includes('shorter than your average ride'));
  check('B ride: target distance out of range', await rp({ ...R0, goal: 'distance', targetKm: 900 }), (v) => v.includes('between 5 and 400 km'));
  check('B ride: implausible FTP / speed / max HR ignored with a warning', await rp({ ...R0, ftp: 2000, speedKmh: 90, maxHr: 300 }), (v) => v.includes('FTP ignored') && v.includes('Average speed ignored') && v.includes('Maximum heart rate ignored'));
  check('B ride: injured and barely riding → refused', await rp({ ...R0, limitation: 'injury', weeklyMin: 40, ridesPerWeek: 1, longestMin: 40 }), (v) => v.includes('Get cleared'));
  as = await ev(([a]) => assessRide(a, todayKey()), [{ ...R0, weeklyMin: null, ridesPerWeek: null, longestMin: null }]);
  check('B ride: missing current riding → conservative assumption, labelled', `${as.ok}|${as.assumptions.some((m) => m.includes('Current riding not given'))}`, 'true|true');
  as = await ev(([a]) => assessRide(a, todayKey()), [R0]);
  check('B ride: no measurements → time and effort only, said so (no invented zones)', `${as.ftp}|${as.maxHr}|${as.speed}|${as.notes.some((n) => n.includes('No power zones are guessed'))}`, 'null|null|null|true');

  /* C. Swim schedules across many swimmers */
  const swimGrid = await ev(() => {
    const out = { plans: 0, refused: 0, bad: [] }; const seen = new Set();
    const bad = (m) => { const k = m.replace(/[\d.]+/g, '#'); if (!seen.has(k) && out.bad.length < 12) { seen.add(k); out.bad.push(m); } };
    const LEVEL_DRILLS = SWIM_DRILLS;
    for (const pool of [[25, 'm'], [50, 'm'], [25, 'yd']]) for (const cont of [25, 50, 100, 200, 500, 1200, 3000]) for (const exp of ['new', 'some', 'experienced'])
      for (const weekly of [null, 0, 'mid']) for (const lim of ['none', 'injury']) for (const days of [[1, 4], [0, 2, 4], [0, 1, 2, 3, 4, 5]])
        for (const g of [['fitness'], ['distance', cont * 2], ['event', Math.max(cont * 1.5, 400)]]) {
          const [len, unit] = pool;
          if (cont < len) continue;
          const sessions = weekly === null ? null : weekly === 0 ? 0 : 3;
          const weeklyDist = weekly === null ? null : weekly === 0 ? 0 : Math.max(cont * 2, 600) * 3;
          const a = { goal: g[0], targetDist: g[1] ? Math.round(g[1] / len) * len : null, eventDate: g[0] === 'event' ? '2027-01-17' : null, weeks: g[0] === 'event' ? null : 8,
            poolLen: len, poolUnit: unit, contDist: cont, sessionsPerWeek: sessions, weeklyDist, days, experience: exp, limitation: lim, pace100: cont >= 200 ? 120 : null };
          const as = assessSwim(a, '2026-11-10');
          if (!as.ok) { if (lim === 'injury' || (a.targetDist && a.targetDist * as.pool.f > 10000)) { out.refused++; continue; } bad(`assess ${JSON.stringify(a)} ${as.problems}`); continue; }
          const r = createPlan(PLAN_LIBRARY.get('swim'), a, as.schedule.start);
          if (!r.ok) { bad(`create ${r.errors}`); continue; }
          out.plans++;
          const W = r.plan.weeks, f = as.pool.f, L = as.plan.L;
          const tag = `${len}${unit}/c${cont}/${exp}/${weekly}/${lim}/${days.length}d/${g[0]}`;
          const contM = cont * f, step = Math.max(L, SWIM_STEP[as.level]);
          let lastBuild = null, buildN = 0, peak = 0;
          W.forEach((w, i) => {
            const ss = w.sessions;
            const total = ss.reduce((n, s) => n + s.targets.swim.totalM, 0);
            if (Math.abs(total - w.m) > 1) bad(`${tag} total mismatch`);
            for (const s of ss) {
              const sw = s.targets.swim;
              if (s.type !== 'race' && !days.includes((sFromKey(s.date).getDay() + 6) % 7)) bad(`${tag} swim on a rest day`);
              for (const p of sw.parts) {
                if (p.t !== 'race' && s.type !== 'test' && p.d % len !== 0) bad(`${tag} part not whole lengths ${p.d}`);
                if (p.t !== 'race' && s.type !== 'test' && p.d * f > w.maxPiece + 0.5) bad(`${tag} w${w.week} piece ${p.d} > allowed ${w.maxPiece}`);
                if (p.t === 'drill' && !LEVEL_DRILLS[as.level].includes(p.drill)) bad(`${tag} drill above level: ${p.drill}`);
                if (p.t === 'set' && p.n > 1 && p.rest < SWIM_REST[as.level]) bad(`${tag} rest too short`);
              }
              if (s.type === 'threshold' && ['starter', 'developing'].includes(as.level)) bad(`${tag} threshold for ${as.level}`);
              // Continuous swims: no 'rest whenever you need'; repeats-only sessions keep their own text
              const hasCont = sw.parts.some((p) => p.t === 'cont');
              if (s.type !== 'race' && hasCont && (!s.objective.includes('the continuous distance only counts if swum without stopping') || /rest at the wall|whenever you need|finish another time/i.test(`${s.objective} ${sw.effort}`))) bad(`${tag} continuous-swim text: ${s.objective} / ${sw.effort}`);
              if (!hasCont && s.objective.includes('only counts if swum without stopping')) bad(`${tag} continuous-swim text on a repeats-only session`);
              if (s.type === 'threshold' && (lim === 'injury' || w.deload || w.taper)) bad(`${tag} threshold in recovery/taper/injury`);
            }
            // The endurance swim reaches the week's longest allowed swim, unless that would take it past half the week
            const endS = ss.find((s) => s.type === 'endurance' && s.targets.swim.parts.some((p) => p.t === 'cont'));
            if (endS && !w.deload && !w.taper && lim !== 'injury' && as.level !== 'starter') {
              const contLen = Math.max(...endS.targets.swim.parts.filter((p) => p.t === 'cont').map((p) => p.d)) * f;
              const capped = w.maxPiece + SWIM_WU_MAX[as.level] + SWIM_CD_MAX[as.level] + L > w.m * 0.5 - L;
              if (contLen + 0.5 < w.maxPiece && !capped) bad(`${tag} w${w.week} endurance swim ${contLen} short of ${w.maxPiece}`);
              const share = (w.m * SWIM_WEIGHT.endurance) / ss.reduce((n, x) => n + (SWIM_WEIGHT[x.type] || 1), 0);
              if (endS.targets.swim.totalM > Math.max(w.m * 0.5, share) + 2 * L) bad(`${tag} w${w.week} endurance session ${endS.targets.swim.totalM} over half the week ${w.m}`);
            }
            if (Math.abs(w.longest - Math.max(0, ...ss.filter((s) => s.type !== 'race').map((s) => s.targets.swim.longest)) * f) > 1) bad(`${tag} week longest wrong`);
            // Ability: the longest swim grows one step per build week, never past the goal, never with an injury
            if (!w.deload && !w.taper && i > 0 && lim !== 'injury') buildN++;
            const allowed = Math.max(L, Math.floor((contM + step * buildN) / L + 1e-9) * L);
            if (w.maxPiece > allowed + 0.5) bad(`${tag} w${w.week} longest ${w.maxPiece} > ${allowed}`);
            if (lim === 'injury' && w.maxPiece > contM + 0.5) bad(`${tag} injury longest grows`);
            if (as.plan.target && w.maxPiece > Math.max(contM, as.plan.target) + 0.5) bad(`${tag} longest past goal`);
            // Volume
            if (i === 0) {
              if (lim === 'injury' && total > as.base.weekly * 0.75 + 60) bad(`${tag} injury week 1 ${total}`);
              if (lim !== 'injury' && as.base.weekly > 0 && total > as.base.weekly + Math.max(200, 0.2 * as.base.weekly) + 400) bad(`${tag} week 1 ${total} vs ${as.base.weekly}`);
            }
            if (!w.deload && !w.taper && lastBuild != null && total > Math.max(lastBuild * 1.1, lastBuild + 100) + 260) bad(`${tag} w${w.week} jump ${lastBuild}→${total}`);
            if (w.deload && lastBuild != null && total >= lastBuild) bad(`${tag} recovery not lighter`);
            if (!w.deload && !w.taper) { lastBuild = total; peak = Math.max(peak, total); }
            if (total > Math.max(as.plan.startW * 1.6, as.plan.startW) + 600 && !(w.taper && ss.some((x) => x.type === 'race'))) bad(`${tag} w${w.week} volume ${total} vs start ${as.plan.startW}`);
            if (lim === 'injury' && !w.deload && !w.taper && w.label !== 'Steady') bad(`${tag} injury label ${w.label}`);
          });
          const last = W[W.length - 1];
          if (a.eventDate) {
            const race = last.sessions[last.sessions.length - 1];
            if (race.type !== 'race' || race.date !== a.eventDate) bad(`${tag} event not last`);
            if (last.m - race.targets.swim.totalM > peak * 0.75) bad(`${tag} no taper`);
            if (last.sessions.some((s) => s.type !== 'race' && sDaysBetween(sFromKey(s.date), sFromKey(a.eventDate)) < 2)) bad(`${tag} swim the day before the event`);
          }
          // Readiness warning exactly when the goal is longer than the longest planned swim
          const longest = Math.max(...W.flatMap((w) => w.sessions.filter((s) => s.type !== 'race').map((s) => s.targets.swim.longest))) * f;
          const warned = r.plan.summary.warnings.find((m) => m.includes('not to the full'));
          if (as.plan.target && longest + 0.01 < as.plan.target) {
            if (!warned || !warned.includes(`about ${Math.round((as.plan.target / longest) * 10) / 10} times your longest planned swim`)) bad(`${tag} readiness warning wrong: ${warned}`);
          } else if (warned) bad(`${tag} readiness warning without need`);
          const injEvent = r.plan.summary.warnings.includes('With a current injury, check with your physiotherapist or doctor before swimming the event itself.');
          if (injEvent !== (lim === 'injury' && !!a.eventDate)) bad(`${tag} injured-event note ${injEvent}`);
          if (lim === 'injury' && !r.plan.summary.warnings.some((m) => m.startsWith('Only use this plan'))) bad(`${tag} injury warning missing`);
          // Paces only when supported
          if (!!r.plan.summary.paces !== (cont >= 200)) bad(`${tag} paces presence`);
        }
    return out;
  });
  check(`C every generated swim plan follows the rules (${swimGrid.plans} plans)`, swimGrid.bad.join(' || ') || 'ok', 'ok');
  check('C many swim plans checked', swimGrid.plans, (n) => n > 800);

  /* D. Ride schedules across many riders */
  const rideGrid = await ev(() => {
    const out = { plans: 0, bad: [] }; const seen = new Set();
    const bad = (m) => { const k = m.replace(/[\d.]+/g, '#'); if (!seen.has(k) && out.bad.length < 12) { seen.add(k); out.bad.push(m); } };
    for (const exp of ['new', 'some', 'experienced']) for (const weekly of [0, 60, 180, 420, 720]) for (const lim of ['none', 'injury'])
      for (const days of [[1, 4], [1, 3, 6], [0, 2, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]]) for (const data of ['none', 'speed', 'all']) for (const setting of ['outdoor', 'indoor'])
        for (const g of [['fitness'], ['distance', 60], ['event', 100]]) {
          const rides = weekly === 0 ? 0 : Math.max(1, Math.min(6, Math.round(weekly / 60)));
          const longest = weekly === 0 ? 0 : Math.min(weekly, Math.max(Math.round(weekly * 0.4), Math.ceil(weekly / rides)));
          const a = { goal: g[0], targetKm: g[1] || null, eventDate: g[0] === 'event' ? '2027-01-17' : null, weeks: g[0] === 'event' ? null : 8,
            weeklyMin: weekly, ridesPerWeek: rides, longestMin: longest, days, longDay: 6, experience: exp, limitation: lim, setting,
            speedKmh: data !== 'none' ? 25 : null, ftp: data === 'all' ? 230 : null, maxHr: data === 'all' ? 185 : null };
          const as = assessRide(a, '2026-11-10');
          if (!as.ok) { if (lim === 'injury' && weekly * 0.75 < 45) continue; bad(`assess ${JSON.stringify(a)} ${as.problems}`); continue; }
          const r = createPlan(PLAN_LIBRARY.get('bike'), a, as.schedule.start);
          if (!r.ok) { bad(`create ${r.errors}`); continue; }
          out.plans++;
          const W = r.plan.weeks;
          const tag = `${exp}/${weekly}/${lim}/${days.length}d/${data}/${setting}/${g[0]}`;
          let lastBuild = null, lastLong = null, peak = 0;
          W.forEach((w, i) => {
            const ss = w.sessions;
            const train = ss.filter((s) => s.type !== 'event');
            const total = train.reduce((n, s) => n + s.targets.ride.min, 0);
            if (Math.abs(total - w.min) > 0.5) bad(`${tag} total mismatch`);
            for (const s of ss) {
              const rd = s.targets.ride;
              if (s.type !== 'event' && !days.includes((sFromKey(s.date).getDay() + 6) % 7)) bad(`${tag} ride on a rest day`);
              if (!!rd.power !== (data === 'all' && rd.effortKey !== 'event')) bad(`${tag} power presence ${s.type}`);
              if (!!rd.hr !== (data === 'all' && rd.effortKey !== 'event')) bad(`${tag} hr presence`);
              if (rd.kmRange && (data === 'none' || setting === 'indoor')) bad(`${tag} distance invented`);
              if (s.type === 'intervals') {
                if (exp === 'new' || lim === 'injury' || w.deload || ss.length < 3) bad(`${tag} intervals not allowed here`);
                const p = rd.parts.find((x) => x.t === 'reps');
                if (p.n * p.min > Math.max(0.12 * w.min, 15) + 10) bad(`${tag} w${w.week} hard ${p.n * p.min} of ${w.min}`);
              }
            }
            if (i === 0) {
              if (lim === 'injury' && total > weekly * 0.75 + 5) bad(`${tag} injury week 1 ${total}`);
              if (lim !== 'injury' && total > weekly + 30 + 5) bad(`${tag} week 1 ${total} > ${weekly}+30`);
            }
            if (!w.deload && !w.taper && lastBuild != null && total > Math.max(lastBuild * 1.1, lastBuild + 20) + 6) bad(`${tag} w${w.week} jump ${lastBuild}→${total}`);
            if (w.deload && lastBuild != null && total >= lastBuild) bad(`${tag} recovery not lighter`);
            const long = ss.find((s) => s.type === 'long');
            if (long) {
              if (long.targets.ride.min > as.plan.longCap + 0.5) bad(`${tag} long over cap`);
              if (lastLong != null && !w.deload && !w.taper && long.targets.ride.min > lastLong + 20.5) bad(`${tag} long jump`);
              if (i === 0 && long.targets.ride.min > Math.max(as.base.longestMin, 30) + 15.5) bad(`${tag} first long ${long.targets.ride.min}`);
              if (lim === 'injury' && as.base.longestMin > 0 && long.targets.ride.min > Math.max(30, as.base.longestMin * 0.75) + 5) bad(`${tag} injury long`);
              if (!w.deload && !w.taper) lastLong = long.targets.ride.min;
            }
            if (!w.deload && !w.taper) { lastBuild = total; peak = Math.max(peak, total); }
            if (lim === 'injury' && !w.deload && !w.taper && w.label !== 'Steady') bad(`${tag} injury label`);
          });
          const last = W[W.length - 1];
          if (a.eventDate) {
            const evS = last.sessions[last.sessions.length - 1];
            if (evS.type !== 'event' || evS.date !== a.eventDate) bad(`${tag} event not last`);
            if (last.min > peak * 0.75) bad(`${tag} no taper ${last.min} vs ${peak}`);
            if (last.sessions.some((s) => s.type !== 'event' && sDaysBetween(sFromKey(s.date), sFromKey(a.eventDate)) < 2)) bad(`${tag} ride the day before`);
          }
          const sum = r.plan.summary;
          const longestRide = Math.max(...W.flatMap((w) => w.sessions.filter((s) => s.type !== 'event').map((s) => s.targets.ride.min)));
          const warned = sum.warnings.find((m) => m.includes('not to the full'));
          if (a.targetKm && as.speed) {
            const need = (a.targetKm / as.speed) * 60;
            if (need > longestRide * 1.5) { if (!warned || !warned.includes(`about ${Math.round((need / longestRide) * 10) / 10} times your longest planned ride`)) bad(`${tag} readiness warning wrong`); }
            else if (warned) bad(`${tag} readiness warning without need`);
          } else if (a.targetKm && !sum.notes.some((m) => m.includes('can\'t tell how long'))) bad(`${tag} no-speed note missing`);
        }
    return out;
  });
  check(`D every generated cycling plan follows the rules (${rideGrid.plans} plans)`, rideGrid.bad.join(' || ') || 'ok', 'ok');
  check('D many cycling plans checked', rideGrid.plans, (n) => n > 1000);

  /* E. Plans for different starting points (whole schedules) */
  const swimShape = (a) => ev(([a]) => { const as = assessSwim(a, todayKey()); const W = createPlan(PLAN_LIBRARY.get('swim'), a, as.schedule.start).plan.weeks;
    return { level: as.level, start: W[0].m, peak: Math.max(...W.map((w) => w.m)), longest: Math.max(...W.map((w) => w.maxPiece)), threshold: W.reduce((n, w) => n + w.sessions.filter((s) => s.type === 'threshold').length, 0), cont: W.some((w) => w.sessions.some((s) => s.targets.swim.parts.some((p) => p.t === 'cont'))), labels: [...new Set(W.map((w) => w.label))] }; }, [a]);
  const sw1 = await swimShape({ goal: 'fitness', weeks: 8, poolLen: 25, poolUnit: 'm', contDist: 25, days: [1, 4], experience: 'new' });
  check('E swim starter (25 m): short repeats with rest, no continuous swims or threshold, ≤ 1 km a week, longest ≤ 200 m', `${sw1.level}|${sw1.cont}|${sw1.threshold}|${sw1.peak <= 1000}|${sw1.longest <= 200}`, 'starter|false|0|true|true');
  const sw2 = await swimShape({ goal: 'distance', targetDist: 400, weeks: 8, poolLen: 25, poolUnit: 'm', contDist: 200, sessionsPerWeek: 2, weeklyDist: 1200, days: [0, 2, 4], experience: 'some' });
  check('E swim developing (200 m → 400 m goal): builds the continuous swim to 400, no threshold', `${sw2.level}|${sw2.longest}|${sw2.threshold}`, 'developing|400|0');
  const sw3 = await swimShape({ goal: 'fitness', weeks: 8, poolLen: 50, poolUnit: 'm', contDist: 3000, pace100: 95, sessionsPerWeek: 4, weeklyDist: 12000, days: [0, 1, 2, 3, 4, 5], experience: 'experienced' });
  check('E swim advanced (12 km/week): volume kept, threshold sets most weeks', `${sw3.level}|${sw3.peak <= 12600}|${sw3.threshold >= 10}`, 'advanced|true|true');
  const sw5 = await swimShape({ goal: 'fitness', weeks: 6, poolLen: 25, poolUnit: 'yd', contDist: 500, sessionsPerWeek: 3, weeklyDist: 4000, days: [0, 2, 4], experience: 'some', limitation: 'injury' });
  check('E swim injury: ~75%, longest swim not increased, no threshold, Steady weeks', `${sw5.start <= 4000 * 0.9144 * 0.75 + 60}|${sw5.longest <= 500 * 0.9144 + 1}|${sw5.threshold}|${sw5.labels.join(',')}`, 'true|true|0|Steady,Recovery week,Lighter week');
  /* J. Swim review fixes: endurance sizing, continuous-swim instructions, injured events */
  const swimWeeks = (a) => ev(([a]) => { const as = assessSwim(a, todayKey()); const p = createPlan(PLAN_LIBRARY.get('swim'), a, as.schedule.start).plan;
    const contOf = (s) => Math.max(0, ...s.targets.swim.parts.filter((x) => x.t === 'cont').map((x) => x.d)) * as.pool.f;
    return { warnings: p.summary.warnings, weeks: p.weeks.map((w) => { const e = w.sessions.find((s) => s.type === 'endurance');
      return { build: !w.deload && !w.taper, lim: w.maxPiece, longest: w.longest, m: w.m, endCont: e ? contOf(e) : null, endTotal: e ? e.targets.swim.totalM : null,
        texts: w.sessions.map((s) => ({ type: s.type, cont: s.targets.swim.parts.some((x) => x.t === 'cont'), objective: s.objective, effort: s.targets.swim.effort })) }; }) }; }, [a]);
  const I800 = { goal: 'event', targetDist: 1500, eventDate: '2027-01-17', poolLen: 25, poolUnit: 'm', contDist: 800, pace100: 120, sessionsPerWeek: 3, weeklyDist: 5000, days: [0, 2, 4, 6], experience: 'some' };
  let sj = await swimWeeks(I800);
  const jb = sj.weeks.filter((w) => w.build && w.endCont != null);
  check('J 800 → 1,500 m: every build week\'s endurance swim reaches that week\'s longest swim (800 … 1,400 m)', jb.map((w) => `${w.endCont}/${w.lim}`).join(','), (v) => jb.length >= 6 && jb.every((w) => w.endCont === w.lim) && v.endsWith('1400/1400'));
  check('J 800 → 1,500 m: endurance session within half the week', jb.every((w) => w.endTotal <= w.m * 0.5), true);
  const jw = sj.warnings.find((m) => m.includes('not to the full')) || '';
  const jLongest = Math.max(...sj.weeks.map((w) => w.longest));
  check('J 800 → 1,500 m: warning gives the longest continuous swim (1,400 m), not a session total (1,875 m)', `${jLongest}|${jw.includes('swims of 1,400 m without stopping')}|${jw.includes('about 1.1 times')}|${Math.max(...sj.weeks.map((w) => w.endTotal || 0))}`, '1400|true|true|1875');
  // Low weekly distance: the half-week cap wins, and the warning doesn't claim the longer swim
  sj = await swimWeeks({ goal: 'event', targetDist: 2000, eventDate: '2027-01-17', poolLen: 25, poolUnit: 'm', contDist: 1200, sessionsPerWeek: 3, weeklyDist: 2400, days: [0, 2, 4], experience: 'some' });
  const cw = sj.warnings.find((m) => m.includes('not to the full')) || '';
  const cLongest = Math.max(...sj.weeks.map((w) => w.longest));
  check('J capped: endurance session kept to half the week even when the limit doesn\'t fit', sj.weeks.filter((w) => w.build && w.endTotal).every((w) => w.endTotal <= w.m * 0.5 + 25) && sj.weeks.some((w) => w.build && w.endCont < w.lim), true);
  check('J capped: warning reports the swim actually planned, not the allowed limit', `${cw.includes(`swims of ${cLongest.toLocaleString('en-GB')} m without stopping`)}|${cLongest < Math.max(...sj.weeks.map((w) => w.lim))}`, 'true|true');
  // Instructions
  const allTexts = (sj.weeks.concat((await swimWeeks(I800)).weeks)).flatMap((w) => w.texts);
  const contTexts = allTexts.filter((x) => x.cont);
  check('J continuous swims: "without stopping … only counts if swum without stopping", no "rest whenever you need"', `${contTexts.length > 5}|${contTexts.every((x) => x.objective.includes('Swim the continuous part without stopping if you can. If you have to stop, rest briefly, finish the distance and note where you stopped: the continuous distance only counts if swum without stopping.'))}|${contTexts.some((x) => /whenever you need|rest at the wall/i.test(x.objective + x.effort))}`, 'true|true|false');
  const st1 = await swimWeeks({ goal: 'fitness', weeks: 8, poolLen: 25, poolUnit: 'm', contDist: 25, days: [1, 4], experience: 'new' });
  const stT = st1.weeks.flatMap((w) => w.texts);
  const stEnd = stT.find((x) => x.type === 'endurance' && x.objective !== 'Recovery week: keep it relaxed.');
  check('J starter (repeats only): no continuous-swim text; existing instructions kept', `${stT.some((x) => x.cont || x.objective.includes('only counts'))}|${stEnd.objective}|${stEnd.effort}`, 'false|Builds the distance you can swim. Easy and relaxed; rest at the wall whenever you need.|Easy: relaxed, about 3–4 out of 10. Rest longer whenever you need to.');
  const dTest = (await swimWeeks({ goal: 'distance', targetDist: 400, weeks: 8, poolLen: 25, poolUnit: 'm', contDist: 200, sessionsPerWeek: 2, weeklyDist: 1200, days: [0, 2, 4], experience: 'some' })).weeks.flatMap((w) => w.texts).find((x) => x.type === 'test');
  check('J optional goal-distance swim: continuous-swim text, no "finish another time"', `${dTest.objective.startsWith('Your goal distance in one go')}|${dTest.objective.includes('only counts if swum without stopping')}|${/another time/.test(dTest.objective)}`, 'true|true|false');
  // Injured swimmers and events
  const INJ_EV = 'With a current injury, check with your physiotherapist or doctor before swimming the event itself.';
  const ie = (await swimWeeks({ goal: 'event', targetDist: 1500, eventDate: '2027-01-17', poolLen: 25, poolUnit: 'm', contDist: 500, sessionsPerWeek: 3, weeklyDist: 3000, days: [0, 2, 4], experience: 'some', limitation: 'injury' })).warnings;
  check('J injured + event: physio/doctor note added; injury and event-readiness warnings kept', `${ie.includes(INJ_EV)}|${ie.some((m) => m.startsWith('Only use this plan'))}|${ie.some((m) => m.includes('not to the full 1,500 m'))}`, 'true|true|true');
  const inf = (await swimWeeks({ goal: 'fitness', weeks: 8, poolLen: 25, poolUnit: 'm', contDist: 500, sessionsPerWeek: 3, weeklyDist: 3000, days: [0, 2, 4], experience: 'some', limitation: 'injury' })).warnings;
  check('J injured without an event / event without injury: no physio note', `${inf.includes(INJ_EV)}|${(await swimWeeks(I800)).warnings.includes(INJ_EV)}`, 'false|false');
  const rideShape = (a) => ev(([a]) => { const as = assessRide(a, todayKey()); const W = createPlan(PLAN_LIBRARY.get('bike'), a, as.schedule.start).plan.weeks;
    return { start: W[0].min, peak: Math.max(...W.map((w) => w.min)), long: Math.max(...W.flatMap((w) => w.sessions.filter((s) => s.type === 'long').map((s) => s.targets.ride.min))), intervals: W.reduce((n, w) => n + w.sessions.filter((s) => s.type === 'intervals').length, 0), power: W.some((w) => w.sessions.some((s) => s.targets.ride.power)), labels: [...new Set(W.map((w) => w.label))] }; }, [a]);
  const rd1 = await rideShape({ goal: 'fitness', weeks: 8, days: [1, 3, 6], experience: 'new', weeklyMin: 0, ridesPerWeek: 0, longestMin: 0 });
  check('E ride beginner from zero: 30 min first week, ≤ 2.5 h peak, no intervals or power', `${rd1.start}|${rd1.peak <= 150}|${rd1.intervals}|${rd1.power}`, '30|true|0|false');
  const rd2 = await rideShape({ goal: 'event', targetKm: 100, eventDate: '2027-01-17', weeklyMin: 180, ridesPerWeek: 3, longestMin: 90, speedKmh: 25, days: [1, 3, 5, 6], longDay: 6, experience: 'some', setting: 'both' });
  check('E ride intermediate 100 km event: builds from 3 h, long ride grows, tempo intervals, taper', `${rd2.start}|${rd2.peak > 240 && rd2.peak <= 295}|${rd2.long >= 120}|${rd2.intervals >= 5}|${rd2.labels.includes('Taper')}|${rd2.labels.includes('Event week')}`, '180|true|true|true|true|true');
  const rd3 = await rideShape({ goal: 'fitness', weeks: 8, weeklyMin: 420, ridesPerWeek: 5, longestMin: 180, ftp: 250, maxHr: 185, days: [0, 1, 2, 3, 4, 5, 6], longDay: 5, experience: 'experienced', setting: 'outdoor', speedKmh: 30 });
  check('E ride experienced with FTP: power ranges, two interval sessions most weeks, long ride from 3 h', `${rd3.power}|${rd3.intervals >= 9}|${rd3.long >= 180 && rd3.long <= 360}`, 'true|true|true');
  const rd5 = await rideShape({ goal: 'fitness', weeks: 6, weeklyMin: 240, ridesPerWeek: 3, longestMin: 120, days: [1, 3, 6], experience: 'some', limitation: 'injury' });
  check('E ride injury: 3 h (75% of 4 h), long ≤ 90 min, no intervals, Steady', `${rd5.start}|${rd5.long <= 90}|${rd5.intervals}|${rd5.labels.join(',')}`, '180|true|0|Steady,Recovery week,Lighter week');

  /* F. Swim plan: setup → review → start → log → planned vs actual → History */
  await ev(() => { state.exercises = state.exercises.filter((e) => e.name !== 'Swimming'); save(); render(); });
  await go(page, 'plans'); await wait();
  check('F library lists swim and cycling plans with sport tags', `${(await view()).includes('Swim plan')}|${(await view()).includes('Cycling plan')}|${await page.$$eval('.prog-lib .sport-tag', (x) => x.map((e) => e.textContent).join(','))}`, (v) => v.startsWith('true|true|') && v.includes('Swim') && v.includes('Ride') && v.includes('Run'));
  await page.click('[data-action=swim-setup]'); await wait();
  check('F swim setup fits the screen', await noOverflow(), true);
  await page.click('[data-action=ss-review]'); await wait();
  check('F no continuous distance: no plan, asks for it', (await sheet()).includes('How far can you swim without stopping'), true);
  await page.click('#sheet [data-action=ss-back] >> nth=0'); await wait();
  await page.click('[data-action=ss-set][data-k=goal][data-v=event]'); await wait();
  await page.fill('[data-ss=target]', '1500'); await page.fill('[data-ss=eventDate]', '2027-01-17'); await page.dispatchEvent('[data-ss=eventDate]', 'change');
  await page.fill('[data-ss=cont]', '800'); await page.fill('[data-ss=pace]', '2:00'); await page.selectOption('[data-ss=sessions]', '3'); await page.fill('[data-ss=weekly]', '5000');
  await page.click('[data-action=ss-set][data-k=experience][data-v=some]'); await wait();
  check('F typed answers survive redraws', `${await page.inputValue('[data-ss=cont]')}|${await page.inputValue('[data-ss=pace]')}`, '800|2:00');
  await page.click('[data-action=ss-review]'); await wait();
  let t = await sheet();
  check('F review: level, paces, readiness warning, weeks, event', ['Intermediate', 'Easy pace', '/100 m', 'not to the full 1,500 m', 'Event week', 'Event: 1,500 m'].map((x) => t.includes(x)).join(','), 'true,true,true,true,true,true');
  check('F review fits the screen', await noOverflow(), true);
  await page.click('[data-action=ss-start]'); await wait();
  let s = await st();
  const swimPlan = s.plans.find((p) => p.kind === 'swim');
  const SID = swimPlan.id;
  check('F swim plan saved with summary; Swimming added to the library; sessions linked to it', `${swimPlan.source.defId}|${swimPlan.summary.level}|${s.exercises.filter((e) => e.name === 'Swimming').length}|${swimPlan.weeks.every((w) => w.sessions.every((x) => x.targets.swim.exerciseId === s.exercises.find((e) => e.name === 'Swimming').id))}`, 'swim|intermediate|1|true');
  check('F one sport plan at a time (running/cycling blocked)', `${await page.isDisabled('[data-action=ride-setup]')}|${await page.isDisabled('[data-action=run-setup][data-id="5k"]')}|${await ev(() => startSportPlan('bike', { goal: 'fitness', weeks: 8, weeklyMin: 120, ridesPerWeek: 2, longestMin: 70, days: [1, 3], experience: 'some' }, todayKey()).error)}`, (v) => v.startsWith('true|true|') && v.includes('already running'));
  check('F Plans card: swim tags and week distance', (await view()).replace(/\s+/g, ' '), (v) => v.includes('SWIM') || v.includes('Swim'));
  const snap = JSON.stringify(swimPlan.weeks);
  await ev(() => { SWIM_STEP.intermediate = 999; SWIM_REST.intermediate = 1; });
  check('F engine change: swim plan unchanged (snapshot)', JSON.stringify((await st()).plans.find((p) => p.kind === 'swim').weeks) === snap, true);
  await page.reload(); await wait(300);
  await go(page, 'home'); await wait();
  check('F Today offers today\'s swim', (await view()).replace(/\s+/g, ' '), (v) => v.includes('Today: Technique swim') && /\d[\d,]* m · about \d+ min/.test(v));
  await page.click('#view [data-action=review][data-kind=planned]'); await wait();
  t = await sheet();
  check('F swim review: warm-up, drills, set with rest, cool-down, effort', ['Warm up:', 'Drills:', 's rest', 'Cool down:', 'Slow and smooth'].map((x) => t.includes(x)).join(','), 'true,true,true,true,true');
  await page.click('#sheet [data-action=begin]'); await wait(600);
  let a = (await st()).active;
  check('F swim in the logger: one Swimming entry, distance + time target, linked, steps kept', `${a.entries.length}|${a.entries[0].sets[0].target.distance > 0}|${a.entries[0].sets[0].target.duration > 0}|${a.planned.kind}|${a.planned.swim.parts.length > 2}|${a.plan.planId === SID}`, '1|true|true|swim|true|true');
  check('F swim banner explains logging', (await page.innerText('.plan-banner')).includes('rests included'), true);
  const plannedM = a.planned.items[0].distanceM;
  await page.fill('[data-field=distance][data-entry="0"][data-set="0"]', String(Math.round(plannedM * 0.95))); await page.fill('[data-field=duration][data-entry="0"][data-set="0"]', '35:00');
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
  await page.click('[data-action=finish]'); await wait();
  t = await sheet();
  check('F swim finish: distance vs plan, time, pace per 100 incl. rests, done', t.includes(`Distance ${Math.round(plannedM * 0.95).toLocaleString()} m of`) && t.includes('Time 35:00') && t.includes('per 100 m including rests') && t.includes('Done'), true);
  check('F swim finish: says the distance includes rests and doesn\'t show a non-stop swim', t.includes("Total distance, rests included; this doesn't show whether the continuous swim was done without stopping."), true);
  await page.click('#sheet [data-action=save-workout]:not([data-include])'); await wait(600);
  check('F swim session completed', await ev((id) => sessionStatus(findPlan(state, id), 'w1-1').status, SID), 'completed');
  await go(page, 'history'); await wait();
  await page.click('[data-action=open-workout] >> nth=0'); await wait();
  t = await sheet();
  check('F History: plan context and planned vs actual for the swim', t.includes('Week 1') && /planned vs actual/i.test(t) && t.includes('Distance'), true);
  check('F History: total-distance note on the swim', t.includes("Total distance, rests included; this doesn't show whether the continuous swim was done without stopping."), true);
  check('F History swim fits the screen', await noOverflow(), true);
  await ev(() => closeSheet());

  /* G. Cycling plan: alongside a strength program, conflicts, log, planned vs actual */
  await ev((id) => { stopPlan(state, id); deletePlan(state, id); save(); render(); }, SID);
  await ev(() => { const r = startProgram(findProgram('full-body-3'), { days: [1, 3, 5], weeks: 8, deload: 4 }, todayKey()); save(); render(); return r.ok; });
  await go(page, 'plans'); await wait();
  await page.click('[data-action=ride-setup]'); await wait();
  await page.click('[data-action=ss-set][data-k=goal][data-v=distance]'); await wait();
  await page.fill('[data-ss=target]', '80'); await page.fill('[data-ss=weekly]', '2:30'); await page.selectOption('[data-ss=rides]', '3'); await page.fill('[data-ss=longest]', '1.25');
  await page.click('[data-action=ss-set][data-k=experience][data-v=some]'); await wait();
  await page.evaluate(() => { ui.sportSetup.days = [1, 3, 6]; });
  await page.click('[data-action=ss-review]'); await wait();
  t = await sheet();
  check('F ride review without speed/FTP: time and effort, can\'t convert distance, conflict with strength listed', t.includes('Time and effort plan') && t.includes("can't tell how long 80 km takes you") && t.includes('Same day as your strength program'), true);
  await page.click('[data-action=ss-start]'); await wait();
  s = await st();
  const ridePlan = s.plans.find((p) => p.kind === 'bike');
  const RID = ridePlan.id;
  check('G cycling plan saved alongside the strength program (answers in minutes and km)', `${s.plans.length}|${ridePlan.answers.weeklyMin}|${ridePlan.answers.longestMin}|${ridePlan.answers.targetKm}`, '2|150|75|80');
  check('G same-day warning on Plans', (await view()).replace(/\s+/g, ' '), (v) => v.includes('Sessions from two plans on the same day'));
  check('G no session has invented power, heart rate or distance', ridePlan.weeks.every((w) => w.sessions.every((x) => !x.targets.ride.power && !x.targets.ride.hr && !x.targets.ride.kmRange)), true);
  await page.click(`.plan-sess[data-id="${RID}|w1-1"]`); await wait();
  t = await sheet();
  check('G ride session sheet: steps, effort, start/skip/move', t.includes('Effort') || /effort/i.test(t), true);
  await page.click('#sheet [data-action=review][data-kind=planned]'); await wait();
  await page.click('#sheet [data-action=begin]'); await wait(600);
  a = (await st()).active;
  check('G ride in the logger: Cycling entry with time target only (no speed given)', `${a.planned.kind}|${a.entries[0].sets[0].target.duration > 0}|${'distance' in a.entries[0].sets[0].target}`, 'ride|true|false');
  const planSec = a.planned.items[0].durationSec;
  await page.fill('[data-field=distance][data-entry="0"][data-set="0"]', '15'); await page.fill('[data-field=duration][data-entry="0"][data-set="0"]', String(Math.round(planSec / 60 * 0.5)));
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
  await page.click('[data-action=finish]'); await wait();
  t = await sheet();
  check('G ride finish: time vs plan (half → partly done), distance and average speed shown', t.includes('Partly done') && t.includes('Distance 15 km') && t.includes('average'), true);
  await page.click('#sheet [data-action=save-workout]:not([data-include])'); await wait(600);
  check('G ride session completed (linked workout)', await ev((id) => sessionStatus(findPlan(state, id), 'w1-1').status, RID), 'completed');
  await go(page, 'plans'); await wait();
  check('G week time done shows the logged ride', (await view()).replace(/\s+/g, ' '), (v) => /\d+ min of \d h/i.test(v) || /\d+ min of \d+ min/i.test(v));

  /* H. Backup and restore */
  await go(page, 'settings'); await wait();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
  const file = `${DIR}/sports.json`; await dl.saveAs(file);
  const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('H export: format 2, both plans, planned ride record', `${exp.format}|${exp.counts.plans}|${exp.data.workouts.some((w) => w.planned?.kind === 'ride')}`, '2|2|true');
  const before = await st();
  await ev(() => { state.plans = []; save(); render(); });
  await page.setInputFiles('#import-file', file); await wait(400);
  if (await page.$('#sheet [data-action=restore-toggle-copy][aria-checked=true]')) await page.click('#sheet [data-action=restore-toggle-copy]');
  await page.click('#sheet [data-action=restore-confirm]'); await wait(500);
  const after = await st();
  check('H restore: plans and workouts exactly back; ride still completed', `${JSON.stringify(after.plans) === JSON.stringify(before.plans)}|${JSON.stringify(after.workouts) === JSON.stringify(before.workouts)}|${await ev((id) => sessionStatus(findPlan(state, id), 'w1-1').status, RID)}`, 'true|true|completed');
  const swimBackup = JSON.parse(JSON.stringify(exp));
  // A swim plan inside a backup is validated too
  const swimP = await ev(() => { const a = { goal: 'fitness', weeks: 6, poolLen: 25, poolUnit: 'm', contDist: 400, sessionsPerWeek: 2, weeklyDist: 2000, days: [1, 4], experience: 'some' }; const r = createPlan(PLAN_LIBRARY.get('swim'), a, todayKey(), { id: 'swimx' }); return r.plan; });
  swimBackup.data.plans = [swimP]; swimBackup.counts.plans = 1;
  check('H valid swim plan in a backup accepted', await ev((b) => validateBackup(b).ok, swimBackup), true);
  const badSwim = JSON.parse(JSON.stringify(swimBackup)); badSwim.data.plans[0].weeks[0].sessions[0].targets.swim.parts[1].rest = -5;
  check('H damaged swim target refused', await ev((b) => validateBackup(b).errors?.join(' ') || 'accepted', badSwim), (v) => v.includes('invalid swim'));
  const badRide = JSON.parse(JSON.stringify(exp)); badRide.data.plans.find((p) => p.kind === 'bike').weeks[0].sessions[0].targets.ride.min = 'long';
  check('H damaged ride target refused', await ev((b) => validateBackup(b).errors?.join(' ') || 'accepted', badRide), (v) => v.includes('invalid ride'));
  const badRec = JSON.parse(JSON.stringify(exp)); badRec.data.workouts.find((w) => w.planned?.kind === 'ride').planned.ride.power = [1];
  check('H damaged planned ride record refused', await ev((b) => validateBackup(b).errors?.join(' ') || 'accepted', badRec), (v) => v.includes('invalid planned session record'));
  await ev(() => closeSheet());

  /* I. Imperial display: miles for rides, the pool's own unit for swims */
  await ev(() => { state.settings.unit = 'lb'; save(); render(); });
  const ydPlan = await ev(() => { const a = { goal: 'fitness', weeks: 6, poolLen: 25, poolUnit: 'yd', contDist: 300, sessionsPerWeek: 2, weeklyDist: 1500, days: [1, 4], experience: 'some' }; const p = createPlan(PLAN_LIBRARY.get('swim'), a, todayKey()).plan; return swimPartsText(p.weeks[0].sessions[0].targets.swim).join(' | '); });
  check('I swim parts in yards for a 25 yd pool', ydPlan, (v) => / yd /.test(v) && !/ m /.test(v));
  await ev(() => { state.settings.unit = 'kg'; save(); render(); });

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
