'use strict';

/*
  Running plans (5K and 10K): fitness assessment, training paces and the schedule.

  Everything here is pure (answers in, assessment / weeks out) and registered as two plan
  definitions, so a running plan uses the same plan core as strength programs: built once,
  saved as a snapshot, sessions linked to logged workouts, statuses worked out from data.

  Answers (all distances in km / metres, times in seconds; any field may be missing):
    distance '5k' | '10k'          targetSec   optional goal time
    eventDate 'YYYY-MM-DD' | null  weeks       length when there is no event (6–12)
    recent { distanceM, timeSec, ago: 'month' | 'quarter' | 'half' | 'older' } | null
    weeklyKm, runsPerWeek, longestKm   current training (average of the last few weeks)
    days [0–6, Monday = 0]         available running days (the others are rest days)
    longDay 0–6 | null             preferred long-run day
    experience 'new' | 'some' | 'experienced'
    limitation 'none' | 'niggle' | 'injury', limitationNote
    maxHr                          only if known (measured), for heart-rate guidance

  Fitness and paces
  - Current fitness comes only from a recent race or time trial: an equivalent 5K/10K time by
    Riegel's formula (T2 = T1 × (D2 / D1)^1.06), made a little slower for older results.
    Training paces are fractions of that 5K or 10K pace. A target time never sets paces; it
    is only compared with the current estimate (realistic / ambitious / unlikely).
  - Without a usable result the plan is effort-based (no pace numbers) and says so.

  Volume and structure (all relative to the runner's current training)
  - Week 1 starts at the current weekly distance (new runners: short run/walk sessions).
    Weekly distance then rises only while it is below a sensible peak for the distance and
    experience, by at most 10% or 1.5 km a week, and never above 1.6 × the starting volume.
    Runners already above that peak keep their volume. Beginners: week 1 is at most 1.5 km more
    than now, with fewer, short run/walk sessions if needed (runs are added as distance grows).
  - A current injury: about 75% of current volume held steady ("Steady" weeks), the long run
    at most 75% of the current longest, no hard sessions, strides or time trials. Injured and
    not running at all: no plan (get cleared to run first).
  - Every 4th week is a recovery week (about 75% of the previous week, no hard session).
  - The long run is about 30–50% of the week (depending on runs per week), grows by at most
    1.5 km a week and is capped for the distance and experience (or at the runner's current
    longest run, up to a third of the week, if that is more). It may stay at the runner's
    current longest run (up to 40% of the week) instead of dropping to the usual share.
  - Readiness: when the goal distance is more than 1.6× the plan's longest training run, the
    plan says so with the numbers (it never promises race readiness).
  - Quality sessions (intervals at 5K/10K pace, tempo) only for runners with some experience
    and at least 12 km a week (two only from 30 km), at most 8% (intervals) or 10% (tempo, but never under 10 minutes) of the week, never on the day after the long run
    when that can be avoided. New runners get strides instead; a current injury gets neither.
  - Event plans end with a taper (5K: race week ≈ 60%; 10K: the week before ≈ 80%, race week
    ≈ 55%) and the race on the event day. Plans without an event end with a lighter week and
    an optional time trial.

  Loaded after plans.js and programs.js; registers its plans when loaded.
*/

const RUN_GOALS = { '5k': { m: 5000, label: '5K' }, '10k': { m: 10000, label: '10K' } };
const RUN_WEEK_OPTIONS = [6, 8, 10, 12];
const RUN_MAX_WEEKS = 16;
const RUN_MIN_DAYS_TO_EVENT = 21;
const RIEGEL = 1.06;
const WORLD_BEST = { 5000: 12 * 60 + 35, 10000: 26 * 60 + 11 }; // anything faster is a typo
/** Sensible peak weekly km by goal and experience, and the long-run cap. */
const RUN_PEAK = { '5k': { new: 15, some: 25, experienced: 35 }, '10k': { new: 20, some: 30, experienced: 45 } };
const RUN_LONG_CAP = { '5k': { new: 6, some: 10, experienced: 12 }, '10k': { new: 9, some: 14, experienced: 16 } };
/** Assumed current training when the runner doesn't say (conservative, and labelled as such). */
const RUN_ASSUMED = { new: { weeklyKm: 0, runs: 0, longestKm: 0 }, some: { weeklyKm: 10, runs: 3, longestKm: 5 }, experienced: { weeklyKm: 20, runs: 3, longestKm: 8 } };
/** Pace (s/km) used only to estimate session length when there are no pace numbers. */
const RUN_EFFORT_PACE = { new: 450, some: 390, experienced: 345 };
/** Training paces as multiples of 5K (or 10K) race pace: [fast end, slow end]. */
const PACE_FACTORS = { easy: [1.22, 1.37], long: [1.25, 1.40], tempo: [1.06, 1.10], i5k: [0.98, 1.02], i10k: [0.99, 1.02], race: [1, 1] };
const EFFORT = {
  easy: 'Easy: conversational, about 3–4 out of 10. Slow down if you can\'t talk in full sentences.',
  long: 'Easy and steady, about 3–4 out of 10. Finish feeling you could have gone a bit further.',
  tempo: 'Comfortably hard, about 6–7 out of 10: you could say a few words, not hold a conversation.',
  i5k: 'Hard but controlled, about 8 out of 10: roughly the effort you could hold for a 5K race.',
  i10k: 'Strong, about 7–8 out of 10: roughly the effort you could hold for a 10K race.',
  race: 'Race effort. Start a little conservatively and pick it up in the second half.',
  strides: 'Strides: 20 seconds quick and relaxed (not a sprint), walk or jog back to recover.'
};
const HR_ZONES = { easy: [0.65, 0.78], long: [0.65, 0.78], tempo: [0.85, 0.90], i5k: [0.90, 0.95], i10k: [0.88, 0.93] };

