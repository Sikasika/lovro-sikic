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
     numbers, and weight, reps, distance or duration > 0.
   - Cardio sets may also store distance (metres) and duration
     (seconds). Pace and speed are only calculated from sets that
     have both; nothing is estimated or filled in.
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

/* ---------- Cardio: activities, distance, time, pace, speed ---------- */

const M_PER_MI = 1609.344;
const M_PER_YD = 0.9144;
const isImperial = () => unit() === 'lb';

/**
 * Activity profile of a Cardio-category exercise, from its name; null for
 * non-cardio exercises. paceBase is the distance pace is shown per (metres
 * metric / imperial), null when pace isn't shown; speed says whether speed is shown.
 */
const CARDIO_KINDS = {
  foot: { small: false, paceBase: [1000, M_PER_MI], speed: true },  // running, walking, hiking
  cycle: { small: false, paceBase: null, speed: true },
  swim: { small: true, paceBase: [100, 100 * M_PER_YD], speed: false },
  row: { small: true, paceBase: [500, 500 * M_PER_YD], speed: false },
  other: { small: false, paceBase: [1000, M_PER_MI], speed: true }
};
function cardioKind(ex) {
  if (!ex || String(ex.category || '').trim().toLowerCase() !== 'cardio') return null;
  const n = String(ex.name || '').toLowerCase();
  if (/swim/.test(n)) return 'swim';
  if (/row/.test(n)) return 'row';
  if (/cycl|bik|spin/.test(n)) return 'cycle';
  if (/run|jog|walk|hik|treadmill/.test(n)) return 'foot';
  return 'other';
}
const cardioKindOf = (exerciseId) => cardioKind(exById(exerciseId));

/** Distance unit label for an activity in the current unit system. */
const distanceUnit = (kind) => (CARDIO_KINDS[kind]?.small ? (isImperial() ? 'yd' : 'm') : (isImperial() ? 'mi' : 'km'));
const distanceFactor = (kind) => (CARDIO_KINDS[kind]?.small ? (isImperial() ? M_PER_YD : 1) : (isImperial() ? M_PER_MI : 1000));
const toDisplayDistance = (m, kind) => (m == null ? null : m / distanceFactor(kind));
const toStoredDistance = (v, kind) => (v == null ? null : v * distanceFactor(kind));
const distanceDecimals = (kind) => (CARDIO_KINDS[kind]?.small ? 0 : 2);
/** Metres → value for a distance input box. */
const inputDistance = (m, kind) => (m == null ? '' : String(Math.round(toDisplayDistance(m, kind) * 10 ** distanceDecimals(kind)) / 10 ** distanceDecimals(kind)));
/** Metres → "5.02 km". */
const fmtDistance = (m, kind) => `${toDisplayDistance(m, kind).toLocaleString(undefined, { maximumFractionDigits: distanceDecimals(kind), minimumFractionDigits: distanceDecimals(kind) })} ${distanceUnit(kind)}`;

/** Seconds → "25:30" or "1:05:00". */
function fmtClock(sec) {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
/**
 * Time typed by the user → seconds, or null. A plain number is minutes
 * ("25", "25.5" = 25:30); colons give m:ss or h:mm:ss ("25:30", "1:05:00").
 */
function parseClock(str) {
  const s = String(str ?? '').trim().replace(',', '.');
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length > 3 || parts.some((p) => p === '' || isNaN(+p) || +p < 0)) return null;
    return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  }
  const v = Number(s);
  return Number.isFinite(v) && v >= 0 ? v * 60 : null;
}

/** Pace label unit, e.g. "/km", "/100 m", "/500 yd"; null when the activity has no pace. */
function paceUnit(kind) {
  const k = CARDIO_KINDS[kind];
  if (!k?.paceBase) return null;
  if (!k.small) return isImperial() ? '/mi' : '/km';
  const n = k.paceBase[0];
  return `/${n} ${isImperial() ? 'yd' : 'm'}`;
}
/** Seconds per pace base distance, from total seconds and metres. */
const paceSeconds = (sec, m, kind) => sec / m * CARDIO_KINDS[kind].paceBase[isImperial() ? 1 : 0];
const speedUnit = () => (isImperial() ? 'mph' : 'km/h');
/** km/h or mph from metres and seconds. */
const speedValue = (m, sec) => (m / sec) * (isImperial() ? 3600 / M_PER_MI : 3.6);

