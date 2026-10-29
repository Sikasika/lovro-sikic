'use strict';

/*
  Cycling plans: assessment and schedule, by duration and effort. Pure; registered as the
  plan definition 'bike' on the same plan core as the other plans.

  Answers (times in minutes, distances in km, speed in km/h; optional fields may be missing):
    goal 'fitness' | 'distance' | 'event'   targetKm (distance or event)
    eventDate (event) | weeks (6–12)
    weeklyMin, ridesPerWeek, longestMin      current riding
    speedKmh   usual average speed outdoors (optional; only for distance estimates)
    ftp        measured functional threshold power in watts (optional; power ranges only then)
    maxHr      measured maximum heart rate (optional)
    setting 'indoor' | 'outdoor' | 'both', days [0–6], experience, limitation

  Rules
  - Everything is planned in minutes with an effort (1–10). Power ranges only from a given FTP,
    heart-rate ranges only from a measured maximum, outdoor distances only from a given usual
    speed, and then as a flexible range (terrain and wind vary). Nothing is invented.
  - Week 1 is at most 30 minutes more than the current week (with an injury: about 75%).
    Weekly time then rises by at most 10% (or 20 minutes) to a peak of 1.6× the start and a
    cap for the experience. Every 4th week is a recovery week (≈ 70%, no intervals).
  - Long ride: 35–60% of the week depending on rides, starts at most 15 minutes above the
    current longest (or keeps it, up to half the week), grows by at most 20 minutes a week.
  - Intervals only for riders with some experience, 3+ rides and 2.5+ hours a week; at most
    about 12% of the week's time at the hard effort. New riders: endurance and easy rides only.
    Injury: about 75% held steady, no intervals.
  - Events: taper (race week ≈ 60%; long events also the week before ≈ 80%) and the event on
    its day. Readiness: with a usual speed, when the target takes more than 1.5× the longest
    planned ride, the plan says so with the numbers.

  Loaded after plans.js and programs.js; registers its plan when loaded.
*/

const RIDE_WEEK_OPTIONS = [6, 8, 10, 12];
const RIDE_PEAK = { new: 300, some: 480, experienced: 720 }; // minutes a week
const RIDE_LONG_CAP = { new: 150, some: 240, experienced: 360 };
const RIDE_ASSUMED = { new: { weeklyMin: 0, rides: 0, longestMin: 0 }, some: { weeklyMin: 120, rides: 2, longestMin: 75 }, experienced: { weeklyMin: 240, rides: 3, longestMin: 120 } };
const RIDE_EFFORT = {
  recovery: 'Very easy spinning, about 1–2 out of 10: lighter than you think.',
  endurance: 'Endurance: about 3–4 out of 10, you can talk in full sentences.',
  tempo: 'Tempo: about 5–6 out of 10, steady pressure, short sentences only.',
  sweetspot: 'Sweet spot: about 6–7 out of 10, hard but sustainable for the interval.',
  vo2: 'Hard: about 8–9 out of 10, only a few words. Recover fully between efforts.',
  event: 'Event pace: steady and sustainable; eat and drink regularly on long rides.'
};
const RIDE_FTP = { recovery: [0, 0.55], endurance: [0.56, 0.75], tempo: [0.76, 0.87], sweetspot: [0.88, 0.94], vo2: [1.06, 1.2] };
const RIDE_HR = { recovery: [0, 0.65], endurance: [0.65, 0.75], tempo: [0.76, 0.82], sweetspot: [0.83, 0.87], vo2: [0.9, 0.95] };
const RIDE_STAGES = {
  tempo: [[2, 10], [2, 12], [3, 10], [2, 15], [3, 12], [2, 20]],
  sweetspot: [[3, 8], [3, 10], [3, 12], [2, 18], [2, 20]],
  vo2: [[5, 3], [6, 3], [5, 4], [6, 4]]
};
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);

