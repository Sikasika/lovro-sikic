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

/** The program's default setup answers. */
const programDefaults = (p) => ({ days: [...p.defaultDays], weeks: p.defaultWeeks, deload: 4 });

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
  if (!DELOAD_OPTIONS.some(([v]) => v === answers?.deload)) out.push('Choose how often to have a lighter week.');
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

/**
 * Point every planned exercise at an exercise in the library, by name (ignoring case);
 * missing ones are added to the library. Changes `plan` and `st`; returns the added names.
 */
function resolveProgramExercises(plan, st) {
  const added = [];
  const byName = new Map();
  (st.exercises || []).forEach((e) => { const k = String(e.name).trim().toLowerCase(); if (!byName.has(k) || (byName.get(k).archived && !e.archived)) byName.set(k, e); });
  for (const s of planSessions(plan)) {
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
      sets: Array.from({ length: Math.max(1, x.sets) }, () => ({ weight: '', reps: '', done: false })),
      planned: { sets: x.sets, min: x.min, max: x.max }
    }))
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