/** "5.00 km · 25:00 · 5:00 /km · 12.0 km/h" for one cardio set or session (only what was logged). */
function fmtCardio(m, sec, kind) {
  const parts = [];
  if (m > 0) parts.push(fmtDistance(m, kind));
  if (sec > 0) parts.push(fmtClock(sec));
  if (m > 0 && sec > 0) {
    if (paceUnit(kind)) parts.push(`${fmtClock(paceSeconds(sec, m, kind))} ${paceUnit(kind)}`);
    if (CARDIO_KINDS[kind].speed) parts.push(`${fmtNum(speedValue(m, sec))} ${speedUnit()}`);
  }
  return parts.join(' · ');
}

/* ---------- Sets ---------- */

function isValidSet(s) {
  if (!s || s.done === false) return false;
  const vals = [num(s.weight), num(s.reps), num(s.distance), num(s.duration)];
  if (vals.some((v) => v != null && v < 0)) return false;
  return vals.some((v) => (v || 0) > 0);
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
 * distance (metres, sum of logged distances), duration (minutes: time
 * logged on its sets; for older sets without time, the workout's time only
 * when the workout contained just this exercise), pace (seconds per metre)
 * and speed (metres per second) from sets with both distance and time.
 */
function exerciseSessions(items, exerciseId) {
  const out = [];
  for (const it of items) {
    const entries = it.entries.filter((e) => e.exerciseId === exerciseId);
    if (!entries.length) continue;
    const sets = entries.flatMap(completedSets).map((s) => ({ w: num(s.weight) || 0, r: num(s.reps) || 0, d: num(s.distance) || 0, t: num(s.duration) || 0 }));
    const weighted = sets.filter((s) => s.w > 0);
    const e1rms = sets.map((s) => setE1rm(s.w, s.r)).filter((v) => v != null);
    const v = {};
    if (weighted.length) v.weight = Math.max(...weighted.map((s) => s.w));
    if (e1rms.length) v.e1rm = Math.max(...e1rms);
    if (weighted.some((s) => s.r > 0)) v.volume = sets.reduce((sum, s) => sum + s.w * s.r, 0);
    if (sets.some((s) => s.r > 0)) { v.reps = Math.max(...sets.map((s) => s.r)); v.totalreps = sets.reduce((sum, s) => sum + s.r, 0); }
    if (sets.some((s) => s.d > 0)) v.distance = sets.reduce((sum, s) => sum + s.d, 0);
    const timed = sets.reduce((sum, s) => sum + s.t, 0);
    if (timed > 0) v.duration = timed / 60;
    else if (it.min != null && it.entries.every((e) => e.exerciseId === exerciseId)) v.duration = it.min;
    const both = sets.filter((s) => s.d > 0 && s.t > 0);
    if (both.length) {
      const D = both.reduce((sum, s) => sum + s.d, 0), T = both.reduce((sum, s) => sum + s.t, 0);
      v.pace = T / D;
      v.speed = D / T;
    }
    out.push({ it, date: it.start.toISOString(), v, best: sets });
  }
  return out;
}

/** Metrics where a lower value is better. */
const LOWER_IS_BETTER = new Set(['pace']);

/** The session with the best value for a metric (earliest one on ties), or null. */
function bestSession(sessions, metric) {
  const better = LOWER_IS_BETTER.has(metric) ? (a, b) => a < b : (a, b) => a > b;
  return sessions.filter((s) => s.v[metric] != null).reduce((a, s) => (!a || better(s.v[metric], a.v[metric]) ? s : a), null);
}
