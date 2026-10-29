'use strict';

/*
  Swimming plans: assessment and schedule. Pure (answers in, assessment / weeks out),
  registered as a plan definition ('swim') on the same plan core as strength and running.

  Answers (distances in the pool's unit, metres or yards; any optional field may be missing):
    goal 'fitness' | 'distance' | 'event'   targetDist  distance to swim continuously / event distance
    eventDate 'YYYY-MM-DD' (event)           weeks       length otherwise (6–12)
    poolLen 25 | 50, poolUnit 'm' | 'yd'
    contDist     longest swim without stopping now (required: it decides everything)
    pace100      seconds per 100 for that swim (optional; used only for swims of 200+)
    sessionsPerWeek, weeklyDist             current swimming (optional)
    days [0–6], experience 'new' | 'some' | 'experienced', limitation 'none' | 'niggle' | 'injury'

  Ability levels come from the longest continuous swim: starter (< 100), developing (< 400),
  intermediate (< 1500), advanced (1500+ with experience). They decide the session size, rest
  between repeats, drills (simple ones only for starters), and whether threshold sets appear
  (intermediate and advanced only).

  Rules
  - No single swim in a session (a repeat or a continuous swim) is longer than the swimmer's
    current continuous distance plus a small weekly step (starter 25, developing 50,
    intermediate 100, advanced 200 m), and the step only grows in build weeks. Swimmers who
    can't swim far yet get short repeats with rest, never long continuous swims.
  - Week 1 is at most the current week + 20% (or 200 m); swimmers not swimming now start with
    small sessions. Weekly distance then rises by at most 10% (or 100 m) to a peak of 1.6× the
    start and a cap for the level. Every 4th week is a recovery week (≈ 75%, no hard sets).
  - Events: taper (race week ≈ 60%; 1500+ also the week before ≈ 80%) and the event on its day.
  - Injury: about 75% of current distance held steady, easy and technique only.
  - Paces (per 100) only from a given pace for a continuous swim of 200+; otherwise effort.
  - Readiness: when the plan's longest continuous swim is shorter than the goal distance, the
    plan says so with the numbers (never a verdict on the event).

  Loaded after plans.js and programs.js; registers its plan when loaded.
*/

const SWIM_WEEK_OPTIONS = [6, 8, 10, 12];
const SWIM_SESSION_CAP = { starter: 3, developing: 3, intermediate: 4, advanced: 5 };
const SWIM_PEAK = { starter: 1500, developing: 3000, intermediate: 6000, advanced: 10000 }; // per week, metres
const SWIM_MIN_SESSION = { starter: 200, developing: 400, intermediate: 800, advanced: 1500 };
const SWIM_STEP = { starter: 25, developing: 50, intermediate: 100, advanced: 200 };
const SWIM_EST_PACE = { starter: 210, developing: 165, intermediate: 130, advanced: 105 }; // s/100 m, length estimates only
const SWIM_WU_MAX = { starter: 50, developing: 100, intermediate: 300, advanced: 400 }; // metres
const SWIM_CD_MAX = { starter: 50, developing: 100, intermediate: 200, advanced: 200 };
const SWIM_REST = { starter: 45, developing: 30, intermediate: 20, advanced: 15 }; // seconds between repeats
const SWIM_DRILLS = {
  starter: ['Kick with a board', 'Easy swim, focus on relaxed breathing'],
  developing: ['Kick with a board', 'Catch-up', 'Easy swim, focus on breathing every 2–3 strokes'],
  intermediate: ['Catch-up', 'Fingertip drag', 'Kick on your side'],
  advanced: ['6-kick switch', 'Single-arm', 'Fingertip drag', 'Catch-up']
};
const SWIM_EFFORT = {
  technique: 'Slow and smooth: focus on form, not speed.',
  easy: 'Easy: relaxed, about 3–4 out of 10. Rest longer whenever you need to.',
  steady: 'Steady: about 5–6 out of 10, comfortable but working.',
  threshold: 'Strong: about 7–8 out of 10, controlled; the same pace on every repeat.',
  race: 'Event effort: start steady, settle into a rhythm, finish strong.'
};

