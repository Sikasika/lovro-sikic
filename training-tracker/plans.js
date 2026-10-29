'use strict';

/*
  Plans and programs: the core data and rules (no screens yet).

  A plan is stored in state.plans (optional; older data has none):
  {
    id, kind: 'strength' | 'run' | 'swim' | 'bike' | 'tri',
    name,
    source: { defId, defVersion, defName },   // the library definition it was made from
    answers: { ... },                          // the setup answers, as given
    startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD', eventDate?: 'YYYY-MM-DD',
    status: 'active' | 'stopped', stoppedOn?: 'YYYY-MM-DD',
    createdAt: ISO time,
    weeks: [{ week: 1, label?, deload?: true, sessions: [session] }],
    overrides: { [sessionKey]: { status?: 'skipped' | 'completed', date?: 'YYYY-MM-DD', at } }
  }
  session: { key (unique in the plan), date: 'YYYY-MM-DD', type, title, objective?, targets? }

  Rules
  - Snapshot: the schedule is built once when the plan starts and saved as plain data.
    The plan never looks at its library definition again, so app updates and changes to a
    definition can't change a plan in progress (planUpdateAvailable() only reports them).
  - Link: a saved workout done for a session carries workout.plan = { planId, sessionKey }.
    Nothing else stores "done": a session's status is worked out every time from
      1. a linked saved workout            → completed
      2. the workout in progress linked     → in-progress
      3. an explicit override               → completed (marked done without a workout) / skipped
      4. a stopped plan, from the stop day  → cancelled
      5. the date                           → missed (past) / today / upcoming
    so deleting a workout or restoring other data can never leave a wrong "completed".
  - No automatic shifting: a missed session stays missed on its day. Only moveSession()
    changes a date, for that one session.
  - At most one active strength program and one active sport plan (run, swim, bike or
    triathlon) at a time; sessions of both on the same day are reported as conflicts.

  Loaded after calc.js and before app.js; uses their globals only when called.
*/

const PLAN_KINDS = ['strength', 'run', 'swim', 'bike', 'tri'];
const planGroup = (kind) => (kind === 'strength' ? 'strength' : 'sport');
const PLAN_SESSION_STATUSES = ['completed', 'in-progress', 'skipped', 'cancelled', 'missed', 'today', 'upcoming'];

/* ---------- Library of definitions (code, not stored) ---------- */

/** Definitions by id. Each: { id, version (whole number ≥ 1), kind, name, build(answers, startDate) → weeks }. */
const PLAN_LIBRARY = new Map();

function registerPlanDefinition(def) {
  if (!def || typeof def.id !== 'string' || !Number.isInteger(def.version) || def.version < 1 ||
      !PLAN_KINDS.includes(def.kind) || typeof def.name !== 'string' || typeof def.build !== 'function') {
    throw new Error('Invalid plan definition');
  }
  PLAN_LIBRARY.set(def.id, def);
  return def;
}

/** A newer version of the definition this plan came from exists. Information only: the plan is never changed. */
function planUpdateAvailable(plan) {
  const def = PLAN_LIBRARY.get(plan?.source?.defId);
  return !!def && def.version > (plan.source.defVersion || 0);
}

/* ---------- Shape checks (shared by plan creation and backup restore) ---------- */

