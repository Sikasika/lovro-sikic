'use strict';

/*
  Built-in strength programs (library) and how a program becomes a plan.

  A program is a versioned definition: its workouts (exercises with sets and a rep range),
  the order they rotate in, and setup options (training days, length, lighter weeks).
  Starting one builds the whole schedule once and saves it as a plan (plans.js), so a
  later change to these definitions never changes a program already running.

  Schedule rules
  - Week n covers the 7 days from the start date + 7·(n−1). Sessions fall on the chosen
    weekdays inside that window, in date order; the workouts rotate across the whole
    program (Full Body: A, B, A, B, …; Upper/Lower: Upper A, Lower A, Upper B, Lower B).
  - Lighter week (optional): every 4th or 6th week has about a third fewer sets
    (3 → 2, 4 → 3), the same rep range and the advice to use about 10% less weight.
  - Rep ranges are per exercise (e.g. 5–8 for main lifts, 10–15 for accessories); they
    drive the weight recommendation for that exercise in program workouts (calc.js).

  Loaded after plans.js; registers its programs when loaded.

  Structured programs (one file each in programs/, added with registerStrengthProgram):
  a fixed number of weeks, each listing its own workouts in order, with per-week changes.
  Everything program-specific lives in the definition; scheduling, logging, history and
  statistics are shared. Definition format:

    {
      id, version, name, author?, level, summary,
      daysPerWeek, defaultDays: [weekday 0 = Monday, …],
      notes?: [text],                          // how to follow the program (shown before starting)
      blocks?: [{ name, from, to, note? }],    // week ranges, e.g. Block 1 = weeks 1–6
      workouts: { ID: { title, note?, exercises: [EXERCISE] } },
      weeks: [{ label?, note?, deload?: true, workouts: [ID, …],   // one entry per week, in order
                changes?: { ID: { 'Exercise name' | index | '*': { …EXERCISE fields } } } }]
    }
    EXERCISE: { name, category, sets, reps: n | [min, max], warmup?: n | [lo, hi],
                rir?: text | n | [lo, hi], rest?: seconds | [lo, hi], technique?: 'drop' |
                'myo' | 'failure' | text, dropSets?: n, note?, subs?: [names] }

  Each week needs exactly daysPerWeek workouts; sessions fall on the chosen days in order.
  The resolved targets are saved in the plan, so later edits never change a running plan.
*/

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // index 0 = Monday
const weekdayIndex = (key) => (sFromKey(key).getDay() + 6) % 7;

