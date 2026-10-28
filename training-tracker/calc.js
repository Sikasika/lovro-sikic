'use strict';

/* =========================================================
   Shared data rules and calculations, used by Workout,
   History, Progress and Statistics so the same metric gives
   the same result everywhere.

   Loaded before app.js. It uses app.js globals (state, num,
   unit, fmtNum, startOfWeek) only when its functions are called.

   Rules
   - Weights are stored in kilograms (data format v2) and
     converted to the chosen unit only for display and input.
   - Valid set: not unchecked (done !== false), no negative
     numbers, and weight > 0 or reps > 0.
   - Completed workout: a finished (saved) workout with a valid
     start date no later than today and at least one valid set.
     The workout in progress is never counted.
   - Days are local calendar days of the workout's start time;
     weeks start on Monday.
   - Estimated 1-rep max: Epley, weight × (1 + reps / 30), from
     sets with weight > 0 and 1–12 reps (1 rep = the weight).
   - Day streak: consecutive days with a completed workout,
     ending today (or yesterday if nothing is logged yet today).
   - Week streak: consecutive Monday-start weeks with a completed
     workout, ending this week (or last week if none yet).
   ========================================================= */

const SCHEMA_VERSION = 2;
const KG_PER_LB = 0.45359237;

/* ---------- Units ---------- */

/** Stored kilograms → number in the selected unit. */
const toDisplayWeight = (kg) => (kg == null ? null : unit() === 'lb' ? kg / KG_PER_LB : kg);
/** Number typed in the selected unit → kilograms for storage. */
const toStoredWeight = (v) => (v == null ? null : unit() === 'lb' ? v * KG_PER_LB : v);
/** Kilograms → text in the selected unit (0.1 precision), e.g. for labels. */
const fmtWeight = (kg) => fmtNum(toDisplayWeight(kg));
/** Kilograms → value for a weight input box (up to 2 decimals). */
const inputWeight = (kg) => (kg == null ? '' : String(Math.round(toDisplayWeight(kg) * 100) / 100));

/* ---------- Sets ---------- */

function isValidSet(s) {
  if (!s || s.done === false) return false;
  const w = num(s.weight), r = num(s.reps);
  if ((w != null && w < 0) || (r != null && r < 0)) return false;
  return (w || 0) > 0 || (r || 0) > 0;
}

const completedSets = (entry) => (Array.isArray(entry?.sets) ? entry.sets.filter(isValidSet) : []);

const E1RM_MAX_REPS = 12;
const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));
/** Estimated 1RM for one set, or null when the set is outside the rule. */
const setE1rm = (w, r) => (w > 0 && r >= 1 && r <= E1RM_MAX_REPS ? e1rm(w, r) : null);

/* ---------- Local calendar days (DST-safe: built from y/m/d parts) ---------- */

const sDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sAddDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function sFromKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const sDaysBetween = (a, b) => Math.round((sDay(b) - sDay(a)) / 864e5);

/* ---------- Completed workouts ---------- */

/**
 * Finished workouts that count for statistics, oldest first.
 * Each item: { w, start, day, key, entries (with valid sets), min (duration in minutes or null) }.
 */
function completedWorkouts(now = new Date()) {
  const today = sDay(now);
  const items = [];
  let skipped = 0;
  for (const w of state.workouts || []) {
    const start = new Date(w?.start);
    const entries = (w?.entries || []).filter((e) => completedSets(e).length);
    if (isNaN(start) || !entries.length || sDay(start) > today) { skipped++; continue; }
    const end = new Date(w.end);
    const min = !isNaN(end) && end >= start ? (end - start) / 60000 : null;
    const day = sDay(start);
    items.push({ w, start, day, key: sKey(day), entries, min });
  }
  items.sort((a, b) => a.start - b.start);
  return { items, skipped, today };
}

/* ---------- Streaks ---------- */

/** Consecutive days with a workout, ending today or yesterday. */
function dayStreak(items, today) {
  const days = new Set(items.map((it) => it.key));
  let n = 0;
  let d = days.has(sKey(today)) ? today : sAddDays(today, -1);
  while (days.has(sKey(d))) { n++; d = sAddDays(d, -1); }
  return n;
}

/** Longest run of consecutive days with a workout among the given items. */
function longestDayStreak(items) {
  let longest = 0, run = 0, prev = null;
  [...new Set(items.map((it) => it.key))].sort().forEach((k) => {
    const day = sFromKey(k);
    run = prev && sDaysBetween(prev, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  });
  return longest;
}

/** Consecutive Monday-start weeks with a workout, ending this week or last week. */
function weekStreak(items, today) {
  const weeks = new Set(items.map((it) => sKey(startOfWeek(it.day))));
  let n = 0;
  let cursor = startOfWeek(today);
  if (!weeks.has(sKey(cursor))) cursor = sAddDays(cursor, -7);
  while (weeks.has(sKey(cursor))) { n++; cursor = sAddDays(cursor, -7); }
  return n;
}

/** The last `n` Monday-start weeks up to this week: [{ s, e }] with e exclusive. */
function weekBuckets(today, n) {
  const first = sAddDays(startOfWeek(today), -(n - 1) * 7);
  return Array.from({ length: n }, (_, i) => ({ s: sAddDays(first, i * 7), e: sAddDays(first, (i + 1) * 7) }));
}

/* ---------- Exercise sessions and personal records ---------- */

/**
 * One session per completed workout containing the exercise, with the
 * metrics its sets support (weights in kg):
 * weight (heaviest), e1rm, volume, reps (most in a set), totalreps,
 * duration (only when the workout contained just this exercise).
 */
function exerciseSessions(items, exerciseId) {
  const out = [];
  for (const it of items) {
    const entries = it.entries.filter((e) => e.exerciseId === exerciseId);
    if (!entries.length) continue;
    const sets = entries.flatMap(completedSets).map((s) => ({ w: num(s.weight) || 0, r: num(s.reps) || 0 }));
    const weighted = sets.filter((s) => s.w > 0);
    const e1rms = sets.map((s) => setE1rm(s.w, s.r)).filter((v) => v != null);
    const v = {};
    if (weighted.length) v.weight = Math.max(...weighted.map((s) => s.w));
    if (e1rms.length) v.e1rm = Math.max(...e1rms);
    if (weighted.some((s) => s.r > 0)) v.volume = sets.reduce((sum, s) => sum + s.w * s.r, 0);
    if (sets.some((s) => s.r > 0)) { v.reps = Math.max(...sets.map((s) => s.r)); v.totalreps = sets.reduce((sum, s) => sum + s.r, 0); }
    if (it.min != null && it.entries.every((e) => e.exerciseId === exerciseId)) v.duration = it.min;
    out.push({ it, date: it.start.toISOString(), v, best: sets });
  }
  return out;
}

/** The session with the highest value for a metric (earliest one on ties), or null. */
function bestSession(sessions, metric) {
  return sessions.filter((s) => s.v[metric] != null).reduce((a, s) => (!a || s.v[metric] > a.v[metric] ? s : a), null);
}