/** Problems with a stored plan, as messages; [] when it is fine. */
function planProblems(p, label = 'A plan') {
  const out = [];
  if (!isPlainObject(p)) return [`${label} is not in the expected format.`];
  const name = typeof p.name === 'string' && p.name.trim() ? `${label} (“${p.name}”)` : label;
  if (!(typeof p.id === 'string' && p.id.trim())) out.push(`${name} is missing its id.`);
  if (!PLAN_KINDS.includes(p.kind)) out.push(`${name} has an unknown type.`);
  if (!(typeof p.name === 'string' && p.name.trim())) out.push(`${name} has no name.`);
  if (!isDateKey(p.startDate) || !isDateKey(p.endDate) || p.endDate < p.startDate) out.push(`${name} has invalid start or end dates.`);
  if (p.eventDate != null && !isDateKey(p.eventDate)) out.push(`${name} has an invalid event date.`);
  if (!['active', 'stopped'].includes(p.status)) out.push(`${name} has an unknown status.`);
  if (p.stoppedOn != null && !isDateKey(p.stoppedOn)) out.push(`${name} has an invalid stop date.`);
  if (p.source != null && !isPlainObject(p.source)) out.push(`${name} has an invalid source.`);
  if (p.answers != null && !isPlainObject(p.answers)) out.push(`${name} has invalid setup answers.`);
  if (p.overrides != null && !isPlainObject(p.overrides)) out.push(`${name} has invalid session changes.`);
  if (!Array.isArray(p.weeks) || !p.weeks.length) { out.push(`${name} has no schedule.`); return out; }
  const keys = new Set();
  p.weeks.forEach((wk, i) => {
    if (!isPlainObject(wk) || !Array.isArray(wk.sessions)) { out.push(`${name}, week ${i + 1} is not in the expected format.`); return; }
    wk.sessions.forEach((s, j) => {
      const here = `${name}, week ${i + 1}, session ${j + 1}`;
      if (!isPlainObject(s)) { out.push(`${here} is not in the expected format.`); return; }
      if (!(typeof s.key === 'string' && s.key)) out.push(`${here} is missing its key.`);
      else if (keys.has(s.key)) out.push(`${here} repeats the key “${s.key}”.`);
      else keys.add(s.key);
      if (!isDateKey(s.date)) out.push(`${here} has no valid date.`);
      else if (isDateKey(p.startDate) && isDateKey(p.endDate) && (s.date < p.startDate || s.date > p.endDate)) out.push(`${here} is outside the plan's dates.`);
      if (!(typeof s.type === 'string' && s.type)) out.push(`${here} has no type.`);
      if (typeof s.title !== 'string') out.push(`${here} has no title.`);
      if (s.targets != null && !isPlainObject(s.targets)) out.push(`${here} has invalid targets.`);
    });
  });
  if (!keys.size) out.push(`${name} has no sessions.`);
  return out;
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const validPlanLink = (l) => isPlainObject(l) && typeof l.planId === 'string' && l.planId !== '' && typeof l.sessionKey === 'string' && l.sessionKey !== '';

/* ---------- Creating a plan (the snapshot) ---------- */

/**
 * Build a plan from a library definition. The schedule is generated now and copied as plain
 * data; nothing in the result refers back to the definition.
 * Returns { ok: true, plan } or { ok: false, errors }.
 */
function createPlan(def, answers, startDate, opts = {}) {
  if (!isDateKey(startDate)) return { ok: false, errors: ['Choose a start date.'] };
  let weeks;
  try {
    weeks = def.build(JSON.parse(JSON.stringify(answers || {})), startDate);
  } catch (e) {
    return { ok: false, errors: [e.message || 'The plan could not be built.'] };
  }
  weeks = JSON.parse(JSON.stringify(weeks || [])); // plain data only: no functions, no shared objects
  const dates = weeks.flatMap((w) => (Array.isArray(w?.sessions) ? w.sessions.map((s) => s?.date) : [])).filter(isDateKey).sort();
  const plan = {
    id: opts.id || uid(),
    kind: def.kind,
    name: (opts.name || def.name).trim(),
    source: { defId: def.id, defVersion: def.version, defName: def.name },
    answers: JSON.parse(JSON.stringify(answers || {})),
    startDate,
    endDate: dates.length ? dates[dates.length - 1] : startDate,
    ...(isDateKey(opts.eventDate) ? { eventDate: opts.eventDate } : {}),
    status: 'active',
    createdAt: (opts.now || new Date()).toISOString(),
    weeks,
    overrides: {}
  };
  const errors = planProblems(plan, 'The plan');
  return errors.length ? { ok: false, errors } : { ok: true, plan };
}

/* ---------- Reading plans ---------- */

const plansOf = (st = state) => (Array.isArray(st.plans) ? st.plans : []);
const findPlan = (st, planId) => plansOf(st).find((p) => p.id === planId) || null;
const planSessions = (plan) => plan.weeks.flatMap((w) => w.sessions.map((s) => ({ ...s, week: w.week ?? null })));
const findSession = (plan, key) => planSessions(plan).find((s) => s.key === key) || null;

/** 'upcoming' (starts later), 'active', 'finished' (past its last day) or 'stopped'. */
function planPhase(plan, today = todayKey()) {
  if (plan.status === 'stopped') return 'stopped';
  if (plan.startDate > today) return 'upcoming';
  if (plan.endDate < today) return 'finished';
  return 'active';
}
/** Plans that still have days to run: started or not, and not stopped. */
const runningPlans = (st, today = todayKey()) => plansOf(st).filter((p) => ['active', 'upcoming'].includes(planPhase(p, today)));

/** Saved workouts linked to this plan, by session key (earliest workout first). */
function planLinks(plan, st = state) {
  const map = new Map();
  [...(st.workouts || [])]
    .filter((w) => validPlanLink(w.plan) && w.plan.planId === plan.id)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .forEach((w) => { if (!map.has(w.plan.sessionKey)) map.set(w.plan.sessionKey, w); });
  return map;
}

/**
 * Every session of the plan with its status worked out (see the rules at the top).
 * Returns [{ ...session, originalDate, date (after a move), moved, status, workoutId, manual }].
 */
function sessionStatuses(plan, st = state, today = todayKey()) {
  const links = planLinks(plan, st);
  const active = st.active && validPlanLink(st.active.plan) && st.active.plan.planId === plan.id ? st.active.plan.sessionKey : null;
  const ov = plan.overrides || {};
  return planSessions(plan).map((s) => {
    const o = isPlainObject(ov[s.key]) ? ov[s.key] : {};
    const date = isDateKey(o.date) ? o.date : s.date;
    const w = links.get(s.key);
    let status;
    if (w) status = 'completed';
    else if (active === s.key) status = 'in-progress';
    else if (o.status === 'completed') status = 'completed';
    else if (o.status === 'skipped') status = 'skipped';
    else if (plan.status === 'stopped' && (!isDateKey(plan.stoppedOn) || date >= plan.stoppedOn)) status = 'cancelled';
    else status = date < today ? 'missed' : date === today ? 'today' : 'upcoming';
    return { ...s, originalDate: s.date, date, moved: date !== s.date, status, workoutId: w ? w.id : null, manual: !w && status === 'completed' };
  });
}

const sessionStatus = (plan, key, st = state, today = todayKey()) => sessionStatuses(plan, st, today).find((s) => s.key === key) || null;

/** Counts for a plan: week n of N and how its sessions stand so far. */
function planProgress(plan, st = state, today = todayKey()) {
  const list = sessionStatuses(plan, st, today);
  const count = (status) => list.filter((s) => s.status === status).length;
  const weeksTotal = plan.weeks.length;
  const weekIdx = plan.weeks.findIndex((w) => w.sessions.some((s) => s.date >= today));
  const started = today >= plan.startDate;
  return {
    week: !started ? 0 : weekIdx < 0 ? weeksTotal : weekIdx + 1,
    weeks: weeksTotal,
    total: list.length,
    completed: count('completed'),
    skipped: count('skipped'),
    missed: count('missed'),
    cancelled: count('cancelled'),
    // Sessions whose day has come (excluding cancelled ones): what "on track" is measured against.
    due: list.filter((s) => s.date <= today && s.status !== 'cancelled').length
  };
}

/** Sessions (any running plan) on a date, with their plan. */
function sessionsOn(st, date, today = todayKey()) {
  return runningPlans(st, today).flatMap((p) => sessionStatuses(p, st, today).filter((s) => s.date === date).map((s) => ({ plan: p, session: s })));
}

/* ---------- Starting plans side by side ---------- */

/**
 * Can a plan of this kind start? One strength program and one sport plan may run together.
 * Returns { ok, error?, warnings[] }.
 */
function canStartPlan(st, kind, today = todayKey()) {
  const running = runningPlans(st, today);
  const same = running.find((p) => planGroup(p.kind) === planGroup(kind));
  if (same) {
    return { ok: false, error: `“${same.name}” is already running. Stop it first: one ${planGroup(kind) === 'strength' ? 'strength program' : 'sport plan'} at a time.`, warnings: [] };
  }
  const warnings = [];
  if (kind === 'strength' && running.some((p) => p.kind === 'tri')) warnings.push('Your triathlon plan already includes strength sessions; a separate program adds to that load.');
  if (kind === 'tri' && running.some((p) => p.kind === 'strength')) warnings.push('Triathlon plans include their own strength sessions; consider stopping your strength program.');
  return { ok: true, warnings };
}

/** Days (today onwards) with sessions from more than one running plan. */
function planConflicts(st, today = todayKey()) {
  const byDate = new Map();
  for (const p of runningPlans(st, today)) {
    for (const s of sessionStatuses(p, st, today)) {
      if (s.date < today || ['completed', 'skipped', 'cancelled'].includes(s.status)) continue;
      const list = byDate.get(s.date) || [];
      list.push({ planId: p.id, planName: p.name, key: s.key, title: s.title, type: s.type });
      byDate.set(s.date, list);
    }
  }
  return [...byDate.entries()]
    .filter(([, list]) => new Set(list.map((x) => x.planId)).size > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, sessions]) => ({ date, sessions }));
}