const STRENGTH_PROGRAMS = [
  {
    id: 'full-body-3', version: 1, kind: 'strength', name: 'Full Body 3×/week',
    level: 'Beginner to intermediate',
    summary: 'Three full-body workouts a week, alternating A and B. Every main muscle group is trained three times a week with moderate volume.',
    daysPerWeek: 3, defaultDays: [0, 2, 4], weekOptions: [4, 6, 8, 10, 12], defaultWeeks: 8,
    rotation: ['A', 'B'],
    workouts: {
      A: { title: 'Full Body A', exercises: [
        { name: 'Squat', category: 'Legs', sets: 3, min: 6, max: 10 },
        { name: 'Bench Press', category: 'Chest', sets: 3, min: 6, max: 10 },
        { name: 'Barbell Row', category: 'Back', sets: 3, min: 8, max: 12 },
        { name: 'Overhead Press', category: 'Shoulders', sets: 2, min: 8, max: 12 },
        { name: 'Hanging Leg Raise', category: 'Core', sets: 2, min: 10, max: 15 }] },
      B: { title: 'Full Body B', exercises: [
        { name: 'Romanian Deadlift', category: 'Legs', sets: 3, min: 8, max: 10 },
        { name: 'Overhead Press', category: 'Shoulders', sets: 3, min: 6, max: 10 },
        { name: 'Lat Pulldown', category: 'Back', sets: 3, min: 8, max: 12 },
        { name: 'Incline Dumbbell Press', category: 'Chest', sets: 3, min: 8, max: 12 },
        { name: 'Lunge', category: 'Legs', sets: 2, min: 10, max: 12 }] }
    }
  },
  {
    id: 'upper-lower-4', version: 1, kind: 'strength', name: 'Upper/Lower 4×/week',
    level: 'Intermediate',
    summary: 'Four workouts a week: two upper-body and two lower-body days. A heavier day (lower reps) and a volume day (higher reps) for each half.',
    daysPerWeek: 4, defaultDays: [0, 1, 3, 4], weekOptions: [4, 6, 8, 10, 12], defaultWeeks: 8,
    rotation: ['UA', 'LA', 'UB', 'LB'],
    workouts: {
      UA: { title: 'Upper A', exercises: [
        { name: 'Bench Press', category: 'Chest', sets: 4, min: 5, max: 8 },
        { name: 'Barbell Row', category: 'Back', sets: 4, min: 6, max: 10 },
        { name: 'Overhead Press', category: 'Shoulders', sets: 3, min: 6, max: 10 },
        { name: 'Lat Pulldown', category: 'Back', sets: 3, min: 8, max: 12 },
        { name: 'Barbell Curl', category: 'Arms', sets: 2, min: 10, max: 15 },
        { name: 'Tricep Pushdown', category: 'Arms', sets: 2, min: 10, max: 15 }] },
      LA: { title: 'Lower A', exercises: [
        { name: 'Squat', category: 'Legs', sets: 4, min: 5, max: 8 },
        { name: 'Romanian Deadlift', category: 'Legs', sets: 3, min: 8, max: 10 },
        { name: 'Leg Press', category: 'Legs', sets: 3, min: 10, max: 12 },
        { name: 'Leg Curl', category: 'Legs', sets: 3, min: 10, max: 15 },
        { name: 'Calf Raise', category: 'Legs', sets: 3, min: 10, max: 15 }] },
      UB: { title: 'Upper B', exercises: [
        { name: 'Incline Dumbbell Press', category: 'Chest', sets: 4, min: 8, max: 12 },
        { name: 'Seated Cable Row', category: 'Back', sets: 4, min: 8, max: 12 },
        { name: 'Pull-up', category: 'Back', sets: 3, min: 6, max: 10 },
        { name: 'Lateral Raise', category: 'Shoulders', sets: 3, min: 12, max: 15 },
        { name: 'Hammer Curl', category: 'Arms', sets: 2, min: 10, max: 15 },
        { name: 'Face Pull', category: 'Shoulders', sets: 2, min: 12, max: 15 }] },
      LB: { title: 'Lower B', exercises: [
        { name: 'Deadlift', category: 'Legs', sets: 3, min: 4, max: 6 },
        { name: 'Lunge', category: 'Legs', sets: 3, min: 8, max: 12 },
        { name: 'Leg Extension', category: 'Legs', sets: 3, min: 10, max: 15 },
        { name: 'Leg Curl', category: 'Legs', sets: 3, min: 10, max: 15 },
        { name: 'Hanging Leg Raise', category: 'Core', sets: 3, min: 10, max: 15 }] }
    }
  }
];

const DELOAD_OPTIONS = [[4, 'Every 4th week'], [6, 'Every 6th week'], [0, 'None']];
const OBJECTIVE_NORMAL = 'Work in the target rep range. When every working set reaches the top of the range, add weight next time.';
const OBJECTIVE_DELOAD = 'Lighter week: fewer sets and about 10% less weight than last week. Stop 2–3 reps short of failure.';
const deloadSets = (n) => Math.max(1, Math.ceil((n * 2) / 3));

/** The program's default setup answers (a structured program has its own weeks and lighter weeks). */
const programDefaults = (p) => ({ days: [...p.defaultDays], weeks: p.defaultWeeks, deload: p.fixedWeeks ? 0 : 4 });

/** Problems that stop a setup (messages), [] when it can start. */
function programSetupProblems(p, answers, startDate, today = todayKey()) {
  const out = [];
  const days = Array.isArray(answers?.days) ? answers.days : [];
  if (!isDateKey(startDate)) out.push('Choose a start date.');
  else if (startDate < today) out.push('The start date can\'t be in the past.');
  if (days.length !== p.daysPerWeek || new Set(days).size !== days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    out.push(`Choose exactly ${p.daysPerWeek} training days (${days.length} chosen).`);
  }
  if (!p.weekOptions.includes(answers?.weeks)) out.push('Choose the program length.');
  if (p.fixedWeeks ? answers?.deload !== 0 : !DELOAD_OPTIONS.some(([v]) => v === answers?.deload)) out.push('Choose how often to have a lighter week.');
  return out;
}