/** Sessions with a continuous swim: continuous distance is not the same as total distance with rests. */
const SWIM_CONT_TEXT = 'Swim the continuous part without stopping if you can. If you have to stop, rest briefly, finish the distance and note where you stopped: the continuous distance only counts if swum without stopping.';
const SWIM_EFFORT_CONT = { easy: 'Easy: relaxed, about 3–4 out of 10.' };

const swimLevel = (cont, exp) => (cont < 100 ? 'starter' : cont < 400 ? 'developing' : cont < 1500 || exp === 'new' ? 'intermediate' : 'advanced');

/** Check the answers; work out level, paces, start/peak volume and schedule. Distances in metres internally. */
function assessSwim(a, startDate, today = todayKey()) {
  const problems = [], warnings = [], assumptions = [], notes = [];
  const yd = a?.poolUnit === 'yd';
  const f = yd ? 0.9144 : 1; // pool unit → metres
  const L = (a?.poolLen === 25 || a?.poolLen === 50) && !(yd && a.poolLen === 50) ? a.poolLen * f : null;
  if (!L) problems.push('Choose your pool length (25 m, 50 m or 25 yd).');
  const days = Array.isArray(a?.days) ? [...new Set(a.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((x, y) => x - y) : [];
  if (days.length < 2) problems.push('Choose at least 2 days you can swim.');
  if (!isDateKey(startDate)) problems.push('Choose a start date.');
  else if (startDate < today) problems.push('The start date can\'t be in the past.');
  let exp = a?.experience;
  if (!['new', 'some', 'experienced'].includes(exp)) { exp = 'new'; assumptions.push('Swimming experience not given: the plan is built for a beginner.'); }
  const injury = a?.limitation === 'injury';

  // Ability: the longest continuous swim is required.
  const num0 = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const contU = num0(a?.contDist);
  let cont = contU == null ? null : contU * f;
  if (cont == null) problems.push('How far can you swim without stopping? The plan is built around it.');
  else if (L && cont < L - 0.01) problems.push(`This plan needs you to swim at least one length (${a.poolLen} ${yd ? 'yd' : 'm'}) without stopping. Lessons or a learn-to-swim class are the right start.`);
  else if (cont > 20000) problems.push('That continuous distance looks too long. Check the number.');

  // Current swimming (optional; conservative and labelled when missing)
  let sessions = Number.isInteger(a?.sessionsPerWeek) && a.sessionsPerWeek >= 0 && a.sessionsPerWeek <= 14 ? a.sessionsPerWeek : null;
  let weekly = num0(a?.weeklyDist) == null ? null : a.weeklyDist * f;
  if (cont != null && L) {
    if (weekly == null && sessions == null) {
      sessions = exp === 'new' ? 0 : 2;
      weekly = sessions * Math.max(SWIM_MIN_SESSION[swimLevel(cont, exp)], cont * 2);
      assumptions.push(sessions ? `Current swimming not given: assumed ${sessions} sessions of about ${swimText(weekly / sessions, a)} a week.` : 'Current swimming not given: assumed no regular swimming.');
    } else if (weekly == null) {
      weekly = sessions * Math.max(SWIM_MIN_SESSION[swimLevel(cont, exp)], cont * 2);
      assumptions.push(`Weekly distance not given: estimated at about ${swimText(weekly, a)} from your sessions.`);
    } else if (sessions == null) {
      sessions = weekly > 0 ? Math.max(1, Math.min(5, Math.round(weekly / Math.max(400, cont * 2)))) : 0;
      assumptions.push(`Sessions per week not given: assumed ${sessions}.`);
    }
    if (sessions === 0 && weekly > 0) problems.push('You entered a weekly distance but 0 sessions a week. Check your current swimming.');
    if (sessions > 0 && weekly === 0) problems.push('You entered sessions per week but no weekly distance. Check your current swimming.');
    if (weekly > 0 && cont > weekly + 0.01) problems.push('Your longest continuous swim is longer than your weekly distance. Enter a usual week and your longest swim without stopping.');
    if (weekly > 60000) problems.push('That weekly distance looks too high. Check the number.');
  }
  const level = cont != null ? swimLevel(cont, exp) : 'starter';
  if (injury && (weekly || 0) * 0.75 < 400) problems.push('You have a current injury and swim very little at the moment. Get cleared by a physiotherapist or doctor first; a plan can\'t safely be built from here.');
  if (injury) warnings.push('Only use this plan if you can swim without pain or have been cleared to swim by a physiotherapist or doctor. It keeps you at about 75% of your current swimming, easy and technique work only. Stop and get advice if pain returns.');
  else if (a?.limitation === 'niggle') warnings.push('With a niggle (often shoulders in swimming), keep everything easy until it settles, use a kickboard less if it strains, and stop if it hurts.');

  // Paces only from a real continuous swim of 200+ with a pace
  let paces = null;
  if (a?.pace100 != null && a.pace100 !== '') {
    const p = a.pace100;
    if (!(p > 0)) problems.push('Enter your pace per 100 as minutes:seconds, e.g. 2:10.');
    else if (p < 50) problems.push('That pace is faster than world-class swimmers. Check the time per 100.');
    else if (p > 360) warnings.push('That pace is very slow; the plan uses effort instead of pace numbers.');
    else if (contU < 200) notes.push('A pace from a swim shorter than 200 isn\'t reliable for training paces, so the plan goes by effort.');
    else paces = { easy: [p + 12, p + 20], steady: [p + 5, p + 12], threshold: [Math.max(40, p - 3), p + 2] };
  }
  if (!paces && !problems.length) notes.push('No usable pace, so sessions are by effort (how each swim should feel). Rest is always given as time at the wall.');

  // Goal distance
  const goal = a?.goal;
  if (!['fitness', 'distance', 'event'].includes(goal)) problems.push('Choose a goal: fitness, a distance, or an event.');
  let target = null;
  if (goal === 'distance' || goal === 'event') {
    const t = num0(a?.targetDist);
    if (!t) problems.push(`Enter the ${goal === 'event' ? 'event' : 'target'} distance.`);
    else if (L && (t * f < 2 * L - 0.01 || t * f > 10000)) problems.push('Enter a distance between two lengths and 10,000.');
    else target = t * f;
  }

  // Dates
  let schedule = null;
  if (goal === 'event') {
    if (!isDateKey(a?.eventDate)) problems.push('Choose the event date.');
    else if (isDateKey(startDate)) {
      const daysTo = sDaysBetween(sFromKey(startDate), sFromKey(a.eventDate));
      if (daysTo < 0) problems.push('The event date is before the start date.');
      else if (daysTo < 21) problems.push(`The event is only ${daysTo} days away: too soon for a training plan. Keep swimming as you are and take the last 2 days easy.`);
      else {
        let start = startDate, weeks = Math.ceil((daysTo + 1) / 7);
        if (weeks > 16) { weeks = 16; start = sKey(sAddDays(sFromKey(a.eventDate), -(16 * 7 - 1))); notes.push(`The event is more than 16 weeks away, so the plan starts on ${sessionDayText(start)}. Until then, keep up your current swimming.`); }
        else if (weeks < 6) warnings.push(`Only ${weeks} weeks to the event: enough to sharpen up, not to build much fitness.`);
        schedule = { start, weeks, eventDate: a.eventDate };
      }
    }
  } else if (goal) {
    if (!SWIM_WEEK_OPTIONS.includes(a?.weeks)) problems.push('Choose a plan length.');
    else if (isDateKey(startDate)) schedule = { start: startDate, weeks: a.weeks, eventDate: null };
  }

  // Sessions and volume
  let plan = null;
  if (cont != null && L && !problems.length) {
    const cap = Math.max(SWIM_SESSION_CAP[level], Math.min(sessions, 6));
    let S = Math.min(days.length, Math.max(2, Math.min(sessions + 1, cap)));
    if (injury) S = Math.min(days.length, Math.max(2, Math.min(sessions, cap)));
    const minS = SWIM_MIN_SESSION[level];
    let startW;
    if (injury) startW = weekly * 0.75;
    else if (weekly === 0) startW = S * minS;
    else startW = Math.min(Math.max(weekly, S * minS), weekly + Math.max(200, 0.2 * weekly));
    if (!injury && weekly > 0 && startW < S * minS) {
      S = Math.max(2, Math.min(S, Math.floor(startW / minS)));
      notes.push(`Week 1 is about ${swimText(startW, a)} (close to what you swim now), so it has ${S} sessions; sessions grow as the weekly distance does.`);
    }
    startW = roundTo(startW, 50);
    const peak = injury ? startW : Math.max(startW, Math.min(SWIM_PEAK[level], startW * 1.6));
    if (weekly === 0 && !injury) notes.push('You aren\'t swimming regularly now: sessions start small, with plenty of rest between short swims.');
    plan = { sessions: S, startW, peakW: roundTo(peak, 50), days, L, level, cont, target };
  }
  return { ok: !problems.length, problems, warnings, assumptions, notes, level, paces, base: { cont, weekly, sessions, experience: exp, injury }, schedule, plan, goal, pool: { len: a?.poolLen, unit: yd ? 'yd' : 'm', f } };
}

const roundTo = (x, step) => Math.round(x / step) * step;
/** Distance (metres) in the pool's unit, e.g. "1,500 m" / "820 yd". */
function swimText(m, a) {
  const yd = a?.poolUnit === 'yd' || a?.unit === 'yd';
  return `${Math.round(m / (yd ? 0.9144 : 1)).toLocaleString()} ${yd ? 'yd' : 'm'}`;
}

/* ---------- Sessions ---------- */

/**
 * One swim session of about v metres. `maxPiece` is the longest single swim allowed this week.
 * Parts (distances in pool units, multiples of a length):
 *   wu / cd {d}; drill {n, d, rest, drill}; set {n, d, rest, effort}; cont {d, effort}; race {d}
 */
function swimSession(as, type, v, maxPiece, k) {
  const { L, level } = as.plan;
  const u = as.pool.f; // metres per pool unit
  const len = Math.round(L / u); // pool length in pool units
  const lens = (m) => Math.max(1, Math.round(m / L)); // whole lengths
  const units = (n) => n * len;
  const maxLens = Math.max(1, Math.floor(maxPiece / L + 1e-9));
  const rest = SWIM_REST[level];
  const parts = [];
  const wuL = Math.min(lens(v * 0.15), lens(SWIM_WU_MAX[level]), maxLens);
  const cdL = Math.min(lens(v * 0.1), lens(SWIM_CD_MAX[level]), maxLens);
  let left = lens(v) - wuL - cdL;
  if (type !== 'race') parts.push({ t: 'wu', d: units(wuL) });
  if (type === 'technique' || (type === 'threshold' && level !== 'starter')) {
    const dL = level === 'starter' || level === 'developing' ? 1 : Math.min(2, maxLens);
    const n = Math.max(2, Math.min(8, Math.round((left * 0.35) / dL)));
    const drills = SWIM_DRILLS[level];
    parts.push({ t: 'drill', n, d: units(dL), rest: Math.max(rest, 20), drill: drills[k % drills.length] });
    left -= n * dL;
  }
  left = Math.max(1, left);
  if (type === 'technique' || type === 'easy') {
    const dL = Math.max(1, Math.min(maxLens, level === 'starter' ? 2 : level === 'developing' ? 4 : 8));
    parts.push({ t: 'set', n: Math.max(1, Math.round(left / dL)), d: units(dL), rest, effort: type === 'easy' ? 'easy' : 'steady' });
  } else if (type === 'endurance') {
    if (level === 'starter' || maxLens < 4) {
      // Repeats of the longest swim allowed this week, then what is left as one shorter swim.
      const n = Math.max(1, Math.floor(left / maxLens));
      parts.push({ t: 'set', n, d: units(maxLens), rest: rest + 15, effort: 'easy' });
      const remL = left - n * maxLens;
      if (remL >= 1) parts.push({ t: 'set', n: 1, d: units(remL), rest: 0, effort: 'easy' });
    } else {
      const contL = Math.min(maxLens, left);
      parts.push({ t: 'cont', d: units(contL), effort: 'easy' });
      const restL = left - contL;
      if (restL >= 2) { const dL = Math.min(maxLens, 4); parts.push({ t: 'set', n: Math.max(1, Math.round(restL / dL)), d: units(dL), rest, effort: 'steady' }); }
    }
  } else if (type === 'threshold') {
    const dL = Math.min(maxLens, Math.max(1, Math.round(100 / L)));
    parts.push({ t: 'set', n: Math.max(3, Math.min(16, Math.round((left * 0.8) / dL))), d: units(dL), rest: rest + 5, effort: 'threshold' });
    const restL = left - parts[parts.length - 1].n * dL;
    if (restL >= 2) parts.push({ t: 'set', n: 1, d: units(Math.min(restL, maxLens)), rest: 0, effort: 'easy' });
  } else if (type === 'race') {
    parts.push({ t: 'race', d: Math.round(maxPiece / u) });
  }
  if (type !== 'race') parts.push({ t: 'cd', d: units(cdL) });
  return parts;
}

const swimPartsUnits = (parts) => parts.reduce((n, p) => n + (p.n || 1) * p.d, 0);
const swimLongestPiece = (parts) => Math.max(0, ...parts.filter((p) => p.t !== 'race').map((p) => p.d));

function makeSwim(as, type, parts, title, objective, effortKey) {
  const f = as.pool.f;
  // A session with a continuous swim gets its own instructions; repeats-only sessions keep theirs.
  const hasCont = parts.some((p) => p.t === 'cont');
  if (hasCont && type !== 'race') {
    objective = `${objective.startsWith('Recovery week') ? 'Recovery week: keep it relaxed. ' : type === 'test' ? 'Your goal distance in one go, at an even, steady effort. ' : type === 'endurance' ? 'Builds the distance you can swim, easy and relaxed. ' : ''}${SWIM_CONT_TEXT}`;
  }
  const totalU = swimPartsUnits(parts);
  const restSec = parts.reduce((n, p) => n + (p.rest && p.n > 1 ? (p.n - 1) * p.rest : 0), 0);
  const pace = as.paces ? (as.paces.easy[0] + as.paces.easy[1]) / 2 : SWIM_EST_PACE[as.level] * f; // s per 100 pool units
  return {
    type, title, objective,
    targets: { swim: {
      pool: { len: as.pool.len, unit: as.pool.unit }, total: totalU, totalM: Math.round(totalU * f),
      estMin: Math.max(5, Math.round(((totalU / 100) * pace + restSec) / 60)), parts,
      effort: (hasCont && SWIM_EFFORT_CONT[effortKey]) || SWIM_EFFORT[effortKey], effortKey, pace: as.paces ? as.paces[effortKey] || null : null, paces: as.paces,
      longest: swimLongestPiece(parts)
    } }
  };
}

const SWIM_TYPES = {
  starter: ['technique', 'endurance', 'easy'],
  developing: ['technique', 'endurance', 'easy'],
  intermediate: ['technique', 'threshold', 'endurance', 'easy'],
  advanced: ['technique', 'threshold', 'endurance', 'threshold', 'easy']
};
const SWIM_WEIGHT = { technique: 1, endurance: 1.3, easy: 0.8, threshold: 1.1 };
const SWIM_TITLE = { technique: 'Technique swim', endurance: 'Endurance swim', easy: 'Easy swim', threshold: 'Threshold set' };
const SWIM_OBJECTIVE = {
  technique: 'Drills and smooth swimming: better technique makes every length easier.',
  endurance: 'Builds the distance you can swim. Easy and relaxed; rest at the wall whenever you need.',
  easy: 'Relaxed swimming to recover and keep the feel for the water.',
  threshold: 'Repeats at a strong, even effort with short rests. Builds speed you can hold.'
};

function buildSwimWeeks(a, startDate) {
  const as = assessSwim(a, startDate);
  if (!as.ok) throw new Error(as.problems.join(' '));
  const { weeks: N, start, eventDate } = as.schedule;
  const { L, level, cont, target } = as.plan;
  const injury = as.base.injury;
  const startD = sFromKey(start), startDow = weekdayIndex(start);
  const taperWeeks = eventDate ? (target >= 1500 && N >= 6 ? 2 : 1) : 1;
  const step = Math.max(L, SWIM_STEP[level]);
  const lensDown = (m) => Math.max(L, Math.floor(m / L + 1e-9) * L);
  let lastBuild = as.plan.startW, peakReached = as.plan.startW, maxPiece = lensDown(cont), k = 0, buildWeeks = 0;
  const weeks = [];
  for (let i = 1; i <= N; i++) {
    const inTaper = i > N - taperWeeks;
    const eventWeek = eventDate && i === N;
    const recovery = !inTaper && i % 4 === 0 && i < N - taperWeeks;
    let W;
    if (i === 1) W = as.plan.startW;
    else if (inTaper) W = peakReached * (eventDate ? (i === N ? 0.6 : 0.8) : 0.7);
    else if (recovery) W = lastBuild * 0.75;
    else W = Math.min(as.plan.peakW, lastBuild + Math.max(0.1 * lastBuild, 100));
    W = roundTo(W, 50);
    if (!inTaper && !recovery) lastBuild = W;
    // The longest single swim grows one step per build week (never with an injury), up to the goal.
    if (i > 1 && !inTaper && !recovery && !injury) { buildWeeks++; maxPiece = Math.min(lensDown(cont + step * buildWeeks), target ? Math.max(lensDown(cont), lensDown(target)) : Infinity); }
    // Sessions this week: fewer if the distance can't fill them at the level's minimum size.
    const S = Math.max(1, Math.min(as.plan.sessions, Math.floor(W / (SWIM_MIN_SESSION[level] * 0.75)) || 1));
    let types = SWIM_TYPES[level].slice(0, S);
    while (types.length < S) types.push('easy');
    if (injury || recovery || inTaper) types = types.map((t) => (t === 'threshold' ? 'technique' : t));
    const dayPlan = runDays(as.plan.days, S, null, 0);
    const dateOf = (d) => sKey(sAddDays(startD, (i - 1) * 7 + ((d - startDow + 7) % 7)));
    let slots = dayPlan.days.map((d) => ({ d, date: dateOf(d) })).sort((x, y) => (x.date < y.date ? -1 : 1));
    const sessions = [];
    if (eventWeek) {
      slots = slots.filter((s) => s.date < eventDate && sDaysBetween(sFromKey(s.date), sFromKey(eventDate)) >= 2).slice(-2);
      for (const s of slots) sessions.push({ date: s.date, ...makeSwim(as, 'easy', swimSession(as, 'easy', Math.min(W / Math.max(1, slots.length + 1), SWIM_MIN_SESSION[level]), maxPiece, k++), 'Easy swim', 'Short and relaxed: keep the feel for the water before the event.', 'easy') });
      sessions.push({ date: eventDate, ...makeSwim(as, 'race', swimSession(as, 'race', 0, target, 0), `Event: ${swimText(target, a)}`, 'Event day. Warm up gently if you can, start steady and settle into your rhythm.', 'race') });
    } else {
      // Spread the week's distance over the sessions by type weight; the endurance swim is the biggest.
      // In build weeks the endurance swim gets room for the week's longest swim; the other
      // sessions share what is left, so the week stays at its planned distance.
      const build = !recovery && !inTaper;
      const endV = build && !injury && level !== 'starter' && types.includes('endurance')
        ? Math.max((W * SWIM_WEIGHT.endurance) / types.reduce((n, t) => n + SWIM_WEIGHT[t], 0), Math.min(maxPiece + SWIM_WU_MAX[level] + SWIM_CD_MAX[level] + L, W * 0.5)) : null;
      const otherWeight = types.reduce((n, t) => n + (endV != null && t === 'endurance' ? 0 : SWIM_WEIGHT[t]), 0);
      const totalWeight = types.reduce((n, t) => n + SWIM_WEIGHT[t], 0);
      const lastWeek = !eventDate && i === N;
      const tryFull = lastWeek && target && !injury && maxPiece >= target - 0.01;
      slots.forEach((s, j) => {
        let type = types[j % types.length];
        if (tryFull && type === 'endurance') {
          const len = Math.round(L / as.pool.f);
          sessions.push({ date: s.date, ...makeSwim(as, 'test', [{ t: 'wu', d: 4 * len }, { t: 'cont', d: Math.round(target / as.pool.f), effort: 'steady' }, { t: 'cd', d: 2 * len }], `Continuous ${swimText(target, a)} (optional)`, 'Your goal distance in one go, at an even, steady effort.', 'steady') });
          return;
        }
        const v = endV != null ? (type === 'endurance' ? endV : ((W - endV) * SWIM_WEIGHT[type]) / otherWeight) : (W * SWIM_WEIGHT[type]) / totalWeight;
        sessions.push({ date: s.date, ...makeSwim(as, type, swimSession(as, type, v, maxPiece, k++), SWIM_TITLE[type], recovery ? 'Recovery week: keep it relaxed.' : SWIM_OBJECTIVE[type], type === 'technique' ? 'technique' : type === 'endurance' ? 'easy' : type) });
      });
    }
    sessions.sort((x, y) => (x.date < y.date ? -1 : 1));
    // Rounding to whole lengths must not push a week above its planned distance: drop one repeat
    // at a time from the biggest non-event session.
    const sumM = () => sessions.reduce((n, s) => n + s.targets.swim.totalM, 0);
    for (let g = 0; g < 80 && sumM() > W + L * 0.5; g++) {
      // Trim from the biggest session: a repeat, else a drill, else a length off a repeat swim or the
      // warm-up/cool-down. A continuous swim is shortened only when nothing else in the week can be,
      // so the endurance swim keeps the week's longest distance whenever possible.
      const cands = sessions.filter((s) => s.type !== 'race' && s.type !== 'test').sort((x, y) => y.targets.swim.totalM - x.targets.swim.totalM);
      let done = false;
      for (const allowCont of [false, true]) {
        for (const cand of cands) {
          const parts = cand.targets.swim.parts.map((p) => ({ ...p }));
          const len = Math.round(L / as.pool.f);
          const rep = parts.filter((x) => x.t === 'set' && x.n > 1).sort((x, y) => y.d - x.d)[0] || parts.find((x) => x.t === 'drill' && x.n > 2);
          const shortenable = parts.filter((x) => x.t === 'set' && x.d >= 3 * len).sort((x, y) => y.d - x.d)[0] || parts.find((x) => (x.t === 'wu' || x.t === 'cd') && x.d >= 2 * len)
            || (allowCont ? parts.find((x) => x.t === 'cont' && x.d >= 3 * len) : null);
          if (rep) rep.n -= 1; else if (shortenable) shortenable.d -= len; else continue;
          Object.assign(cand, makeSwim(as, cand.type, parts, cand.title, cand.objective, cand.targets.swim.effortKey));
          done = true;
          break;
        }
        if (done) break;
      }
      if (!done) break;
    }
    // A recovery week must be lighter: with sessions already at their smallest, drop one.
    if (recovery && sessions.length > 1 && sumM() >= lastBuild) sessions.splice(sessions.indexOf(sessions.slice().sort((x, y) => x.targets.swim.totalM - y.targets.swim.totalM)[0]), 1);
    const totalM = Math.round(sessions.reduce((n, s) => n + s.targets.swim.totalM, 0));
    if (!inTaper && !recovery) { lastBuild = Math.min(lastBuild, Math.max(totalM, as.plan.startW * 0.5)); peakReached = Math.max(peakReached, totalM); }
    weeks.push({
      week: i,
      label: eventWeek ? 'Event week' : inTaper ? (eventDate ? 'Taper' : 'Lighter week') : recovery ? 'Recovery week' : injury ? 'Steady' : 'Build',
      ...(recovery ? { deload: true } : {}), ...(inTaper ? { taper: true } : {}),
      m: totalM, maxPiece: Math.round(maxPiece),
      // The longest single swim actually in this week's sessions (it can be below the limit when
      // a session is capped at half the week): this is what readiness is judged on.
      longest: Math.round(Math.max(0, ...sessions.filter((s) => s.type !== 'race').map((s) => s.targets.swim.longest)) * as.pool.f),
      sessions: sessions.map((s, j) => ({ key: `w${i}-${j + 1}`, ...s }))
    });
  }
  return weeks;
}

/** Plan-level summary (saved with the plan) including the readiness note. */
function swimSummary(a, startDate) {
  const as = assessSwim(a, startDate);
  let readiness = null;
  if (as.ok && as.plan.target) {
    const weeks = buildSwimWeeks(a, startDate);
    const longest = Math.max(...weeks.flatMap((w) => w.sessions.filter((s) => s.type !== 'race').map((s) => s.targets.swim.longest))) * as.pool.f;
    if (longest + 0.01 < as.plan.target) {
      const times = `about ${Math.round((as.plan.target / longest) * 10) / 10} times your longest planned swim`;
      const builds = `This plan builds up to swims of ${swimText(longest, a)} without stopping, not to the full ${swimText(as.plan.target, a)} (${times}).`;
      readiness = { longest, target: as.plan.target, ratio: Math.round((as.plan.target / longest) * 100) / 100, text: as.schedule.eventDate
        ? `${builds} That gap doesn't decide on its own whether you can finish; it means your training won't have covered the distance in one go. Check whether the event allows rests (some let you change stroke or pause at the wall), and consider a shorter event or a later date.`
        : `${builds} Treat it as a step towards ${swimText(as.plan.target, a)}: follow it with another plan, and rest at the wall when you first try the full distance.` };
    }
  }
  return { sport: 'swim', goal: as.goal, target: as.plan?.target ?? null, level: as.level, paces: as.paces, base: as.base, plan: as.plan, pool: as.pool,
    notes: as.notes, warnings: [...(readiness ? [readiness.text] : []), ...as.warnings, ...(as.base.injury && as.schedule?.eventDate ? ['With a current injury, check with your physiotherapist or doctor before swimming the event itself.'] : [])], assumptions: as.assumptions, eventDate: as.schedule?.eventDate || null, readiness };
}

registerPlanDefinition({ id: 'swim', version: 1, kind: 'swim', name: 'Swim plan', build: buildSwimWeeks, summarize: swimSummary });

/* ---------- Showing swim sessions ---------- */

const swimPaceText = (r, unit) => (r ? `${fmtClock(r[0])}–${fmtClock(r[1])} /100 ${unit}` : '');
function swimPartsText(sw) {
  const u = sw.pool.unit;
  const pace = (eff) => (sw.paces && sw.paces[eff] ? ` (${swimPaceText(sw.paces[eff], u)})` : '');
  return sw.parts.map((p) => {
    if (p.t === 'wu') return `Warm up: ${p.d} ${u} easy, any stroke`;
    if (p.t === 'cd') return `Cool down: ${p.d} ${u} easy`;
    if (p.t === 'drill') return `Drills: ${p.n} × ${p.d} ${u} ${p.drill.toLowerCase()}, ${p.rest} s rest`;
    if (p.t === 'set') return `${p.n > 1 ? `${p.n} × ` : ''}${p.d} ${u} ${p.effort}${pace(p.effort)}${p.n > 1 ? `, ${p.rest} s rest` : ''}`;
    if (p.t === 'cont') return `${p.d} ${u} without stopping, ${p.effort}${pace(p.effort)}`;
    if (p.t === 'race') return `${p.d} ${u}: the event`;
    return '';
  });
}

function swimDetailsHtml(sw) {
  if (!sw) return '';
  return `<div class="card card-pad run-detail sport-swim">
    <ol class="run-parts">${swimPartsText(sw).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
    <div class="run-guide"><span class="rec-k">Effort</span><span>${esc(sw.effort || '')}</span></div>
    <div class="run-total">${esc(`${sw.total.toLocaleString()} ${sw.pool.unit}`)} · about ${sw.estMin} min in a ${sw.pool.len} ${sw.pool.unit} pool${sw.paces ? '' : ' (estimated; go by effort)'}</div>
  </div>`;
}