/** Add a created plan to the data (checks the one-strength + one-sport rule). Returns { ok, error?, warnings, conflicts }. */
function addPlan(st, plan, today = todayKey()) {
  const can = canStartPlan(st, plan.kind, today);
  if (!can.ok) return { ok: false, error: can.error, warnings: [] };
  if (!Array.isArray(st.plans)) st.plans = [];
  st.plans.push(plan);
  const conflicts = planConflicts(st, today).filter((c) => c.sessions.some((x) => x.planId === plan.id));
  return { ok: true, warnings: can.warnings, conflicts };
}

/* ---------- Changing a session (one session at a time; nothing else moves) ---------- */

function sessionFor(st, planId, key) {
  const plan = findPlan(st, planId);
  if (!plan) return { error: 'This plan no longer exists.' };
  const session = findSession(plan, key);
  if (!session) return { error: 'This session is not in the plan.' };
  return { plan, session };
}
const setOverride = (plan, key, patch) => {
  if (!isPlainObject(plan.overrides)) plan.overrides = {};
  const next = { ...(plan.overrides[key] || {}), ...patch, at: new Date().toISOString() };
  Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
  if (Object.keys(next).every((k) => k === 'at')) delete plan.overrides[key]; else plan.overrides[key] = next;
};

/** Skip a session (it stays on its day, marked skipped). */
function skipSession(st, planId, key, today = todayKey()) {
  const { plan, error } = sessionFor(st, planId, key);
  if (error) return { ok: false, error };
  const s = sessionStatus(plan, key, st, today);
  if (s.workoutId) return { ok: false, error: 'This session has a logged workout. Unlink the workout first.' };
  if (s.status === 'in-progress') return { ok: false, error: 'This session is in progress.' };
  setOverride(plan, key, { status: 'skipped' });
  return { ok: true };
}