/** Advice about the chosen days (they can still be used). */
function programDayWarnings(p, days) {
  const set = new Set(days);
  const runs = []; // lengths of consecutive training days, the week wrapping round
  if (set.size === 7) runs.push(7);
  else {
    const start = [...Array(7).keys()].find((d) => !set.has(d));
    let n = 0;
    for (let k = 1; k <= 7; k++) {
      const d = (start + k) % 7;
      if (set.has(d)) n++; else { if (n) runs.push(n); n = 0; }
    }
  }
  const longest = Math.max(0, ...runs);
  if (p.daysPerWeek <= 3 && longest >= 2) return ['Full-body workouts on back-to-back days leave little time to recover; a rest day between them works better.'];
  if (longest >= 3) return [`${longest} training days in a row: a rest day in between helps recovery.`];
  return [];
}

/** Build the weeks of a program (pure; used through createPlan). */
function buildProgramWeeks(p, answers, startDate) {
  const days = [...answers.days].sort((a, b) => a - b);
  const start = sFromKey(startDate);
  const startDow = weekdayIndex(startDate);
  let k = 0;
  return Array.from({ length: answers.weeks }, (_, i) => {
    const n = i + 1;
    const deload = answers.deload > 0 && n % answers.deload === 0;
    const dates = days.map((d) => sAddDays(start, i * 7 + ((d - startDow + 7) % 7))).sort((a, b) => a - b);
    return {
      week: n,
      ...(deload ? { deload: true, label: 'Lighter week' } : {}),
      sessions: dates.map((date, j) => {
        const wid = p.rotation[k++ % p.rotation.length];
        const wk = p.workouts[wid];
        return {
          key: `w${n}-${j + 1}`,
          date: sKey(date),
          type: 'strength',
          title: wk.title,
          objective: deload ? OBJECTIVE_DELOAD : OBJECTIVE_NORMAL,
          targets: { workout: wid, ...(deload ? { deload: true } : {}), exercises: wk.exercises.map((x) => ({ name: x.name, category: x.category, sets: deload ? deloadSets(x.sets) : x.sets, min: x.min, max: x.max })) }
        };
      })
    };
  });
}

STRENGTH_PROGRAMS.forEach((p) => registerPlanDefinition({ ...p, build: (answers, startDate) => buildProgramWeeks(p, answers, startDate) }));
const findProgram = (id) => STRENGTH_PROGRAMS.find((p) => p.id === id) || null;

/* ---------- Structured programs (fixed weeks with their own workouts) ---------- */

/** Intensity techniques a program can name; other text is shown as it is. */
const STRENGTH_TECHNIQUES = {
  drop: { label: 'Drop set', hint: 'After the last working set, lower the weight and keep going for more reps.' },
  myo: { label: 'Myo-reps', hint: 'After the activation set, rest briefly and do short mini-sets with the same weight.' },
  failure: { label: 'Last set to failure', hint: 'Take the last working set to failure with good form.' }
};
const techniqueLabel = (t) => (t ? STRENGTH_TECHNIQUES[t]?.label || String(t) : '');

const isStructuredProgram = (p) => Array.isArray(p?.weeks);
const pairOf = (v) => (Array.isArray(v) ? [v[0], v[1] ?? v[0]] : v == null ? null : [v, v]);
const isWhole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** One exercise of a definition → the target saved in the plan (plain data; only set fields). */
function programExerciseTarget(x) {
  const [min, max] = pairOf(x.reps) || [x.min, x.max];
  const t = { name: x.name, category: x.category, sets: x.sets, min, max };
  const wu = pairOf(x.warmup);
  if (wu && wu[1] > 0) t.warmup = wu;
  if (x.rir != null && x.rir !== '') t.rir = Array.isArray(x.rir) ? `${x.rir[0]}–${x.rir[1]}` : String(x.rir);
  const rest = pairOf(x.rest);
  if (rest) { t.rest = rest; t.restSec = rest[0]; }
  if (x.technique) t.technique = String(x.technique);
  if (x.technique === 'drop') t.dropSets = x.dropSets || 1;
  if (x.note) t.note = String(x.note);
  if (Array.isArray(x.subs) && x.subs.length) t.subs = x.subs.map(String);
  return t;
}

/** The exercises of workout `id` in a week, with that week's changes applied (pure). */
function programWeekWorkout(p, week, id) {
  const wk = p.workouts[id];
  const ch = week.changes?.[id] || {};
  return {
    title: wk.title,
    note: wk.note,
    exercises: wk.exercises.map((x, i) => programExerciseTarget({ ...x, ...(ch['*'] || {}), ...(ch[i] || {}), ...(ch[x.name] || {}) }))
  };
}

