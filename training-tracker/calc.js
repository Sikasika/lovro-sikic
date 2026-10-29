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
   - Warm-up sets (set.type 'warmup') count as completed sets but not
     toward volume, records, estimated 1RM or performance charts.
   - Days are local calendar days of the workout's start time;
     weeks start on Monday.
   - Estimated 1-rep max: Epley, weight × (1 + reps / 30), from
     sets with weight > 0 and 1–12 reps (1 rep = the weight).
   - Day streak: consecutive days with a completed workout,
     ending today (or yesterday if nothing is logged yet today).
   - Week streak: consecutive Monday-start weeks with a completed
     workout, ending this week (or last week if none yet).
   - Volume: weight × reps over completed, non-warm-up sets.
   - Training time: workout start → end; workouts without an end time
     are left out (and counted as "without duration"), never guessed.
   - Cardio time: time logged on cardio sets only.
   - A personal record needs an earlier session to beat: the first
     session of an exercise sets the baseline, not a record.
   - Activity type of an exercise entry comes from its category:
     Cardio → cardio, Sports → sports, Other → other, anything else
     (muscle groups) → weights (strength).

   Insights (comparisons and trends)
   - Weeks run Monday–Sunday. A week is complete once it has ended.
     The current week is never compared as if it were complete: it is
     compared with the same days (Monday up to today's weekday) of the
     previous week.
   - Change = current − previous. A percentage is shown only when the
     previous value is above zero ("new" when it was zero), and only for
     quantities that were actually recorded in both periods.
   - Strength sessions / cardio sessions / sports sessions: workouts that
     include at least one exercise of that type (a mixed workout counts
     for each type it contains).
   - Cardio distance is reported per exercise (activity), never summed
     across activities. Cardio time is the time logged on cardio sets.
   - Progression metric of a strength exercise: estimated 1RM when it has
     sets of 1–12 reps with weight, else heaviest weight, else most reps
     (bodyweight exercises).
   - Recent vs earlier: the best value of the most recent sessions
     compared with the best value of the same number of sessions just
     before them (up to 3 each; needs at least 4 sessions). Cardio uses the
     average of sessions instead of the best.
   - Possible plateau: in the chosen period there are at least 3 sessions
     spread over at least 14 days, there are at least 2 earlier sessions,
     and the best value in the period is not more than 1% above the best
     earlier value. It describes logged data only.
   - Reps at comparable weights: working sets at exactly the same weight
     in at least 2 sessions; first vs latest session's most reps.

   Body weight
   - One weigh-in per calendar day (date 'YYYY-MM-DD', weight in kg).
     Weigh-ins outside 20–400 kg or dated in the future are not accepted.
   - 7-day average at a day: the mean of the weigh-ins dated in the 7
     days ending on that day (that day and the 6 before). Days without
     a weigh-in are skipped, never filled in. The headline 7-day average
     ends on the latest weigh-in.
   - Change of the 7-day average: compared with the 7-day average ending
     7 days earlier; shown only when each window has at least 2 weigh-ins.
   - Weekly comparison in Insights: mean of the weigh-ins in each week
     (same days rule as other Insights); a highlight needs at least
     2 weigh-ins in each of the last two complete weeks.
   - Target progress: from the starting weight saved with the target to
     the target, using the current 7-day average; the direction (lose or
     gain) follows from start vs target. Progress is 0–100%.
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
    const sets = entries.flatMap(completedSets).filter((s) => s.type !== 'warmup')
      .map((s) => ({ w: num(s.weight) || 0, r: num(s.reps) || 0, d: num(s.distance) || 0, t: num(s.duration) || 0 }));
    if (!sets.length) continue; // only warm-ups for this exercise in that workout
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

/* ---------- Period summaries and record events ---------- */

/** Totals for a list of completed workouts. Values are null when nothing was recorded. */
function summarizeWorkouts(items) {
  const timed = items.filter((it) => it.min != null);
  let volume = 0, weighted = false, cardioSec = 0;
  for (const it of items) {
    for (const e of it.entries) {
      for (const st of completedSets(e)) {
        const w = num(st.weight) || 0, r = num(st.reps) || 0;
        if (st.type !== 'warmup' && w > 0 && r > 0) { volume += w * r; weighted = true; }
        if (cardioKindOf(e.exerciseId)) cardioSec += num(st.duration) || 0;
      }
    }
  }
  return {
    count: items.length,
    minutes: timed.length ? timed.reduce((a, it) => a + it.min, 0) : null,
    untimed: items.length - timed.length,
    volume: weighted ? volume : null,
    cardioSec: cardioSec > 0 ? cardioSec : null
  };
}

/** Metrics that can set a personal record for an exercise. */
function recordMetrics(exerciseId, sessions) {
  const kind = cardioKindOf(exerciseId);
  if (kind) {
    const m = ['distance'];
    if (paceUnit(kind)) m.push('pace'); else if (CARDIO_KINDS[kind].speed) m.push('speed');
    return m;
  }
  return sessions.some((x) => x.v.weight != null) ? ['weight', 'e1rm'] : ['reps'];
}

/**
 * Every time a session beat the best earlier session for a record metric, oldest first:
 * { exerciseId, metric, value, prev, date }. Recomputed from saved workouts each time,
 * so edits and deletions are reflected immediately.
 */
function recordEvents(items) {
  const events = [];
  const ids = [...new Set(items.flatMap((it) => it.entries.map((e) => e.exerciseId)))];
  for (const id of ids) {
    const sessions = exerciseSessions(items, id);
    for (const m of recordMetrics(id, sessions)) {
      const better = LOWER_IS_BETTER.has(m) ? (a, b) => a < b : (a, b) => a > b;
      let best = null;
      for (const ses of sessions) {
        const v = ses.v[m];
        if (v == null) continue;
        if (best != null && better(v, best)) events.push({ exerciseId: id, metric: m, value: v, prev: best, date: ses.date });
        if (best == null || better(v, best)) best = v;
      }
    }
  }
  return events.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/* ---------- Activity types ---------- */

/** Activity type of one exercise entry, from the exercise's category (shared by Statistics and Insights). */
function entryType(entry) {
  const ex = exById(entry.exerciseId);
  if (!ex) return 'other';
  const cat = String(ex.category || '').trim().toLowerCase();
  if (cat === 'cardio') return 'cardio';
  if (cat === 'sports' || cat === 'sport') return 'sports';
  if (cat === 'other' || cat === '') return 'other';
  return 'weights';
}

/* ---------- Insights: weeks, comparisons and trends ---------- */

/** Monday-start week `offset` weeks before the current one. `e` is exclusive. */
function weekRange(today, offset = 0) {
  const s = sAddDays(startOfWeek(today), -7 * offset);
  const e = sAddDays(s, 7);
  return { s, e, complete: e <= today, days: Math.min(7, sDaysBetween(s, today) + 1) };
}

const itemsBetween = (items, s, e) => items.filter((it) => it.day >= s && it.day < e);

/** Change from prev to cur; pct only when prev > 0. Null when either value is missing. */
function periodChange(cur, prev) {
  if (cur == null || prev == null) return null;
  const abs = cur - prev;
  return { abs, pct: prev > 0 ? (abs / prev) * 100 : null };
}

/** Totals for one period of completed workouts (see the Insights rules above). */
function periodReport(items) {
  const sum = summarizeWorkouts(items);
  const has = (it, type) => it.entries.some((e) => entryType(e) === type);
  const distances = new Map();   // cardio exerciseId -> metres logged
  const categories = new Map();  // category -> workouts that included it
  const cardioItems = items.filter((it) => has(it, 'cardio'));
  for (const it of items) {
    for (const e of it.entries) {
      if (!cardioKindOf(e.exerciseId)) continue;
      const d = completedSets(e).reduce((a, st) => a + (num(st.distance) || 0), 0);
      if (d > 0) distances.set(e.exerciseId, (distances.get(e.exerciseId) || 0) + d);
    }
    new Set(it.entries.map((e) => catOf(exById(e.exerciseId)))).forEach((c) => categories.set(c, (categories.get(c) || 0) + 1));
  }
  return {
    workouts: items.length,
    strength: items.filter((it) => has(it, 'weights')).length,
    cardio: cardioItems.length,
    sports: items.filter((it) => has(it, 'sports')).length,
    cardioSec: sum.cardioSec,
    cardioUntimed: cardioItems.length > 0 && sum.cardioSec == null,
    volume: sum.volume,
    distances,
    categories
  };
}

/** The metric used for strength progression of an exercise (see rules above). */
function progressionMetric(sessions) {
  if (sessions.some((s) => s.v.e1rm != null)) return 'e1rm';
  if (sessions.some((s) => s.v.weight != null)) return 'weight';
  return sessions.some((s) => s.v.reps != null) ? 'reps' : null;
}

/** Best (or, with average = true, mean) of the latest sessions vs the same number just before them. */
function recentVsEarlier(sessions, metric, { n = 3, average = false } = {}) {
  const withV = sessions.filter((s) => s.v[metric] != null);
  if (withV.length < 4) return null;
  const k = Math.min(n, Math.floor(withV.length / 2));
  const recent = withV.slice(-k), earlier = withV.slice(-2 * k, -k);
  const pick = (list) => {
    const vals = list.map((s) => s.v[metric]);
    if (average) return vals.reduce((a, b) => a + b, 0) / vals.length;
    return LOWER_IS_BETTER.has(metric) ? Math.min(...vals) : Math.max(...vals);
  };
  return { k, recent: pick(recent), earlier: pick(earlier), recentFrom: recent[0].date, recentTo: recent[k - 1].date, earlierFrom: earlier[0].date, earlierTo: earlier[k - 1].date };
}

const PLATEAU_MIN_SESSIONS = 3;
const PLATEAU_MIN_SPAN_DAYS = 14;
const PLATEAU_MIN_EARLIER = 2;
const PLATEAU_IMPROVEMENT = 0.01;

/**
 * Possible plateau check for one exercise over the last `weeks` weeks (see rules above).
 * status: 'insufficient' | 'improving' | 'possible-plateau'.
 */
function plateauCheck(sessions, metric, weeks, today) {
  const from = sAddDays(today, -7 * weeks + 1);
  const withV = sessions.filter((s) => s.v[metric] != null);
  const recent = withV.filter((s) => s.it.day >= from);
  const earlier = withV.filter((s) => s.it.day < from);
  const base = { from, recentCount: recent.length, earlierCount: earlier.length };
  const span = recent.length ? sDaysBetween(recent[0].it.day, recent[recent.length - 1].it.day) : 0;
  if (recent.length < PLATEAU_MIN_SESSIONS || span < PLATEAU_MIN_SPAN_DAYS || earlier.length < PLATEAU_MIN_EARLIER) return { status: 'insufficient', ...base };
  const best = (list) => Math.max(...list.map((s) => s.v[metric]));
  const bestRecent = best(recent), bestEarlier = best(earlier);
  return { status: bestRecent > bestEarlier * (1 + PLATEAU_IMPROVEMENT) ? 'improving' : 'possible-plateau', bestRecent, bestEarlier, ...base };
}

/** Working sets at the same weight in at least 2 sessions: first vs latest session's most reps (top 3 weights). */
function repsAtWeights(sessions) {
  const byW = new Map();
  for (const s of sessions) {
    const top = new Map();
    s.best.filter((x) => x.w > 0 && x.r > 0).forEach((x) => {
      const w = Math.round(x.w * 100) / 100;
      top.set(w, Math.max(top.get(w) || 0, x.r));
    });
    top.forEach((r, w) => { if (!byW.has(w)) byW.set(w, []); byW.get(w).push({ date: s.date, reps: r }); });
  }
  return [...byW].filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || b[0] - a[0])
    .slice(0, 3)
    .map(([weight, list]) => ({ weight, sessions: list.length, first: list[0], last: list[list.length - 1] }));
}

/* ---------- Body weight ---------- */

const WEIGHT_MIN_KG = 20;
const WEIGHT_MAX_KG = 400;
const WEIGHT_AVG_DAYS = 7;
/** Weigh-ins needed in each window before two averages are compared. */
const WEIGHT_COMPARE_MIN = 2;

const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && sKey(sFromKey(v)) === v;
const validWeightKg = (v) => typeof v === 'number' && Number.isFinite(v) && v >= WEIGHT_MIN_KG && v <= WEIGHT_MAX_KG;

/** Valid weigh-ins, oldest first, each with its local day as a Date. */
function weighIns(list = state.bodyweights) {
  return (Array.isArray(list) ? list : [])
    .filter((w) => w && isDateKey(w.date) && validWeightKg(w.kg))
    .map((w) => ({ ...w, day: sFromKey(w.date) }))
    .sort((a, b) => a.day - b.day);
}

/** Mean of the weigh-ins with from <= day < to. { avg, n } or null. */
function weightMeanBetween(list, from, to) {
  const xs = list.filter((w) => w.day >= from && w.day < to);
  return xs.length ? { avg: xs.reduce((a, w) => a + w.kg, 0) / xs.length, n: xs.length } : null;
}

/** 7-day average ending on `endDay` (inclusive). { avg, n, from, to } or null. */
function weightAverage(list, endDay, days = WEIGHT_AVG_DAYS) {
  const from = sAddDays(endDay, -(days - 1));
  const m = weightMeanBetween(list, from, sAddDays(endDay, 1));
  return m && { ...m, from, to: endDay };
}

/** The 7-day average at each weigh-in, for charts: [{ date, value }]. */
function weightAverageSeries(list) {
  return list.map((w) => ({ date: w.day, value: weightAverage(list, w.day).avg }));
}

/**
 * Current 7-day average (ending on the latest weigh-in) and its change vs the
 * 7-day average ending `days` earlier; change is null unless both windows have
 * at least WEIGHT_COMPARE_MIN weigh-ins.
 */
function weightTrend(list, days = 7) {
  if (!list.length) return null;
  const end = list[list.length - 1].day;
  const cur = weightAverage(list, end);
  const prev = weightAverage(list, sAddDays(end, -days));
  const comparable = cur && prev && cur.n >= WEIGHT_COMPARE_MIN && prev.n >= WEIGHT_COMPARE_MIN;
  return { latest: list[list.length - 1], cur, prev, change: comparable ? cur.avg - prev.avg : null };
}

/**
 * Progress toward a target: { direction: 'lose' | 'gain', pct (0–100), toGo (kg, >= 0), reached }.
 * goal = { targetKg, startKg }; current = current 7-day average (kg).
 */
function weightGoalProgress(goal, current) {
  if (!goal || !validWeightKg(goal.targetKg) || !validWeightKg(goal.startKg) || current == null) return null;
  const { targetKg: target, startKg: start } = goal;
  const direction = target < start ? 'lose' : 'gain';
  const total = Math.abs(start - target);
  const done = direction === 'lose' ? start - current : current - start;
  const reached = direction === 'lose' ? current <= target : current >= target;
  const pct = reached ? 100 : total ? Math.max(0, Math.min(100, (done / total) * 100)) : 100;
  return { direction, pct, toGo: reached ? 0 : Math.abs(current - target), reached, target, start };
}