/** Mark a session done without logging a workout (e.g. done elsewhere). Not for future days. */
function markSessionDone(st, planId, key, today = todayKey()) {
  const { plan, error } = sessionFor(st, planId, key);
  if (error) return { ok: false, error };
  const s = sessionStatus(plan, key, st, today);
  if (s.workoutId) return { ok: false, error: 'This session already has a logged workout.' };
  if (s.date > today) return { ok: false, error: 'A session can\'t be marked done before its day.' };
  if (s.status === 'in-progress') return { ok: false, error: 'This session is in progress.' };
  setOverride(plan, key, { status: 'completed' });
  return { ok: true };
}

/** Remove a skip or a manual "done" (the status is worked out again). */
function clearSessionStatus(st, planId, key) {
  const { plan, error } = sessionFor(st, planId, key);
  if (error) return { ok: false, error };
  setOverride(plan, key, { status: undefined });
  return { ok: true };
}

/**
 * Move one session to another day (today or later, within the plan's dates). Other sessions
 * keep their days. Moving back to the original day removes the move. Returns { ok, warnings }:
 * a warning when that day already has a session.
 */
function moveSession(st, planId, key, date, today = todayKey()) {
  const { plan, error } = sessionFor(st, planId, key);
  if (error) return { ok: false, error };
  if (!isDateKey(date)) return { ok: false, error: 'Choose a day.' };
  if (date < today) return { ok: false, error: 'A session can only be moved to today or a later day.' };
  if (date < plan.startDate || date > plan.endDate) return { ok: false, error: 'Choose a day within the plan\'s dates.' };
  const s = sessionStatus(plan, key, st, today);
  if (s.status === 'completed' || s.status === 'in-progress') return { ok: false, error: 'This session is already done or in progress.' };
  if (s.status === 'cancelled') return { ok: false, error: 'This plan is stopped.' };
  const busy = sessionsOn(st, date, today).filter((x) => !(x.plan.id === plan.id && x.session.key === key) && x.session.status !== 'skipped');
  setOverride(plan, key, { date: date === s.originalDate ? undefined : date, status: s.status === 'skipped' ? undefined : (plan.overrides?.[key]?.status) });
  return { ok: true, warnings: busy.length ? [`${date} already has ${busy.map((x) => `“${x.session.title}”`).join(', ')}.`] : [] };
}

/* ---------- Linking workouts ---------- */

/**
 * Link a saved workout to a session. A session has at most one workout: linking another one
 * needs { replace: true } (the previous workout keeps its data, only the link moves).
 * Clears a skip or manual "done" on the session, since the workout now decides.
 */