/** Problems in a structured definition (for its author and the tests); [] when it is complete. */
function programDefinitionProblems(p) {
  const out = [];
  if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') return ['A program needs an id and a name.'];
  const at = (s) => `${p.name}: ${s}`;
  if (!isWhole(p.daysPerWeek, 1, 7)) out.push(at('daysPerWeek must be 1–7.'));
  if (!Array.isArray(p.defaultDays) || p.defaultDays.length !== p.daysPerWeek) out.push(at('defaultDays must list daysPerWeek weekdays.'));
  if (!p.workouts || !Object.keys(p.workouts).length) out.push(at('no workouts.'));
  if (!Array.isArray(p.weeks) || !p.weeks.length) out.push(at('no weeks.'));
  const checkEx = (x, where) => {
    const [min, max] = pairOf(x.reps) || [];
    if (!x.name || typeof x.name !== 'string') out.push(at(`${where}: exercise without a name.`));
    if (!isWhole(x.sets, 1, 50)) out.push(at(`${where} ${x.name}: sets must be 1–50.`));
    if (!isWhole(min, 1, 50) || !isWhole(max, 1, 50) || min > max) out.push(at(`${where} ${x.name}: reps must be a number or [min, max] within 1–50.`));
    const wu = pairOf(x.warmup);
    if (wu && !(isWhole(wu[0], 0, 10) && isWhole(wu[1], 0, 10) && wu[0] <= wu[1])) out.push(at(`${where} ${x.name}: warmup must be 0–10 or [lo, hi].`));
    const rest = pairOf(x.rest);
    if (rest && !(rest.every((v) => Number.isFinite(v) && v >= 0 && v <= 1800) && rest[0] <= rest[1])) out.push(at(`${where} ${x.name}: rest must be seconds (0–1800) or [lo, hi].`));
    if (x.technique === 'drop' && x.dropSets != null && !isWhole(x.dropSets, 1, 5)) out.push(at(`${where} ${x.name}: dropSets must be 1–5.`));
    if (x.subs != null && !(Array.isArray(x.subs) && x.subs.every((n) => typeof n === 'string' && n))) out.push(at(`${where} ${x.name}: subs must be a list of names.`));
  };
  Object.entries(p.workouts || {}).forEach(([id, w]) => {
    if (!w?.title || !Array.isArray(w.exercises) || !w.exercises.length) out.push(at(`workout ${id} needs a title and exercises.`));
    else w.exercises.forEach((x) => checkEx(x, `workout ${id}`));
  });
  (p.weeks || []).forEach((wk, i) => {
    const where = `week ${i + 1}`;
    if (!Array.isArray(wk.workouts) || wk.workouts.length !== p.daysPerWeek) { out.push(at(`${where} must list ${p.daysPerWeek} workouts.`)); return; }
    wk.workouts.forEach((id) => { if (!p.workouts?.[id]) out.push(at(`${where}: unknown workout ${id}.`)); });
    Object.entries(wk.changes || {}).forEach(([id, ch]) => {
      const w = p.workouts?.[id];
      if (!w) { out.push(at(`${where}: changes for unknown workout ${id}.`)); return; }
      if (!wk.workouts.includes(id)) out.push(at(`${where}: changes for ${id}, which is not in that week.`));
      Object.keys(ch).forEach((k) => { if (k !== '*' && !w.exercises[k] && !w.exercises.some((x) => x.name === k)) out.push(at(`${where} ${id}: changes for unknown exercise ${k}.`)); });
    });
    if (!out.length) wk.workouts.forEach((id) => programWeekWorkout(p, wk, id).exercises.forEach((x) => checkEx({ ...x, reps: [x.min, x.max] }, `${where} ${id}`)));
  });
  (p.blocks || []).forEach((b) => { if (!b?.name || !isWhole(b.from, 1, 99) || !isWhole(b.to, b.from, 99) || b.to > (p.weeks || []).length) out.push(at(`block ${b?.name || '?'} has invalid weeks.`)); });
  return out;
}

const programBlockOf = (p, n) => (p.blocks || []).find((b) => n >= b.from && n <= b.to) || null;