const roundHalf = (km) => Math.round(km * 2) / 2;
const riegel = (t, d1, d2) => t * (d2 / d1) ** RIEGEL;
const ageFactor = { month: 1, quarter: 1.01, half: 1.03 };

/* ---------- Assessment ---------- */

/**
 * Check the answers and work out everything the plan is built from. Returns
 * { ok, problems (must be fixed or answered), warnings, assumptions, notes, fitness, goal, base,
 *   schedule, plan: { runs, startKm, peakKm } }.
 */
function assessRun(a, startDate, today = todayKey()) {
  const problems = [], warnings = [], assumptions = [], notes = [];
  const goal = RUN_GOALS[a?.distance];
  if (!goal) problems.push('Choose 5K or 10K.');
  const days = Array.isArray(a?.days) ? [...new Set(a.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((x, y) => x - y) : [];
  if (days.length < 2) problems.push('Choose at least 2 days you can run.');
  if (!isDateKey(startDate)) problems.push('Choose a start date.');
  else if (startDate < today) problems.push('The start date can\'t be in the past.');

  // Experience and limitations
  let exp = a?.experience;
  if (!['new', 'some', 'experienced'].includes(exp)) {
    exp = 'new';
    assumptions.push('Running experience not given: the plan is built for a beginner. Choose your experience for a better fit.');
  }
  const injury = a?.limitation === 'injury';
  if (injury) warnings.push('Only use this plan if you can run without pain or have been cleared to run by a physiotherapist or doctor. It keeps you at about 75% of your current running, with no hard sessions, strides or time trials. Stop and get advice if pain returns.');
  else if (a?.limitation === 'niggle') warnings.push('With a niggle, keep every run easy until it has settled, and skip hard sessions if it hurts. The plan increases volume slowly.');

  // Current training (partial answers are filled in conservatively and labelled)
  const given = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  let weeklyKm = given(a?.weeklyKm) ? a.weeklyKm : null;
  let runs = Number.isInteger(a?.runsPerWeek) && a.runsPerWeek >= 0 && a.runsPerWeek <= 14 ? a.runsPerWeek : null;
  let longestKm = given(a?.longestKm) ? a.longestKm : null;
  const assumedBase = RUN_ASSUMED[exp];
  if (weeklyKm == null && runs == null && longestKm == null) {
    ({ weeklyKm, runs, longestKm } = assumedBase);
    assumptions.push(`Current training not given: assumed ${weeklyKm ? `${weeklyKm} km a week over ${runs} runs, longest ${longestKm} km` : 'no regular running'} (a conservative guess for your experience). Enter it for a plan that fits.`);
  } else {
    if (weeklyKm == null) {
      weeklyKm = runs && longestKm ? Math.min(runs * longestKm, longestKm + (runs - 1) * longestKm * 0.7) : longestKm || 0;
      weeklyKm = roundHalf(weeklyKm);
      assumptions.push(`Weekly distance not given: estimated at ${weeklyKm} km from your other answers.`);
    }
    if (runs == null) {
      runs = weeklyKm > 0 ? Math.max(1, Math.min(5, Math.round(weeklyKm / 6))) : 0;
      assumptions.push(`Runs per week not given: assumed ${runs}.`);
    }
    if (longestKm == null) {
      longestKm = roundHalf(runs ? Math.min(weeklyKm, (weeklyKm / runs) * 1.3) : 0);
      assumptions.push(`Longest recent run not given: assumed ${longestKm} km.`);
    }
  }
  if (runs === 0 && weeklyKm > 0) problems.push('You entered a weekly distance but 0 runs a week. Check your current training.');
  if (runs > 0 && weeklyKm === 0) problems.push('You entered runs per week but no weekly distance. Check your current training.');
  if (longestKm > weeklyKm + 0.01 && weeklyKm > 0) problems.push('Your longest recent run is longer than your weekly distance. Enter your usual week (average of the last 3–4 weeks) and your longest single run.');
  if (runs > 0 && weeklyKm > 0 && longestKm + 0.5 < weeklyKm / runs) problems.push(`Your longest run (${fmtKm(longestKm)}) is shorter than your average run (${fmtKm(weeklyKm / runs)}: weekly distance ÷ runs). Check the three numbers.`);
  if (longestKm > 45 || weeklyKm > 200) problems.push('Those distances look too high. Check the numbers (kilometres per week).');
  if (runs > 0 && weeklyKm / runs > 25) warnings.push('That is a long average run. Check that the weekly distance is in kilometres per week.');
  if (exp === 'new' && weeklyKm > 25) notes.push('You run quite a lot for a beginner; consider choosing “Some experience”.');

  // Fitness from a recent result
  let fitness = { source: 'none', confidence: 'none', est: null, paces: null, hr: null };
  const r = a?.recent;
  if (r && (r.distanceM != null || r.timeSec != null)) {
    if (!(r.distanceM >= 1000 && r.distanceM <= 21100)) problems.push('Enter the distance of your recent race or time trial (1–21.1 km).');
    else if (!(r.timeSec > 0)) problems.push('Enter the time of your recent race or time trial.');
    else {
      const pace = r.timeSec / (r.distanceM / 1000);
      const best = riegel(WORLD_BEST[5000], 5000, r.distanceM);
      if (r.timeSec < best) problems.push('That result is faster than the world record. Check the time (for example 25:30 for 25 minutes 30 seconds).');
      else if (pace > 15 * 60) warnings.push('That result is slower than 15 min/km, which is walking pace. Paces are left out; the plan uses effort instead.');
      else if (r.ago === 'older') notes.push('Your result is more than 6 months old, so it isn\'t used for paces. Run a time trial and set up a new plan for pace guidance.');
      else {
        const f = ageFactor[r.ago] ?? 1.01;
        const t5 = riegel(r.timeSec, r.distanceM, 5000) * f;
        const t10 = riegel(r.timeSec, r.distanceM, 10000) * f;
        const far = r.distanceM < 3000 || r.distanceM > 15000;
        const confidence = r.ago === 'half' || far ? 'fair' : 'good';
        if (r.ago === 'half') notes.push('Your result is 3–6 months old: paces are set a little slower to allow for that.');
        if (far) notes.push(`Converting a ${fmtKm(r.distanceM / 1000)} result to ${goal ? goal.label : 'race'} pace is less reliable; treat the paces as a guide and go by effort too.`);
        const p5 = t5 / 5, p10 = t10 / 10;
        const range = (key) => {
          const base = key === 'i10k' ? p10 : key === 'race' ? (a.distance === '10k' ? p10 : p5) : p5;
          return [Math.round(base * PACE_FACTORS[key][0]), Math.round(base * PACE_FACTORS[key][1])];
        };
        fitness = {
          source: 'result', confidence, est: { '5k': Math.round(t5), '10k': Math.round(t10) },
          paces: Object.fromEntries(Object.keys(PACE_FACTORS).map((k) => [k, range(k)]))
        };
      }
    }
  }
  if (fitness.source === 'none' && !problems.length) {
    notes.push('No recent race or time-trial result, so this plan is effort-based: runs are described by how they should feel, not by pace. Paces are never taken from a target time.');
  }
  const hrOk = Number.isInteger(a?.maxHr) && a.maxHr >= 140 && a.maxHr <= 220;
  if (a?.maxHr != null && !hrOk) warnings.push('Maximum heart rate ignored: enter a measured value between 140 and 220.');
  if (hrOk) fitness.hr = Object.fromEntries(Object.entries(HR_ZONES).map(([k, [lo, hi]]) => [k, [Math.round(a.maxHr * lo), Math.round(a.maxHr * hi)]]));

  // Dates: event or length
  let schedule = null;
  const hasEvent = a?.eventDate != null && a.eventDate !== '';
  if (hasEvent && !isDateKey(a.eventDate)) problems.push('Choose a valid race date.');
  else if (hasEvent && isDateKey(startDate)) {
    const daysTo = sDaysBetween(sFromKey(startDate), sFromKey(a.eventDate));
    if (daysTo < RUN_MIN_DAYS_TO_EVENT) {
      problems.push(daysTo < 0 ? 'The race date is before the start date.' : `The race is only ${daysTo} days away: too soon for a training plan. Keep running as you are, take it easy for the last 2–3 days, and enjoy the race; or choose a later race.`);
    } else {
      let start = startDate, weeks = Math.ceil((daysTo + 1) / 7);
      if (weeks > RUN_MAX_WEEKS) {
        weeks = RUN_MAX_WEEKS;
        start = sKey(sAddDays(sFromKey(a.eventDate), -(RUN_MAX_WEEKS * 7 - 1)));
        notes.push(`The race is more than ${RUN_MAX_WEEKS} weeks away, so the plan starts on ${sessionDayText(start)} (${RUN_MAX_WEEKS} weeks before). Until then, keep up your current running.`);
      } else if (weeks < 6) warnings.push(`Only ${weeks} weeks to the race: enough to sharpen up, not to build much fitness. The plan keeps your volume close to what it is now.`);
      schedule = { start, weeks, raceDate: a.eventDate };
    }
  } else if (!hasEvent) {
    if (!RUN_WEEK_OPTIONS.includes(a?.weeks)) problems.push('Choose a race date or a plan length.');
    else if (isDateKey(startDate)) schedule = { start: startDate, weeks: a.weeks, raceDate: null };
  }

  // Runs per week, start and peak volume
  // Runs a week: one more than now at most, within a cap for the experience; never fewer than now (max 6).
  const cap = Math.max(exp === 'new' ? 3 : exp === 'some' ? 4 : (a?.distance === '10k' ? 6 : 5), Math.min(runs, 6));
  let planRuns = Math.min(days.length, Math.max(2, Math.min(runs + 1, cap)));
  if (runs === 0) planRuns = Math.min(days.length, 3);
  if (injury) planRuns = Math.min(days.length, Math.max(2, Math.min(runs, cap)));
  if (runs > planRuns && days.length < runs) notes.push(`You currently run ${runs} times a week but chose ${days.length} days: the plan fits your usual volume into ${planRuns} runs.`);
  const beginner = weeklyKm < 6;
  // Week 1 never asks for more than 1.5 km above the current week (beginners get shorter or
  // fewer run/walk sessions instead). With an injury: about 75% of the current week.
  let startKm = injury ? roundHalf(weeklyKm * 0.75) : beginner ? roundHalf(Math.min(Math.max(weeklyKm, planRuns * 2), weeklyKm + 1.5)) : roundHalf(weeklyKm);
  if (injury && weeklyKm * 0.75 < 2) problems.push(`You have a current injury and ${weeklyKm ? 'run very little at the moment' : 'aren\'t running at the moment'}. Get cleared to run by a physiotherapist or doctor first; a running plan can't safely be built from here.`);
  if (!injury && beginner && startKm < planRuns * 1.5) {
    const n = Math.max(1, Math.floor(startKm / 1));
    notes.push(`Week 1 is ${fmtKm(Math.max(startKm, 1))} (at most 1.5 km more than you run now), so it has ${n === 1 ? 'one short run/walk' : `${Math.min(n, planRuns)} short run/walk sessions`}; the plan adds runs as the weekly distance grows.`);
  }
  // Long-run limit: the table value, or what the runner already does (up to a third of the week).
  let longCap = goal ? Math.max(RUN_LONG_CAP[a.distance][exp], roundHalf(Math.min(longestKm, startKm / 3))) : 0;
  if (injury && longestKm > 0) longCap = Math.min(longCap, Math.max(1, Math.floor(longestKm * 0.75 * 2) / 2)); // at most 75% of the current longest
  // No single run longer than the long-run limit: with few runs a week that caps the week.
  const hardLikely = !injury && exp !== 'new' && planRuns >= 3 && weeklyKm >= 12;
  // In week 1 no run is longer than the long run, which starts at most 1 km above the current longest.
  const firstLong = Math.min(longCap, Math.max(longestKm, 2) + 1);
  const fits = goal ? (hardLikely ? (planRuns - 1) * firstLong + Math.min(firstLong, 0.1 * startKm + 3.5) : planRuns * firstLong) : startKm;
  if (startKm > fits) {
    notes.push(`With ${planRuns} runs a week, and no run in the first week longer than ${fmtKm(firstLong)}, the plan starts at about ${fmtKm(roundHalf(fits))} a week (you run ${fmtKm(startKm)} now) and builds from there. More running days would let it keep your full volume.`);
    startKm = roundHalf(fits);
  }
  const peakFor = goal ? RUN_PEAK[a.distance][exp] : startKm;
  // Peak: up to 1.6× the starting week (for beginners, 1.6× three short runs), reached only
  // through the weekly limits above; injured runners stay level.
  const growthBase = beginner ? Math.max(startKm, planRuns * 2) : startKm;
  let peakKm = injury ? startKm : Math.max(startKm, Math.min(peakFor, growthBase * 1.6));
  if (startKm >= peakFor && !injury) notes.push(`Your current ${fmtKm(startKm)} a week is already plenty for a ${goal ? goal.label : 'race'}: the plan keeps your volume and focuses on quality and recovery.`);
  if (beginner && !injury) notes.push('You are starting from little or no regular running: the early runs are short, and walking breaks are fine whenever you need them.');
  if (injury) notes.push(`Weeks are “Steady”: about ${fmtKm(startKm)} a week (75% of your current ${fmtKm(weeklyKm)}), long runs at most ${fmtKm(longCap)}. Set up a new plan once you are running pain-free.`);

  // Goal check (never used for paces)
  let goalCheck = { status: 'none' };
  if (a?.targetSec != null) {
    if (!(a.targetSec > 0)) problems.push('Enter the target time as minutes:seconds, e.g. 24:30.');
    else if (goal && a.targetSec < WORLD_BEST[goal.m]) problems.push('That target is faster than the world record. Check the time.');
    else if (!fitness.est || !goal) goalCheck = { status: 'unknown', text: 'Without a recent race or time-trial result the target can\'t be checked. The plan builds fitness by effort; run a time trial to see where you are.' };
    else {
      const cur = fitness.est[a.distance];
      const weeksN = schedule?.weeks || 8;
      const per = { new: 0.006, some: 0.004, experienced: 0.0025 }[exp];
      const capPct = { new: 0.12, some: 0.08, experienced: 0.05 }[exp];
      const realistic = Math.min(per * weeksN, capPct) * (injury ? 0.3 : 1);
      const needed = (cur - a.targetSec) / cur;
      const fmtT = (s) => fmtClock(s);
      if (needed <= 0) goalCheck = { status: 'reached', text: `Your estimated current ${goal.label} time is ${fmtT(cur)}, already at or faster than your target of ${fmtT(a.targetSec)}.` };
      else {
        const status = needed <= realistic ? 'realistic' : needed <= realistic * 2 ? 'ambitious' : 'unlikely';
        const pct = (x) => `${Math.round(x * 1000) / 10}%`;
        goalCheck = {
          status, neededPct: needed, realisticPct: realistic,
          text: `Your estimated current ${goal.label} time is ${fmtT(cur)}. ${fmtT(a.targetSec)} is ${pct(needed)} faster; as a rough guide, about ${pct(realistic)} is a realistic gain in ${weeksN} weeks for your experience (individual progress varies a lot). ${{
            realistic: 'The target looks realistic.',
            ambitious: 'The target is ambitious: possible with consistent training and a good day.',
            unlikely: 'The target is unlikely in this time. Consider a slower target or a later race; training harder than your current fitness allows raises the risk of injury.'
          }[status]} Training paces come from your current fitness, not the target.`
        };
        if (status === 'unlikely') warnings.push(`Target ${fmtT(a.targetSec)} is unlikely in ${weeksN} weeks (estimated now: ${fmtT(cur)}).`);
      }
    }
  }

  return {
    ok: !problems.length, problems, warnings, assumptions, notes, fitness, goal: goalCheck,
    base: { weeklyKm, runs, longestKm, experience: exp, injury },
    schedule, plan: { runs: planRuns, startKm, peakKm: roundHalf(peakKm), days, longCap }
  };
}

const fmtKm = (km) => `${Math.round(km * 10) / 10} km`;

/* ---------- Days ---------- */

/** Pick the running days (spread out, long run on the preferred day) and the quality days. */
function runDays(days, runs, longDay, quality) {
  const avail = [...days].sort((a, b) => a - b);
  const long = avail.includes(longDay) ? longDay : avail.includes(6) ? 6 : avail.includes(5) ? 5 : avail[avail.length - 1];
  const others = avail.filter((d) => d !== long);
  const gap = (a, b) => Math.min((a - b + 7) % 7, (b - a + 7) % 7);
  let best = null;
  const pick = (start, chosen) => {
    if (chosen.length === runs - 1) {
      const all = [...chosen, long].sort((a, b) => a - b);
      const gaps = all.map((d, i) => (all[(i + 1) % all.length] - d + 7) % 7 || 7);
      const score = Math.min(...gaps) * 100 - gaps.filter((g) => g === 1).length;
      if (!best || score > best.score) best = { score, chosen: [...chosen] };
      return;
    }
    for (let i = start; i < others.length; i++) pick(i + 1, [...chosen, others[i]]);
  };
  pick(0, []);
  const runDaysList = [...(best ? best.chosen : []), long].sort((a, b) => a - b);
  // Quality days: furthest from the long run, then from each other; never the day after the long run if avoidable.
  const qualityDays = [];
  for (let k = 0; k < quality; k++) {
    const cands = runDaysList.filter((d) => d !== long && !qualityDays.includes(d));
    cands.sort((a, b) => {
      const s = (d) => Math.min(gap(d, long), ...qualityDays.map((q) => gap(d, q))) * 10 - ((d - long + 7) % 7 === 1 ? 5 : 0);
      return s(b) - s(a) || a - b;
    });
    if (cands.length) qualityDays.push(cands[0]);
  }
  return { days: runDaysList, long, quality: qualityDays };
}

/* ---------- Sessions ---------- */

const INTERVAL_STAGES = { i5k: [[6, 400], [8, 400], [6, 600], [5, 800], [6, 800], [5, 1000]], i10k: [[5, 800], [6, 800], [4, 1200], [5, 1200], [4, 1600], [5, 1600]] };
const TEMPO_STAGES = [12, 15, 20, 20, 25, 30];

/** Effective pace (s/km) for a key: the plan's paces, or a typical effort pace to estimate length. */
function paceFor(as, key) {
  if (as.fitness.paces) { const [lo, hi] = as.fitness.paces[key]; return (lo + hi) / 2; }
  const easy = RUN_EFFORT_PACE[as.base.experience];
  return easy * { easy: 1, long: 1.03, tempo: 0.85, i5k: 0.78, i10k: 0.81, race: 0.8 }[key];
}

/** Length of a session in minutes, from its parts. */
function runMinutes(as, parts) {
  let s = 0;
  for (const p of parts) {
    if (p.t === 'easy' || p.t === 'wu' || p.t === 'cd') s += p.km * paceFor(as, p.paceKey || 'easy');
    else if (p.t === 'reps') s += p.n * (p.m / 1000) * paceFor(as, p.paceKey) + (p.n - 1) * p.jogSec;
    else if (p.t === 'tempo') s += p.min * 60;
    else if (p.t === 'race') s += p.km * paceFor(as, 'race');
    else if (p.t === 'strides') s += p.n * 60;
  }
  return Math.round(s / 60);
}
const partsKm = (as, parts) => Math.round(parts.reduce((km, p) => km + (p.km || 0) + (p.t === 'reps' ? p.n * p.m / 1000 + (p.n - 1) * 0.2 : 0) + (p.t === 'tempo' ? p.min * 60 / paceFor(as, 'tempo') : 0) + (p.t === 'strides' ? p.n * 0.1 : 0), 0) * 10) / 10;

function makeRun(as, type, parts, title, objective, mainKey) {
  const p = as.fitness.paces;
  return {
    type, title, objective,
    targets: { run: {
      km: partsKm(as, parts), estMin: runMinutes(as, parts), parts,
      main: mainKey, pace: p ? p[mainKey] : null, easyPace: p ? p.easy : null,
      hr: as.fitness.hr?.[mainKey] || null, effort: EFFORT[mainKey]
    } }
  };
}

function qualitySession(as, kind, stage, weekKm, short) {
  const wu = weekKm < 15 ? 1.5 : 2, cd = weekKm < 15 ? 1 : 1.5;
  if (kind === 'tempo') {
    const pace = paceFor(as, 'tempo');
    const capMin = Math.floor((Math.max(0.10 * weekKm, 1.6) * pace) / 60);
    let min = Math.max(10, Math.min(TEMPO_STAGES[Math.min(stage, TEMPO_STAGES.length - 1)], capMin));
    if (short) min = Math.max(10, Math.round(min * 0.6));
    return makeRun(as, 'tempo', [{ t: 'wu', km: wu }, { t: 'tempo', min, paceKey: 'tempo' }, { t: 'cd', km: cd }], `Tempo ${min} min`,
      'Builds the pace you can hold for longer: steady and controlled, never a race.', 'tempo');
  }
  const stages = INTERVAL_STAGES[kind];
  let [n, m] = stages[Math.min(stage, stages.length - 1)];
  const capKm = Math.max(0.08 * weekKm, 1.6);
  for (let i = Math.min(stage, stages.length - 1); n * m / 1000 > capKm && i > 0; i--) [n, m] = stages[i - 1];
  while (n * m / 1000 > capKm && n > 3) n--;
  // Still too much for a small week: shorter reps (at least 3 × 400 m).
  if (n * m / 1000 > capKm && m > 400) { m = 400; n = Math.max(3, Math.floor((capKm * 1000) / 400)); }
  if (short) n = Math.max(3, Math.round(n * 0.6));
  const jogSec = m <= 400 ? 90 : m <= 800 ? 120 : 150;
  return makeRun(as, 'intervals', [{ t: 'wu', km: wu }, { t: 'reps', n, m, paceKey: kind, jogSec }, { t: 'cd', km: cd }], `Intervals ${n} × ${m} m`,
    kind === 'i5k' ? 'Raises your top-end fitness at about 5K race effort. Keep every rep the same speed.' : 'Practises 10K race pace and builds speed endurance. Even pacing across the reps.', kind);
}

/* ---------- Building the weeks ---------- */

function buildRunWeeks(a, startDate) {
  const as = assessRun(a, startDate);
  if (!as.ok) throw new Error(as.problems.join(' '));
  const { weeks: N, start, raceDate } = as.schedule;
  const exp = as.base.experience, injury = as.base.injury;
  const R = as.plan.runs;
  const longCap = as.plan.longCap;
  const startD = sFromKey(start), startDow = weekdayIndex(start);
  const taperWeeks = raceDate ? (a.distance === '10k' && N >= 6 ? 2 : 1) : 1;
  let lastBuild = as.plan.startKm, lastLong = null, quality = 0, peakReached = as.plan.startKm, peakLong = 0;
  const weeks = [];
  for (let i = 1; i <= N; i++) {
    const inTaper = i > N - taperWeeks;
    const raceWeek = raceDate && i === N;
    const recovery = !inTaper && i % 4 === 0 && i < N - taperWeeks;
    // Weekly volume
    let km;
    if (i === 1) km = as.plan.startKm;
    else if (inTaper) km = peakReached * (raceDate ? (i === N ? (a.distance === '10k' ? 0.55 : 0.6) : 0.8) : 0.7);
    else if (recovery) km = lastBuild * 0.75;
    else km = Math.min(as.plan.peakKm, lastBuild + Math.max(0.1 * lastBuild, 1.5));
    if (!inTaper && !recovery) { lastBuild = km; peakReached = Math.max(peakReached, km); }
    km = roundHalf(km);

    // Runs this week: beginners on very little distance get fewer, short run/walk sessions
    // (at least 1 km each) instead of more distance.
    const minRun = as.plan.startKm < 6 ? 1 : km < 8 ? 1.5 : 2;
    const longMin = Math.min(1.5, km);
    const Rw = Math.max(1, Math.min(R, Math.floor((km - longMin) / minRun + 1e-9) + 1));

    // Long run: the usual share of the week, but it may stay at the current longest run
    // (up to 40% of the week) rather than drop; grows by at most 1.5 km a week.
    const share = Rw >= 4 ? 0.3 : Rw === 3 ? 0.36 : Rw === 2 ? 0.5 : 1;
    const keepLong = (base) => Math.min(base, 0.4 * km);
    let long;
    if (lastLong == null) long = Math.min(longCap, Math.max(km * share, keepLong(as.base.longestKm)), Math.max(as.base.longestKm, 2) + 1);
    else if (!recovery && !inTaper) long = Math.min(longCap, lastLong + 1.5, Math.max(km * share, keepLong(lastLong)));
    else long = Math.min(km * share, longCap, (peakLong || lastLong) * (recovery ? 0.8 : 0.75));
    long = Math.max(roundHalf(long), Math.min(1.5, km));
    if (!recovery && !inTaper) { lastLong = long; peakLong = Math.max(peakLong, long); }

    // Quality sessions this week
    let q = 0;
    if (!injury && Rw >= 3 && !recovery && !raceWeek && !(raceDate == null && i === N)) {
      if (exp === 'experienced') q = Rw >= 5 && i > 1 && !inTaper ? 2 : 1;
      else if (exp === 'some' && i > 1) q = 1;
      // Hard sessions need a base under them: 12+ km a week for one, 30+ for two.
      q = Math.min(q, km >= 30 ? 2 : km >= 12 ? 1 : 0);
    }
    const strides = !injury && !raceWeek && (exp !== 'new' || i >= 3) && q < 2;
    const sharpener = raceWeek && exp !== 'new' && !injury && peakReached >= 15; // only with a base for it

    // Days of this week
    const plan = runDays(as.plan.days, Rw, a.longDay, raceWeek ? (sharpener ? 1 : 0) : q);
    const dateOf = (d) => sKey(sAddDays(startD, (i - 1) * 7 + ((d - startDow + 7) % 7)));
    let slots = plan.days.map((d) => ({ d, date: dateOf(d) })).sort((x, y) => (x.date < y.date ? -1 : 1));
    const sessions = [];
    if (raceWeek) {
      // Race on the event day; before it only easy running (and a short sharpener ≥ 3 days out); nothing after.
      slots = slots.filter((s) => s.date < raceDate && sDaysBetween(sFromKey(s.date), sFromKey(raceDate)) >= 2);
      const sharpDay = sharpener ? slots.find((s) => sDaysBetween(sFromKey(s.date), sFromKey(raceDate)) >= 3 && plan.quality.includes(s.d)) || slots.find((s) => sDaysBetween(sFromKey(s.date), sFromKey(raceDate)) >= 3) : null;
      // Only as many easy runs as the week's remaining distance allows (at least one, 2 km or more).
      const spare = Math.max(0, km - RUN_GOALS[a.distance].m / 1000);
      const maxEasy = Math.max(1, Math.floor(spare / (as.plan.startKm < 6 ? 1.5 : 2)));
      const keep = new Set([sharpDay, ...slots.filter((x) => x !== sharpDay).slice(-maxEasy)].filter(Boolean));
      slots = slots.filter((x) => keep.has(x));
      const easyKm = roundHalf(Math.max(as.plan.startKm < 6 ? 1 : 2, Math.min(5, spare / Math.max(1, slots.length - (sharpDay ? 1 : 0)))));
      for (const s of slots) {
        if (s === sharpDay) {
          const n = a.distance === '10k' ? 4 : 5, m = a.distance === '10k' ? 400 : 200;
          sessions.push({ date: s.date, ...makeRun(as, 'intervals', [{ t: 'wu', km: 1.5 }, { t: 'reps', n, m, paceKey: 'race', jogSec: 90 }, { t: 'cd', km: 1 }], `Race-pace sharpener ${n} × ${m} m`, 'Short and sharp to feel race pace. Not tiring: stop with plenty left.', 'race') });
        } else {
          sessions.push({ date: s.date, ...makeRun(as, 'easy', [{ t: 'easy', km: easyKm, paceKey: 'easy' }], 'Easy run', 'Keep the legs moving; save your energy for race day.', 'easy') });
        }
      }
      sessions.push({ date: raceDate, ...makeRun(as, 'race', [{ t: 'race', km: RUN_GOALS[a.distance].m / 1000 }], `Race: ${RUN_GOALS[a.distance].label}`, 'Race day. Warm up with 10 minutes of easy jogging and a few strides. Start steady, finish strong.', 'race') });
    } else {
      // Plans without an event end with an optional time trial; not with a current injury.
      // ...and only when the goal distance is within reach of the longest run so far.
      const testWeek = !raceDate && i === N && !injury && RUN_GOALS[a.distance].m / 1000 <= Math.max(peakLong, 1) * 1.6 + 0.5;
      const gentleTest = testWeek && (exp === 'new' || lastBuild < 15);
      // With little volume or only 2 runs, the time trial takes the long run's place.
      const ttOnLong = testWeek && (gentleTest || Rw <= 2);
      const ttKm = testWeek ? RUN_GOALS[a.distance].m / 1000 + (gentleTest ? 0 : 3) : 0;
      let qIdx = 0;
      const qualitySessions = [];
      for (let k = 0; k < q; k++) {
        const kinds = a.distance === '5k' ? ['i5k', 'tempo'] : ['tempo', 'i10k'];
        const kind = kinds[quality % 2];
        // Sized against the distance this week can actually reach (runs are capped at the long run).
        const reachable = Math.min(km, long * Rw);
        qualitySessions.push(qualitySession(as, kind, Math.floor(quality / 2), reachable, inTaper));
        quality++;
      }
      const qKm = qualitySessions.reduce((n, s) => n + s.targets.run.km, 0);
      const easyCount = Rw - 1 - q - (testWeek && !ttOnLong ? 1 : 0);
      const minEasy = minRun;
      let easyKm = easyCount > 0 ? roundHalf(Math.max(minEasy, (km - (ttOnLong ? 0 : long) - qKm - ttKm) / easyCount)) : 0;
      easyKm = Math.min(easyKm, Math.max(long, minEasy));
      let stridesUsed = false;
      // The time trial (no-event plans) takes the place of a run 3+ days after the previous hard day, preferring a quality day.
      const ttSlot = !testWeek ? null : ttOnLong ? slots.find((s) => s.d === plan.long) : (slots.find((s) => plan.quality.includes(s.d)) || slots.filter((s) => s.d !== plan.long).slice(-1)[0] || slots[0]);
      for (const s of slots) {
        if (s === ttSlot && gentleTest) {
          sessions.push({ date: s.date, ...makeRun(as, 'time-trial', [{ t: 'easy', km: RUN_GOALS[a.distance].m / 1000, paceKey: 'easy' }], `${RUN_GOALS[a.distance].label} run (optional)`, `Cover the full ${RUN_GOALS[a.distance].label} at an easy, steady effort, with walk breaks if you need them. Note your time: it is your starting point for the next plan.`, 'easy') });
        } else if (s === ttSlot) {
          sessions.push({ date: s.date, ...makeRun(as, 'time-trial', [{ t: 'wu', km: 1.5 }, { t: 'race', km: RUN_GOALS[a.distance].m / 1000 }, { t: 'cd', km: 1.5 }], `${RUN_GOALS[a.distance].label} time trial (optional)`, `See where you are now: run ${RUN_GOALS[a.distance].label} at an even, hard effort. Use the result to set up your next plan with pace guidance.`, 'race') });
        } else if (s.d === plan.long) {
          sessions.push({ date: s.date, ...makeRun(as, 'long', [{ t: 'easy', km: long, paceKey: 'long' }], 'Long run', as.plan.startKm < 6 ? 'Your longest run of the week. Walk breaks are fine; keep it easy.' : 'Builds endurance. Easy effort the whole way; this is not a race.', 'long') });
        } else if (plan.quality.includes(s.d) && qIdx < qualitySessions.length) {
          sessions.push({ date: s.date, ...qualitySessions[qIdx++] });
        } else {
          const withStrides = strides && !stridesUsed && !inTaper && easyKm >= 2;
          stridesUsed = stridesUsed || withStrides;
          const parts = [{ t: 'easy', km: easyKm, paceKey: 'easy' }, ...(withStrides ? [{ t: 'strides', n: exp === 'new' ? 4 : 6 }] : [])];
          sessions.push({ date: s.date, ...makeRun(as, 'easy', parts, `Easy run${withStrides ? ' + strides' : ''}`, as.plan.startKm < 6 ? 'Short and easy. Mix in walking breaks whenever you need them.' : recovery ? 'Recovery week: keep it relaxed so your body can absorb the training.' : 'Easy running builds most of your fitness. Truly easy.', 'easy') });
        }
      }
    }
    sessions.sort((x, y) => (x.date < y.date ? -1 : 1));
    // Rounding must not push a week above its planned distance: trim easy runs by 0.5 km.
    const sum = () => sessions.reduce((n, x) => n + x.targets.run.km, 0);
    for (let guard = 0; guard < 20 && sum() > km + 0.1; guard++) {
      const e = sessions.filter((x) => x.type === 'easy' && x.targets.run.parts[0].km > (as.plan.startKm < 6 ? 1 : km < 8 ? 1.5 : 2)).sort((x, y) => y.targets.run.parts[0].km - x.targets.run.parts[0].km)[0];
      if (!e) break;
      const parts = e.targets.run.parts.map((p, k) => (k === 0 ? { ...p, km: p.km - 0.5 } : p));
      const strides = parts.some((p) => p.t === 'strides');
      Object.assign(e, makeRun(as, 'easy', parts, `Easy run${strides ? ' + strides' : ''}`, e.objective, 'easy'));
    }
    const total = Math.round(sessions.reduce((n, s) => n + s.targets.run.km, 0) * 10) / 10;
    // Next week's increase is measured from what this week actually holds.
    if (!inTaper && !recovery) { lastBuild = Math.min(lastBuild, total); peakReached = Math.max(as.plan.startKm, ...weeks.filter((x) => !x.deload && !x.taper).map((x) => x.km), total); }
    weeks.push({
      week: i,
      label: raceWeek ? 'Race week' : inTaper ? (raceDate ? 'Taper' : sessions.some((x) => x.type === 'time-trial') ? 'Lighter week · time trial' : 'Lighter week') : recovery ? 'Recovery week' : injury ? 'Steady' : 'Build',
      ...(recovery ? { deload: true } : {}),
      ...(inTaper ? { taper: true } : {}),
      km: total,
      sessions: sessions.map((s, j) => ({ key: `w${i}-${j + 1}`, ...s }))
    });
  }
  return weeks;
}

/** What is saved with the plan besides the weeks: the assessment it was built from. */
function runSummary(a, startDate) {
  const as = assessRun(a, startDate);
  const ready = as.ok ? runReadiness(a, buildRunWeeks(a, startDate), as.schedule?.raceDate) : null;
  return { goal: a.distance, fitness: as.fitness, goalCheck: as.goal, base: as.base, plan: as.plan, notes: as.notes, warnings: [...(ready ? [ready.text] : []), ...as.warnings], assumptions: as.assumptions, raceDate: as.schedule?.raceDate || null, readiness: ready };
}

/**
 * The goal distance against the plan's longest training run (races and time trials aside).
 * More than 1.6× apart: a warning with the numbers and what to consider. Never a promise.
 */
function runReadiness(a, weeks, raceDate) {
  const goal = RUN_GOALS[a.distance];
  const longest = Math.max(0, ...weeks.flatMap((w) => w.sessions.filter((s) => s.type !== 'race' && s.type !== 'time-trial').map((s) => s.targets.run.km)));
  const goalKm = goal.m / 1000;
  const ratio = longest > 0 ? goalKm / longest : Infinity;
  if (ratio <= 1.6) return null;
  const r = Number.isFinite(ratio) ? `${Math.round(ratio * 10) / 10}×` : 'far beyond';
  const shorter = a.distance === '10k' ? ' a 5K first,' : '';
  const text = raceDate
    ? `The race is ${goal.label} (${fmtKm(goalKm)}); the longest run in this plan is ${fmtKm(longest)}, so the race is ${r} longer. The plan doesn't make you race-ready for that distance. Consider${shorter} a later race, or plan on walk breaks during the race.`
    : `This plan builds to runs of ${fmtKm(longest)}; ${goal.label} (${fmtKm(goalKm)}) is ${r} that. It won't fully prepare you for ${goal.label}: follow it with another plan${a.distance === '10k' ? ', or aim for a 5K first' : ''}, and use walk breaks when you try the full distance.`;
  return { goalKm, longest, ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null, text };
}

Object.entries(RUN_GOALS).forEach(([id, g]) => registerPlanDefinition({
  id: `run-${id}`, version: 1, kind: 'run', name: `${g.label} plan`,
  build: (a, startDate) => buildRunWeeks({ ...a, distance: id }, startDate),
  summarize: (a, startDate) => runSummary({ ...a, distance: id }, startDate)
}));

/* ---------- Showing paces and sessions (current unit) ---------- */

/** "5:20–5:35 /km" (or /mi) for a pace range in s/km. */
function paceRangeText(range) {
  if (!range) return '';
  const f = isImperial() ? M_PER_MI / 1000 : 1;
  const [a, b] = range.map((s) => fmtClock(Math.round(s * f)));
  return `${a === b ? a : `${a}–${b}`} ${isImperial() ? '/mi' : '/km'}`;
}
/** "5.5 km" / "3.4 mi" (one decimal, in the selected unit). */
const runKmText = (km) => `${(Math.round((km / (isImperial() ? M_PER_MI / 1000 : 1)) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${isImperial() ? 'mi' : 'km'}`;

/** One line per part: "Warm up 2.00 km easy", "5 × 800 m at 4:50–5:00 /km, 2:00 easy jog between". */
function runPartsText(run) {
  const pace = (key) => (run.pace && key === run.main ? ` at ${paceRangeText(run.pace)}` : '');
  return run.parts.map((p) => {
    if (p.t === 'wu') return `Warm up: ${runKmText(p.km)} easy`;
    if (p.t === 'cd') return `Cool down: ${runKmText(p.km)} easy`;
    if (p.t === 'easy') return `${runKmText(p.km)} ${p.paceKey === 'long' ? 'easy, steady' : 'easy'}${run.pace && (p.paceKey === run.main) ? ` at ${paceRangeText(run.pace)}` : ''}`;
    if (p.t === 'reps') return `${p.n} × ${p.m} m${pace(p.paceKey)}, ${fmtClock(p.jogSec)} easy jog or walk between`;
    if (p.t === 'tempo') return `${p.min} min steady tempo${pace(p.paceKey)}`;
    if (p.t === 'strides') return `Then ${p.n} strides (20 s quick and relaxed)`;
    if (p.t === 'race') return `${runKmText(p.km)} at race effort${run.pace ? ` (about ${paceRangeText(run.pace)})` : ''}`;
    return '';
  });
}

/** A run session's instructions: parts, effort (and pace / heart rate when known), length. */
function runDetailsHtml(run) {
  if (!run) return '';
  return `<div class="card card-pad run-detail">
    <ol class="run-parts">${runPartsText(run).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
    <div class="run-guide"><span class="rec-k">Effort</span><span>${esc(run.effort || '')}</span></div>
    ${run.hr ? `<div class="run-guide"><span class="rec-k">Heart rate</span><span>${run.hr[0]}–${run.hr[1]} bpm</span></div>` : ''}
    ${run.main !== 'easy' && run.main !== 'long' && run.easyPace ? `<div class="run-guide"><span class="rec-k">Easy parts</span><span>${esc(paceRangeText(run.easyPace))}</span></div>` : ''}
    <div class="run-total">About ${esc(runKmText(run.km))} · ${run.estMin} min${run.pace ? '' : ' (estimated; go by effort)'}</div>
  </div>`;
}