function linkWorkout(st, workoutId, planId, key, opts = {}) {
  const w = (st.workouts || []).find((x) => x.id === workoutId);
  if (!w) return { ok: false, error: 'This workout no longer exists.' };
  const { plan, error } = sessionFor(st, planId, key);
  if (error) return { ok: false, error };
  const current = planLinks(plan, st).get(key);
  if (current && current.id !== w.id) {
    if (!opts.replace) return { ok: false, error: 'Another workout is already linked to this session.', linkedId: current.id };
    (st.workouts || []).forEach((x) => { if (validPlanLink(x.plan) && x.plan.planId === planId && x.plan.sessionKey === key && x.id !== w.id) delete x.plan; });
  }
  w.plan = { planId, sessionKey: key };
  setOverride(plan, key, { status: undefined });
  return { ok: true };
}

function unlinkWorkout(st, workoutId) {
  const w = (st.workouts || []).find((x) => x.id === workoutId);
  if (!w) return { ok: false, error: 'This workout no longer exists.' };
  delete w.plan;
  return { ok: true };
}

/* ---------- Stopping and deleting ---------- */

/** Stop a plan: sessions from today on become cancelled; what happened before stays as it was. */
function stopPlan(st, planId, today = todayKey()) {
  const plan = findPlan(st, planId);
  if (!plan) return { ok: false, error: 'This plan no longer exists.' };
  plan.status = 'stopped';
  plan.stoppedOn = today;
  return { ok: true };
}

/** Delete a plan. Workouts done for it are kept; only their link to the plan is removed. */
function deletePlan(st, planId) {
  if (!findPlan(st, planId)) return { ok: false, error: 'This plan no longer exists.' };
  st.plans = plansOf(st).filter((p) => p.id !== planId);
  (st.workouts || []).forEach((w) => { if (w.plan?.planId === planId) delete w.plan; });
  if (st.active?.plan?.planId === planId) delete st.active.plan;
  return { ok: true };
}

/* ---------- Keeping links consistent (after a restore) ---------- */

/**
 * Make plan links and session changes match the data. Pure: returns { state, report }.
 * - a link that is malformed, or points to a plan or session that doesn't exist, is removed
 *   (the workout itself is kept);
 * - two workouts linked to one session: the earliest keeps the link;
 * - the workout in progress loses a link to a session that is already done;
 * - session changes for sessions that don't exist are dropped, and invalid moved days ignored.
 * Statuses are always worked out from the data, so after this a session is "completed" only
 * when its linked workout is really there (or it was marked done by hand).
 */
function reconcilePlans(input) {
  const st = JSON.parse(JSON.stringify(input));
  const report = { removedLinks: 0, duplicateLinks: 0, droppedChanges: 0 };
  if (!Array.isArray(st.plans)) st.plans = [];
  const keysOf = new Map(st.plans.map((p) => [p.id, new Set(planSessions(p).map((s) => s.key))]));
  const ok = (l) => validPlanLink(l) && keysOf.get(l.planId)?.has(l.sessionKey);
  const taken = new Set();
  [...(st.workouts || [])].sort((a, b) => new Date(a.start) - new Date(b.start)).forEach((w) => {
    if (w.plan == null) return;
    if (!ok(w.plan)) { delete w.plan; report.removedLinks++; return; }
    const k = `${w.plan.planId}\u0000${w.plan.sessionKey}`;
    if (taken.has(k)) { delete w.plan; report.duplicateLinks++; return; }
    taken.add(k);
  });
  if (st.active && st.active.plan != null) {
    if (!ok(st.active.plan) || taken.has(`${st.active.plan.planId}\u0000${st.active.plan.sessionKey}`)) { delete st.active.plan; report.removedLinks++; }
  }
  for (const p of st.plans) {
    if (!isPlainObject(p.overrides)) { p.overrides = {}; continue; }
    const keys = keysOf.get(p.id);
    for (const [k, o] of Object.entries(p.overrides)) {
      if (!keys.has(k) || !isPlainObject(o)) { delete p.overrides[k]; report.droppedChanges++; continue; }
      if (o.date != null && !(isDateKey(o.date) && o.date >= p.startDate && o.date <= p.endDate)) { delete o.date; report.droppedChanges++; }
      if (o.status != null && !['skipped', 'completed'].includes(o.status)) { delete o.status; report.droppedChanges++; }
      if (o.date == null && o.status == null) delete p.overrides[k];
    }
  }
  return { state: st, report };
}