/** Build the weeks of a structured program (pure; used through createPlan). */
function buildStructuredWeeks(p, answers, startDate) {
  const days = [...answers.days].sort((a, b) => a - b);
  const start = sFromKey(startDate);
  const startDow = weekdayIndex(startDate);
  return p.weeks.map((wk, i) => {
    const n = i + 1;
    const block = programBlockOf(p, n);
    const label = [block?.name, wk.label].filter(Boolean).join(' · ');
    const dates = days.map((d) => sAddDays(start, i * 7 + ((d - startDow + 7) % 7))).sort((a, b) => a - b);
    return {
      week: n,
      ...(label ? { label } : {}),
      ...(wk.deload ? { deload: true } : {}),
      sessions: dates.map((date, j) => {
        const id = wk.workouts[j];
        const w = programWeekWorkout(p, wk, id);
        const objective = [wk.note, w.note].filter(Boolean).join(' ');
        return {
          key: `w${n}-${j + 1}`,
          date: sKey(date),
          type: 'strength',
          title: w.title,
          ...(objective ? { objective } : {}),
          targets: { workout: id, ...(wk.deload ? { deload: true } : {}), exercises: w.exercises }
        };
      })
    };
  });
}

/**
 * Add a structured program to the library. Throws on an incomplete definition, so a
 * mistake shows up at once (and in the tests) instead of in someone's schedule.
 */
function registerStrengthProgram(def) {
  const problems = programDefinitionProblems(def);
  if (problems.length) throw new Error(`Invalid program definition: ${problems.slice(0, 3).join(' ')}`);
  const p = { kind: 'strength', fixedWeeks: def.weeks.length, weekOptions: [def.weeks.length], defaultWeeks: def.weeks.length, ...def };
  STRENGTH_PROGRAMS.push(p);
  registerPlanDefinition({
    ...p,
    build: (answers, startDate) => buildStructuredWeeks(p, answers, startDate),
    summarize: () => ({ program: { author: p.author || null, notes: p.notes || [], blocks: (p.blocks || []).map((b) => ({ name: b.name, from: b.from, to: b.to, note: b.note || '' })) } })
  });
  return p;
}

/* ---------- Showing a planned exercise ---------- */