function assessRide(a, startDate, today = todayKey()) {
  const problems = [], warnings = [], assumptions = [], notes = [];
  const days = Array.isArray(a?.days) ? [...new Set(a.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((x, y) => x - y) : [];
  if (days.length < 2) problems.push('Choose at least 2 days you can ride.');
  if (!isDateKey(startDate)) problems.push('Choose a start date.');
  else if (startDate < today) problems.push('The start date can\'t be in the past.');
  let exp = a?.experience;
  if (!['new', 'some', 'experienced'].includes(exp)) { exp = 'new'; assumptions.push('Riding experience not given: the plan is built for a beginner.'); }
  const injury = a?.limitation === 'injury';
  const setting = ['indoor', 'outdoor', 'both'].includes(a?.setting) ? a.setting : 'outdoor';

  const given = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  let weeklyMin = given(a?.weeklyMin) ? a.weeklyMin : null;
  let rides = Number.isInteger(a?.ridesPerWeek) && a.ridesPerWeek >= 0 && a.ridesPerWeek <= 14 ? a.ridesPerWeek : null;
  let longestMin = given(a?.longestMin) ? a.longestMin : null;
  if (weeklyMin == null && rides == null && longestMin == null) {
    ({ weeklyMin, rides, longestMin } = RIDE_ASSUMED[exp]);
    assumptions.push(`Current riding not given: assumed ${weeklyMin ? `${rideTime(weeklyMin)} a week over ${rides} rides, longest ${rideTime(longestMin)}` : 'no regular riding'} (a conservative guess for your experience).`);
  } else {
    if (weeklyMin == null) { weeklyMin = rides && longestMin ? Math.round(longestMin + (rides - 1) * longestMin * 0.7) : longestMin || 0; assumptions.push(`Weekly riding time not given: estimated at ${rideTime(weeklyMin)}.`); }
    if (rides == null) { rides = weeklyMin > 0 ? Math.max(1, Math.min(5, Math.round(weeklyMin / 60))) : 0; assumptions.push(`Rides per week not given: assumed ${rides}.`); }
    if (longestMin == null) { longestMin = rides ? Math.round(Math.min(weeklyMin, (weeklyMin / rides) * 1.3)) : 0; assumptions.push(`Longest recent ride not given: assumed ${rideTime(longestMin)}.`); }
  }
  if (rides === 0 && weeklyMin > 0) problems.push('You entered a weekly riding time but 0 rides a week. Check your current riding.');
  if (rides > 0 && weeklyMin === 0) problems.push('You entered rides per week but no weekly riding time. Check your current riding.');
  if (longestMin > weeklyMin + 0.5 && weeklyMin > 0) problems.push('Your longest recent ride is longer than your weekly riding time. Enter a usual week and your longest single ride.');
  if (rides > 0 && weeklyMin > 0 && longestMin + 15 < weeklyMin / rides) problems.push('Your longest ride is shorter than your average ride (weekly time ÷ rides). Check the three numbers.');
  if (weeklyMin > 40 * 60 || longestMin > 16 * 60) problems.push('Those riding times look too high. Check the numbers (minutes a week).');
  if (injury && weeklyMin * 0.75 < 45) problems.push('You have a current injury and ride very little at the moment. Get cleared by a physiotherapist or doctor first; a plan can\'t safely be built from here.');
  if (injury) warnings.push('Only use this plan if you can ride without pain or have been cleared to ride by a physiotherapist or doctor. It keeps you at about 75% of your current riding, steady and easy only. Stop and get advice if pain returns.');
  else if (a?.limitation === 'niggle') warnings.push('With a niggle, keep rides easy until it settles, check your bike fit, and stop if it hurts.');

  // Optional measurements; nothing is derived without them.
  let speed = null, ftp = null, maxHr = null;
  if (a?.speedKmh != null && a.speedKmh !== '') { if (a.speedKmh >= 8 && a.speedKmh <= 50) speed = a.speedKmh; else warnings.push('Average speed ignored: enter your usual average between 8 and 50 km/h.'); }
  if (a?.ftp != null && a.ftp !== '') { if (Number.isFinite(a.ftp) && a.ftp >= 50 && a.ftp <= 600) ftp = Math.round(a.ftp); else warnings.push('FTP ignored: enter a measured value between 50 and 600 W.'); }
  if (a?.maxHr != null && a.maxHr !== '') { if (Number.isInteger(a.maxHr) && a.maxHr >= 140 && a.maxHr <= 220) maxHr = a.maxHr; else warnings.push('Maximum heart rate ignored: enter a measured value between 140 and 220.'); }
  if (!ftp && !maxHr) notes.push('No measured FTP or maximum heart rate, so rides are by time and effort (how hard they should feel). No power zones are guessed.');
  if (!speed && setting !== 'indoor') notes.push('Without your usual average speed, outdoor rides are by time only; distances depend on terrain and wind anyway.');

  const goal = a?.goal;
  if (!['fitness', 'distance', 'event'].includes(goal)) problems.push('Choose a goal: fitness, a distance, or an event.');
  let targetKm = null;
  if (goal === 'distance' || goal === 'event') {
    if (!(a?.targetKm >= 5 && a.targetKm <= 400)) problems.push('Enter a target distance between 5 and 400 km.');
    else targetKm = a.targetKm;
  }

  let schedule = null;
  if (goal === 'event') {
    if (!isDateKey(a?.eventDate)) problems.push('Choose the event date.');
    else if (isDateKey(startDate)) {
      const daysTo = sDaysBetween(sFromKey(startDate), sFromKey(a.eventDate));
      if (daysTo < 0) problems.push('The event date is before the start date.');
      else if (daysTo < 21) problems.push(`The event is only ${daysTo} days away: too soon for a training plan. Keep riding as you are and take the last 2–3 days easy.`);
      else {
        let start = startDate, weeks = Math.ceil((daysTo + 1) / 7);
        if (weeks > 16) { weeks = 16; start = sKey(sAddDays(sFromKey(a.eventDate), -(16 * 7 - 1))); notes.push(`The event is more than 16 weeks away, so the plan starts on ${sessionDayText(start)}.`); }
        else if (weeks < 6) warnings.push(`Only ${weeks} weeks to the event: enough to sharpen up, not to build much endurance.`);
        schedule = { start, weeks, eventDate: a.eventDate };
      }
    }
  } else if (goal) {
    if (!RIDE_WEEK_OPTIONS.includes(a?.weeks)) problems.push('Choose a plan length.');
    else if (isDateKey(startDate)) schedule = { start: startDate, weeks: a.weeks, eventDate: null };
  }

  let plan = null;
  if (!problems.length) {
    const cap = Math.max(exp === 'new' ? 3 : exp === 'some' ? 4 : 5, Math.min(rides, 6));
    let R = Math.min(days.length, Math.max(2, Math.min(rides + 1, cap)));
    if (rides === 0) R = Math.min(days.length, 2);
    if (injury) R = Math.min(days.length, Math.max(2, Math.min(rides, cap)));
    const beginner = weeklyMin < 60;
    let startMin = injury ? weeklyMin * 0.75 : Math.min(Math.max(weeklyMin, R * 30), weeklyMin + 30);
    startMin = round5(startMin);
    if (!injury && startMin < R * 30) {
      R = Math.max(1, Math.floor(startMin / 30));
      notes.push(`Week 1 is ${rideTime(startMin)} (at most 30 minutes more than you ride now), so it has ${R === 1 ? 'one short ride' : `${R} short rides`}; rides are added as the weekly time grows.`);
    }
    const growthBase = beginner ? Math.max(startMin, Math.min(days.length, 3) * 30) : startMin;
    const peakMin = injury ? startMin : Math.max(startMin, Math.min(RIDE_PEAK[exp], growthBase * 1.6));
    let longCap = Math.max(RIDE_LONG_CAP[exp], Math.min(longestMin, startMin / 2));
    if (injury && longestMin > 0) longCap = Math.min(longCap, Math.max(30, longestMin * 0.75));
    if (startMin >= RIDE_PEAK[exp] && !injury) notes.push(`You already ride ${rideTime(startMin)} a week: the plan keeps that and focuses on structure and recovery.`);
    if (injury) notes.push(`Weeks are “Steady”: about ${rideTime(startMin)} a week (75% of your current ${rideTime(weeklyMin)}), long rides at most ${rideTime(longCap)}.`);
    plan = { rides: Math.min(days.length, Math.max(R, Math.min(rides + 1, cap), 2)), startRides: R, startMin, peakMin: round5(peakMin), days, longCap: round5(longCap) };
  }
  return { ok: !problems.length, problems, warnings, assumptions, notes, goal, targetKm, setting, speed, ftp, maxHr, base: { weeklyMin, rides, longestMin, experience: exp, injury }, schedule, plan };
}

/** "45 min", "1 h 30 min". */
function rideTime(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}

/* ---------- Sessions ---------- */

function makeRide(as, type, parts, title, objective, effortKey) {
  const min = parts.reduce((n, p) => n + (p.t === 'reps' ? p.n * p.min + (p.n - 1) * p.rest : p.t === 'openers' ? p.n * p.min * 2 : p.min || 0), 0);
  const steadyMin = parts.filter((p) => p.t === 'steady').reduce((n, p) => n + p.min, 0);
  const outdoor = as.setting !== 'indoor';
  const kmRange = as.speed && outdoor && (type === 'endurance' || type === 'long' || type === 'recovery')
    ? [Math.round(as.speed * 0.85 * (min / 60)), Math.round(as.speed * 1.05 * (min / 60))] : null;
  const range = (table, base) => (base ? table[effortKey].map((x, k) => (k === 0 && x === 0 ? 0 : Math.round(x * base))) : null);
  return {
    type, title, objective,
    targets: { ride: {
      min, parts, effortKey, effort: RIDE_EFFORT[effortKey], steadyMin,
      power: as.ftp && RIDE_FTP[effortKey] ? range(RIDE_FTP, as.ftp) : null,
      hr: as.maxHr && RIDE_HR[effortKey] ? range(RIDE_HR, as.maxHr) : null,
      kmRange, eventKm: type === 'event' ? as.targetKm : null, indoorOk: type === 'intervals' || type === 'recovery'
    } }
  };
}

function rideIntervals(as, kind, stage, weekMin, short) {
  const stages = RIDE_STAGES[kind];
  let [n, min] = stages[Math.min(stage, stages.length - 1)];
  const cap = Math.max(0.12 * weekMin, 15);
  while (n * min > cap && n > 2) n--;
  while (n * min > cap && min > 3) min -= kind === 'vo2' ? 1 : 2;
  if (short) n = Math.max(2, Math.round(n * 0.6));
  const rest = kind === 'vo2' ? min : 5;
  const label = { tempo: 'Tempo', sweetspot: 'Sweet spot', vo2: 'Hard intervals' }[kind];
  return makeRide(as, 'intervals', [{ t: 'wu', min: 15 }, { t: 'reps', n, min, rest, effortKey: kind }, { t: 'cd', min: 10 }], `${label} ${n} × ${min} min`,
    kind === 'vo2' ? 'Short hard efforts raise your top-end fitness. Recover fully between them.' : 'Sustained efforts that build the pace you can hold for longer. Even pressure throughout.', kind);
}

function buildRideWeeks(a, startDate) {
  const as = assessRide(a, startDate);
  if (!as.ok) throw new Error(as.problems.join(' '));
  const { weeks: N, start, eventDate } = as.schedule;
  const exp = as.base.experience, injury = as.base.injury;
  const startD = sFromKey(start), startDow = weekdayIndex(start);
  const longEvent = as.targetKm >= 100 || (as.speed && as.targetKm / as.speed >= 3);
  const taperWeeks = eventDate ? (longEvent && N >= 6 ? 2 : 1) : 1;
  let lastBuild = as.plan.startMin, peakReached = as.plan.startMin, lastLong = null, peakLong = 0, quality = 0;
  const weeks = [];
  for (let i = 1; i <= N; i++) {
    const inTaper = i > N - taperWeeks;
    const eventWeek = eventDate && i === N;
    const recovery = !inTaper && i % 4 === 0 && i < N - taperWeeks;
    let W;
    if (i === 1) W = as.plan.startMin;
    else if (inTaper) W = peakReached * (eventDate ? (i === N ? 0.6 : 0.8) : 0.7);
    else if (recovery) W = lastBuild * 0.7;
    else W = Math.min(as.plan.peakMin, lastBuild + Math.max(0.1 * lastBuild, 20));
    W = round5(W);
    if (!inTaper && !recovery) lastBuild = W;
    const Rw = Math.max(1, Math.min(as.plan.rides, Math.floor(W / 30 + 1e-9)));
    // Long ride
    const goalRide = as.targetKm != null; // distance or event goals lean a little more on the long ride
    const share = Rw >= 4 ? (goalRide ? 0.45 : 0.35) : Rw === 3 ? (goalRide ? 0.5 : 0.45) : Rw === 2 ? 0.6 : 1;
    const keep = (base) => Math.min(base, 0.5 * W);
    let long;
    if (lastLong == null) long = Math.min(as.plan.longCap, Math.max(W * share, keep(as.base.longestMin)), Math.max(as.base.longestMin, 30) + 15);
    else if (!recovery && !inTaper) long = Math.min(as.plan.longCap, lastLong + 20, Math.max(W * share, keep(lastLong)));
    else long = Math.min(W * share, as.plan.longCap, (peakLong || lastLong) * (recovery ? 0.75 : 0.7));
    long = Math.min(Math.max(30, Math.floor(long / 5) * 5), W); // rounded down, never above the limits
    if (!recovery && !inTaper) { lastLong = long; peakLong = Math.max(peakLong, long); }
    // Intervals
    let q = 0;
    if (!injury && exp !== 'new' && Rw >= 3 && W >= 150 && !recovery && !eventWeek && !(eventDate == null && i === N) && !(exp === 'some' && i === 1)) q = exp === 'experienced' && Rw >= 5 && W >= 360 && !inTaper && i > 1 ? 2 : 1;
    const recoveryRide = Rw >= 4 && !injury;
    const dayPlan = runDays(as.plan.days, Rw, a.longDay, eventWeek ? 0 : q);
    const dateOf = (d) => sKey(sAddDays(startD, (i - 1) * 7 + ((d - startDow + 7) % 7)));
    let slots = dayPlan.days.map((d) => ({ d, date: dateOf(d) })).sort((x, y) => (x.date < y.date ? -1 : 1));
    const sessions = [];
    if (eventWeek) {
      slots = slots.filter((s) => s.date < eventDate && sDaysBetween(sFromKey(s.date), sFromKey(eventDate)) >= 2).slice(-2);
      for (const s of slots) {
        const openers = exp !== 'new' && !injury && s === slots[slots.length - 1];
        sessions.push({ date: s.date, ...makeRide(as, 'endurance', openers ? [{ t: 'steady', min: 30, effortKey: 'endurance' }, { t: 'openers', n: 3, min: 1 }] : [{ t: 'steady', min: 40, effortKey: 'endurance' }], openers ? 'Easy ride + openers' : 'Easy ride', 'Keep the legs moving; save your energy for the event.', 'endurance') });
      }
      sessions.push({ date: eventDate, ...makeRide(as, 'event', [{ t: 'event', min: as.speed ? Math.round((as.targetKm / as.speed) * 60) : 0 }], `Event: ${as.targetKm} km`, 'Event day. Start easier than you feel like, eat and drink early and often.', 'event') });
    } else {
      const qs = [];
      for (let x = 0; x < q; x++) {
        const kinds = exp === 'experienced' ? ['sweetspot', 'vo2'] : ['tempo'];
        qs.push(rideIntervals(as, kinds[quality % kinds.length], Math.floor(quality / kinds.length), W, inTaper));
        quality++;
      }
      const qMin = qs.reduce((n, s) => n + s.targets.ride.min, 0);
      const easyN = Rw - 1 - q;
      const spare = W - long - qMin;
      const recN = recoveryRide && easyN >= 2 && spare >= 40 + 30 * (easyN - 1) ? 1 : 0;
      const recMin = recN ? 40 : 0;
      const endN = easyN - recN;
      let endMin = endN > 0 ? round5(Math.max(30, (W - long - qMin - recMin) / endN)) : 0;
      endMin = Math.min(endMin, Math.max(long, 30));
      let qIdx = 0, recUsed = 0;
      for (const s of slots) {
        if (s.d === dayPlan.long) {
          sessions.push({ date: s.date, ...makeRide(as, 'long', [{ t: 'steady', min: long, effortKey: 'endurance' }], 'Long ride', 'Builds endurance. Steady and easy; take food and water for anything over 90 minutes.', 'endurance') });
        } else if (dayPlan.quality.includes(s.d) && qIdx < qs.length) {
          sessions.push({ date: s.date, ...qs[qIdx++] });
        } else if (recUsed < recN && (s.d - dayPlan.long + 7) % 7 === 1) {
          recUsed++;
          sessions.push({ date: s.date, ...makeRide(as, 'recovery', [{ t: 'steady', min: recMin, effortKey: 'recovery' }], 'Recovery ride', 'Very easy spinning to loosen the legs after the long ride.', 'recovery') });
        } else {
          sessions.push({ date: s.date, ...makeRide(as, 'endurance', [{ t: 'steady', min: endMin, effortKey: 'endurance' }], 'Endurance ride', recovery ? 'Recovery week: keep it easy.' : 'Steady endurance riding builds most of your fitness.', 'endurance') });
        }
      }
    }
    sessions.sort((x, y) => (x.date < y.date ? -1 : 1));
    // Rounding must not push a week above its planned time: trim endurance rides by 5 minutes.
    const sum = () => sessions.filter((x) => x.type !== 'event').reduce((n, x) => n + x.targets.ride.min, 0);
    for (let g = 0; g < 30 && sum() > W + 2; g++) {
      const e = sessions.filter((x) => (x.type === 'endurance' || x.type === 'recovery') && x.targets.ride.parts[0].min > 30).sort((x, y) => y.targets.ride.min - x.targets.ride.min)[0];
      if (!e) {
        // Still over: drop one short easy ride (the week has more rides than its time supports).
        const drop = sessions.filter((x) => x.type === 'endurance' || x.type === 'recovery').sort((x, y) => x.targets.ride.min - y.targets.ride.min)[0];
        if (!drop || sessions.length <= 2) break;
        sessions.splice(sessions.indexOf(drop), 1);
        continue;
      }
      const parts = e.targets.ride.parts.map((p, k) => (k === 0 ? { ...p, min: p.min - 5 } : p));
      Object.assign(e, makeRide(as, e.type, parts, e.title, e.objective, e.targets.ride.effortKey));
    }
    const total = sum();
    if (!inTaper && !recovery) { lastBuild = Math.min(lastBuild, total); peakReached = Math.max(peakReached, total); }
    weeks.push({
      week: i,
      label: eventWeek ? 'Event week' : inTaper ? (eventDate ? 'Taper' : 'Lighter week') : recovery ? 'Recovery week' : injury ? 'Steady' : 'Build',
      ...(recovery ? { deload: true } : {}), ...(inTaper ? { taper: true } : {}),
      min: total,
      sessions: sessions.map((s, j) => ({ key: `w${i}-${j + 1}`, ...s }))
    });
  }
  return weeks;
}

function rideSummary(a, startDate) {
  const as = assessRide(a, startDate);
  let readiness = null;
  if (as.ok && as.targetKm) {
    const weeks = buildRideWeeks(a, startDate);
    const longest = Math.max(...weeks.flatMap((w) => w.sessions.filter((s) => s.type !== 'event').map((s) => s.targets.ride.min)));
    if (as.speed) {
      const need = (as.targetKm / as.speed) * 60;
      if (need > longest * 1.5) {
        const builds = `This plan builds up to rides of ${rideTime(longest)}, not to the full ${as.targetKm} km (about ${rideTime(need)} at your usual ${as.speed} km/h, about ${Math.round((need / longest) * 10) / 10} times your longest planned ride).`;
        readiness = { longest, needMin: Math.round(need), ratio: Math.round((need / longest) * 100) / 100, text: as.schedule.eventDate
          ? `${builds} That gap doesn't decide on its own whether you can finish; it means your training won't have covered that time on the bike. Consider a shorter route, a later event, or riding it at a gentle pace with stops.`
          : `${builds} Treat it as a step towards ${as.targetKm} km: follow it with another plan, and ride the full distance gently with stops the first time.` };
      }
    } else {
      readiness = { longest, needMin: null, ratio: null, text: `Without your usual average speed the plan can't tell how long ${as.targetKm} km takes you; long rides build to ${rideTime(longest)}. Add your speed to compare.`, note: true };
    }
  }
  return { sport: 'bike', goal: as.goal, targetKm: as.targetKm, setting: as.setting, speed: as.speed, ftp: as.ftp, maxHr: as.maxHr, base: as.base, plan: as.plan,
    notes: [...(readiness?.note ? [readiness.text] : []), ...as.notes], warnings: [...(readiness && !readiness.note ? [readiness.text] : []), ...as.warnings], assumptions: as.assumptions, eventDate: as.schedule?.eventDate || null, readiness: readiness && !readiness.note ? readiness : null };
}

registerPlanDefinition({ id: 'bike', version: 1, kind: 'bike', name: 'Cycling plan', build: buildRideWeeks, summarize: rideSummary });

/* ---------- Showing rides ---------- */

function ridePartsText(r) {
  const eff = (k) => ({ recovery: 'very easy', endurance: 'steady endurance', tempo: 'tempo', sweetspot: 'sweet spot', vo2: 'hard' }[k] || '');
  return r.parts.map((p) => {
    if (p.t === 'wu') return `Warm up: ${p.min} min easy, building gradually`;
    if (p.t === 'cd') return `Cool down: ${p.min} min easy`;
    if (p.t === 'steady') return `${rideTime(p.min)} ${eff(p.effortKey)}`;
    if (p.t === 'reps') return `${p.n} × ${p.min} min ${eff(p.effortKey)}, ${p.rest} min easy between`;
    if (p.t === 'openers') return `Then ${p.n} × ${p.min} min brisk, with easy spinning between`;
    if (p.t === 'event') return `${r.eventKm} km: the event${p.min ? ` (about ${rideTime(p.min)} at your usual speed)` : ''}`;
    return '';
  });
}

function rideDetailsHtml(r) {
  if (!r) return '';
  const du = isImperial() ? 'mi' : 'km';
  const f = isImperial() ? 1 / 1.609344 : 1;
  return `<div class="card card-pad run-detail sport-bike">
    <ol class="run-parts">${ridePartsText(r).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
    <div class="run-guide"><span class="rec-k">Effort</span><span>${esc(r.effort || '')}</span></div>
    ${r.power ? `<div class="run-guide"><span class="rec-k">Power</span><span>${r.power[0] ? `${r.power[0]}–` : 'under '}${r.power[1]} W (from your FTP)</span></div>` : ''}
    ${r.hr ? `<div class="run-guide"><span class="rec-k">Heart rate</span><span>${r.hr[0] ? `${r.hr[0]}–` : 'under '}${r.hr[1]} bpm</span></div>` : ''}
    ${r.kmRange ? `<div class="run-guide"><span class="rec-k">Outdoors</span><span>about ${Math.round(r.kmRange[0] * f)}–${Math.round(r.kmRange[1] * f)} ${du}: terrain and wind vary, so ride by time</span></div>` : ''}
    <div class="run-total">${r.min ? rideTime(r.min) : ''}${r.indoorOk ? ' · good on an indoor trainer' : ''}</div>
  </div>`;
}