const restText = (r) => {
  const f = (sec) => (sec % 60 === 0 ? `${sec / 60}` : sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  const unit = r[0] % 60 === 0 && r[1] % 60 === 0 ? ' min' : '';
  return r[0] === r[1] ? `${f(r[0])}${unit}` : `${f(r[0])}–${f(r[1])}${unit}`;
};

/** "3 × 6–8 reps" plus the extras a structured program sets: warm-ups, RIR, rest, technique. */
function plannedTargetParts(x) {
  const reps = x.min === x.max ? `${x.min}` : `${x.min}–${x.max}`;
  const parts = [`${x.sets} × ${reps} reps`];
  if (x.warmup) parts.push(`${x.warmup[0] === x.warmup[1] ? x.warmup[0] : `${x.warmup[0]}–${x.warmup[1]}`} warm-up set${x.warmup[1] === 1 ? '' : 's'}`);
  if (x.rir) parts.push(`RIR ${x.rir}`);
  if (x.rest) parts.push(`Rest ${restText(x.rest)}`);
  if (x.technique) parts.push(techniqueLabel(x.technique) + (x.technique === 'drop' && x.dropSets > 1 ? ` ×${x.dropSets}` : ''));
  return parts;
}

/** Chips and notes for a planned exercise (review screens, session sheet). */
function plannedTargetHtml(x) {
  const parts = plannedTargetParts(x);
  const tech = x.technique && STRENGTH_TECHNIQUES[x.technique];
  return `<div class="rv-chips">${parts.map((t, i) => `<span class="chip ${i === 0 ? 'type-working' : 'type-extra'}">${esc(t)}</span>`).join(' ')}</div>
    ${x.note || tech ? `<div class="rv-note">${esc([tech?.hint, x.note].filter(Boolean).join(' '))}</div>` : ''}
    ${x.subs?.length ? `<div class="rv-note">Substitutes: ${esc(x.subs.join(', '))}</div>` : ''}`;
}

/**
 * Point every planned exercise at an exercise in the library, by name (ignoring case);
 * missing ones are added to the library. Changes `plan` and `st`; returns the added names.
 */
function resolveProgramExercises(plan, st) {
  const added = [];
  const byName = new Map();
  (st.exercises || []).forEach((e) => { const k = String(e.name).trim().toLowerCase(); if (!byName.has(k) || (byName.get(k).archived && !e.archived)) byName.set(k, e); });
  for (const s of planSessions(plan)) {
    if (s.targets?.run && !s.targets.run.exerciseId) s.targets.run.exerciseId = runExerciseId(st);
    if (s.targets?.swim && !s.targets.swim.exerciseId) s.targets.swim.exerciseId = sportExerciseId(st, 'Swimming');
    if (s.targets?.ride && !s.targets.ride.exerciseId) s.targets.ride.exerciseId = sportExerciseId(st, 'Cycling');
    for (const x of s.targets?.exercises || []) {
      if (x.exerciseId) continue;
      const k = x.name.trim().toLowerCase();
      let ex = byName.get(k);
      if (!ex) {
        ex = { id: uid(), name: x.name, category: x.category || 'Other' };
        st.exercises.push(ex); byName.set(k, ex); added.push(x.name);
      }
      x.exerciseId = ex.id;
    }
  }
  // planSessions returns copies of sessions but shares their targets, so the plan is updated.
  return added;
}

/**
 * Everything the review screen needs before starting: the plan (not yet saved), problems,
 * warnings (days, running plans) and same-day conflicts with a running sport plan.
 */
function previewProgram(p, answers, startDate, st = state, today = todayKey()) {
  const problems = programSetupProblems(p, answers, startDate, today);
  if (problems.length) return { ok: false, problems };
  const created = createPlan(PLAN_LIBRARY.get(p.id), answers, startDate, {});
  if (!created.ok) return { ok: false, problems: created.errors };
  const can = canStartPlan(st, p.kind, today);
  if (!can.ok) return { ok: false, problems: [can.error] };
  const trial = { ...st, plans: [...plansOf(st), created.plan] };
  const conflicts = planConflicts(trial, today).filter((c) => c.sessions.some((x) => x.planId === created.plan.id));
  return { ok: true, plan: created.plan, warnings: [...programDayWarnings(p, answers.days), ...can.warnings], conflicts };
}

/** Start a program: resolve exercises, save the plan. Returns { ok, plan?, error?, added }. */
function startProgram(p, answers, startDate, st = state, today = todayKey()) {
  const pv = previewProgram(p, answers, startDate, st, today);
  if (!pv.ok) return { ok: false, error: pv.problems.join(' ') };
  const added = resolveProgramExercises(pv.plan, st);
  const r = addPlan(st, pv.plan, today);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, plan: pv.plan, added, conflicts: r.conflicts };
}

/* ---------- From a planned session to the workout logger ---------- */

/**
 * A new workout in progress for a planned strength session: the planned exercises with
 * their number of empty sets, each entry carrying its target (entry.planned) for the
 * recommendation, the link to the session (plan), and what was planned (planned) for the
 * planned-vs-actual comparison later. Nothing else about logging changes.
 */
function plannedWorkout(plan, session) {
  if (session.targets?.run) return plannedRunWorkout(plan, session);
  if (session.targets?.swim || session.targets?.ride) return plannedSportWorkout(plan, session);
  const items = (session.targets?.exercises || []).filter((x) => x.exerciseId);
  return {
    id: uid(),
    name: session.title,
    templateId: null,
    start: new Date().toISOString(),
    notes: '',
    plan: { planId: plan.id, sessionKey: session.key },
    planned: {
      planName: plan.name, title: session.title, week: session.week ?? null, date: session.date, ...(session.targets?.deload ? { deload: true } : {}),
      items: items.map((x) => ({ exerciseId: x.exerciseId, sets: x.sets, min: x.min, max: x.max }))
    },
    entries: items.map((x) => ({
      exerciseId: x.exerciseId,
      sets: [
        ...Array.from({ length: x.warmup ? x.warmup[0] : 0 }, () => ({ weight: '', reps: '', type: 'warmup', done: false })),
        ...Array.from({ length: Math.max(1, x.sets) }, () => ({ weight: '', reps: '', done: false })),
        ...Array.from({ length: x.technique === 'drop' ? x.dropSets || 1 : 0 }, () => ({ weight: '', reps: '', type: 'drop', done: false }))
      ],
      planned: plannedEntryTarget(x)
    }))
  };
}

/** What a logged entry keeps of its planned exercise: the target plus any program extras. */
function plannedEntryTarget(x) {
  const t = { sets: x.sets, min: x.min, max: x.max };
  ['warmup', 'rir', 'rest', 'restSec', 'technique', 'dropSets', 'note', 'subs'].forEach((k) => { if (x[k] != null) t[k] = JSON.parse(JSON.stringify(x[k])); });
  return t;
}

/**
 * A run session in the logger: one Running entry with the planned distance (and estimated
 * time) as the set's target, and the session's targets in workout.planned for the comparison.
 */
function plannedRunWorkout(plan, session) {
  const run = session.targets.run;
  const exId = run.exerciseId || runExerciseId(state);
  return {
    id: uid(),
    name: session.title,
    templateId: null,
    start: new Date().toISOString(),
    notes: '',
    plan: { planId: plan.id, sessionKey: session.key },
    planned: {
      planName: plan.name, title: session.title, week: session.week ?? null, date: session.date, kind: 'run',
      run: (({ exerciseId, ...rest }) => JSON.parse(JSON.stringify(rest)))(run),
      items: [{ exerciseId: exId, run: true, type: session.type, distanceM: Math.round(run.km * 1000), durationSec: run.estMin * 60, ...(run.pace && ['easy', 'long'].includes(session.type) ? { paceLo: run.pace[0], paceHi: run.pace[1] } : {}) }]
    },
    entries: [{ exerciseId: exId, sets: [{ weight: '', reps: '', target: { distance: Math.round(run.km * 1000), duration: run.estMin * 60 }, done: false }] }]
  };
}

/** The library's exercise for a sport ('Running', 'Swimming', 'Cycling'), added if missing. */
function sportExerciseId(st, name) {
  const k = name.toLowerCase();
  const ex = st.exercises.find((e) => !e.archived && String(e.name).trim().toLowerCase() === k) || st.exercises.find((e) => String(e.name).trim().toLowerCase() === k);
  if (ex) return ex.id;
  const created = { id: uid(), name, category: 'Cardio' };
  st.exercises.push(created);
  return created.id;
}
const runExerciseId = (st) => sportExerciseId(st, 'Running');

/**
 * A swim or ride session in the logger: one Swimming / Cycling entry whose set carries the
 * planned distance (swim) or time (ride, plus distance when a usual speed was given) as its
 * target, and the session's targets in workout.planned for the comparison.
 */
function plannedSportWorkout(plan, session) {
  const swim = session.targets.swim, ride = session.targets.ride;
  const t = swim || ride;
  const exId = t.exerciseId || sportExerciseId(state, swim ? 'Swimming' : 'Cycling');
  const durationSec = Math.round((swim ? swim.estMin : ride.min) * 60);
  const distanceM = swim ? swim.totalM : ride.kmRange ? Math.round(((ride.kmRange[0] + ride.kmRange[1]) / 2) * 1000) : ride.eventKm ? Math.round(ride.eventKm * 1000) : null;
  const item = { exerciseId: exId, [swim ? 'swim' : 'ride']: true, type: session.type, durationSec, ...(distanceM ? { distanceM } : {}) };
  return {
    id: uid(), name: session.title, templateId: null, start: new Date().toISOString(), notes: '',
    plan: { planId: plan.id, sessionKey: session.key },
    planned: {
      planName: plan.name, title: session.title, week: session.week ?? null, date: session.date, kind: swim ? 'swim' : 'ride',
      [swim ? 'swim' : 'ride']: (({ exerciseId, ...rest }) => JSON.parse(JSON.stringify(rest)))(t),
      items: [item]
    },
    entries: [{ exerciseId: exId, sets: [{ weight: '', reps: '', target: { ...(durationSec ? { duration: durationSec } : {}), ...(distanceM ? { distance: distanceM } : {}) }, done: false }] }]
  };
}

/** Planned vs actual for a swim (distance first) or a ride (time first). */
function plannedVsActualSport(w) {
  const it = w.planned.items[0];
  const sets = w.entries.filter((e) => e.exerciseId === it.exerciseId).flatMap((e) => completedSets(e));
  const m = sets.reduce((n, s) => n + (num(s.distance) || 0), 0);
  const sec = sets.reduce((n, s) => n + (num(s.duration) || 0), 0);
  const swim = w.planned.kind === 'swim';
  const ratio = swim ? (it.distanceM ? m / it.distanceM : 0) : (it.durationSec ? sec / it.durationSec : 0) || (it.distanceM && m ? m / it.distanceM : 0);
  return {
    sport: swim ? 'swim' : 'ride', plannedM: it.distanceM || null, plannedSec: it.durationSec || null, doneM: m, doneSec: sec, type: it.type,
    status: !sets.length ? 'skipped' : ratio >= 0.9 ? 'done' : 'partial',
    pace100: swim && m > 0 && sec > 0 ? sec / (m / 100) : null,
    speed: !swim && m > 0 && sec > 0 ? (m / 1000) / (sec / 3600) : null,
    others: w.entries.filter((e) => e.exerciseId !== it.exerciseId && completedSets(e).length).map((e) => e.exerciseId)
  };
}

/** Planned vs actual for a run: distance (and time) against the plan; pace only for easy and long runs. */
function plannedVsActualRun(w) {
  const it = w.planned.items[0];
  const sets = w.entries.filter((e) => e.exerciseId === it.exerciseId).flatMap((e) => completedSets(e));
  const m = sets.reduce((n, s) => n + (num(s.distance) || 0), 0);
  const sec = sets.reduce((n, s) => n + (num(s.duration) || 0), 0);
  const pace = m > 0 && sec > 0 ? sec / (m / 1000) : null;
  const ratio = it.distanceM ? m / it.distanceM : 0;
  const paceCheck = pace == null || it.paceLo == null ? null : pace < it.paceLo - 5 ? 'faster' : pace > it.paceHi + 5 ? 'slower' : 'in range';
  return {
    run: true, plannedM: it.distanceM, plannedSec: it.durationSec, doneM: m, doneSec: sec, pace, paceLo: it.paceLo ?? null, paceHi: it.paceHi ?? null, paceCheck, type: it.type,
    status: !sets.length ? 'skipped' : ratio >= 0.9 ? 'done' : 'partial',
    others: w.entries.filter((e) => e.exerciseId !== it.exerciseId && completedSets(e).length).map((e) => e.exerciseId)
  };
}

/**
 * Planned vs actual for a workout done from a plan (workout.planned). One row per planned
 * exercise (matched by exercise, or by the exercise it was swapped from), then exercises
 * added on the day. Each row: { name, swappedFor?, sets done / planned, reps, inRange, status }.
 * status: 'done' (all planned sets), 'partial', 'skipped' (no sets), 'added'.
 */
function plannedVsActual(w) {
  if (!w?.planned || !Array.isArray(w.planned.items)) return null;
  if (w.planned.kind === 'run') return plannedVsActualRun(w);
  if (w.planned.kind === 'swim' || w.planned.kind === 'ride') return plannedVsActualSport(w);
  const used = new Set();
  const rows = w.planned.items.map((it) => {
    const idx = w.entries.findIndex((e, i) => !used.has(i) && (e.swappedFrom === it.exerciseId || (e.exerciseId === it.exerciseId && e.swappedFrom == null)));
    if (idx >= 0) used.add(idx);
    const e = idx >= 0 ? w.entries[idx] : null;
    const sets = e ? completedSets(e).filter((s) => setType(s) === 'working') : [];
    const reps = sets.map((s) => setR(s)).filter((r) => r > 0);
    const range = repRange({ min: it.min, max: it.max });
    return {
      exerciseId: it.exerciseId, plannedSets: it.sets, min: range.min, max: range.max,
      actualId: e ? e.exerciseId : null, swapped: !!e && e.exerciseId !== it.exerciseId,
      done: sets.length, reps,
      inRange: reps.length ? reps.every((r) => r >= range.min && r <= range.max) : null,
      status: !sets.length ? 'skipped' : sets.length >= it.sets ? 'done' : 'partial'
    };
  });
  const added = w.entries.map((e, i) => ({ e, i })).filter(({ i, e }) => !used.has(i) && completedSets(e).length)
    .map(({ e }) => ({ exerciseId: null, actualId: e.exerciseId, plannedSets: 0, done: completedSets(e).length, reps: [], status: 'added' }));
  const all = [...rows, ...added];
  return {
    rows: all,
    plannedSets: rows.reduce((n, r) => n + r.plannedSets, 0),
    doneSets: rows.reduce((n, r) => n + Math.min(r.done, r.plannedSets), 0),
    exercisesDone: rows.filter((r) => r.status !== 'skipped').length,
    swaps: rows.filter((r) => r.swapped).length
  };
}
