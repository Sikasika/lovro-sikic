'use strict';

/* =========================================================
   Backup and restore. Everything stays on the device: a backup
   is a .json file the user saves (Files, AirDrop, email, ...).

   Backup file format 1 (no plans) or 2 (contains plans; same layout):
   {
     "app": "training-tracker",
     "kind": "backup",
     "format": 1 | 2,                   // 2 when the backup contains plans (see below)
     "schemaVersion": 2,                // version of the data inside
     "exportedAt": "2026-10-28T17:00:00.000Z",
     "counts": { "workouts": 12, "templates": 2, "exercises": 40, "bodyweights": 30, "plans": 1 },
     "data": {
       "exercises": [...], "workouts": [...], "templates": [...],
       "active": null | { workout in progress },
       "bodyweights": [{ "id", "date": "YYYY-MM-DD", "kg", "note"? }],
       "plans": [{ plan, see plans.js }],  // workouts done for a plan carry "plan": { planId, sessionKey }
       "settings": { "unit": "kg" | "lb", "rest": 90, "weightGoal"?: { "targetKg", "startKg", "startDate" } },
       "cardioExercisesAdded": true
     }
   }
   Older backups (before format 1) have the same fields at the top
   level, and the oldest have no schemaVersion; both are accepted and
   upgraded with migrate(). Optional fields added over time (set types,
   targets, cardio distance/duration, notes, supersets, archived
   exercises, weigh-ins, target weight) may be missing and are simply absent.

   Weigh-ins on restore (deliberate, see restoredState): a backup with
   weigh-ins replaces the weigh-ins on the device like everything else; a
   backup without any (e.g. made before weight tracking existed) keeps the
   weigh-ins already on the device. The target weight follows the same rule.
   "Undo last restore" brings back exactly the saved copy (if that copy was
   saved before weight tracking existed, the weigh-ins here are kept).

   Plans on restore follow the same rule: a backup with plans replaces the plans here; a
   backup without any keeps the plans on this device. Afterwards plan links are checked
   against the restored workouts (reconcilePlans in plans.js): links to plans or sessions
   that aren't there are removed, and since a session's status is always worked out from
   the workouts actually present, a missing workout can never show as a completed session.

   Format 2: a backup that contains plans is marked format 2, otherwise it stays format 1.
   App versions before plans (v21 and earlier) refuse any format above 1 with "made by a
   newer version… update the app" and change nothing, so they can never restore such a file
   while silently dropping its plans. Backups without plans remain readable by them. This
   app accepts formats 1 and 2; a format-2 file without its plan list is refused as incomplete.

   Loaded before app.js; uses its globals only when called.
   ========================================================= */

/** Highest format this version can restore. Exports use 1, or 2 when there are plans. */
const BACKUP_FORMAT = 2;
const BACKUP_FORMAT_PLANS = 2;
/** Copy of the data as it was before the last restore or erase, for "Undo last restore". */
const BEFORE_RESTORE_KEY = 'training-tracker.v1.before-restore';
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/* ---------- Export ---------- */

function buildBackup(st = state) {
  const data = {
    exercises: st.exercises,
    workouts: st.workouts,
    templates: st.templates || [],
    active: st.active || null,
    bodyweights: Array.isArray(st.bodyweights) ? st.bodyweights : [],
    plans: Array.isArray(st.plans) ? st.plans : [],
    settings: st.settings,
    cardioExercisesAdded: !!st.cardioExercisesAdded
  };
  return {
    app: 'training-tracker',
    kind: 'backup',
    format: data.plans.length ? BACKUP_FORMAT_PLANS : 1,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts: { workouts: data.workouts.length, templates: data.templates.length, exercises: data.exercises.length, bodyweights: data.bodyweights.length, plans: data.plans.length },
    data
  };
}

const backupFilename = (label = 'backup') => `training-${label}-${new Date().toISOString().slice(0, 10)}.json`;

/**
 * Hand a file to the user: the iOS share sheet (Save to Files, AirDrop, ...) where
 * available, otherwise a download. Resolves to 'shared', 'downloaded' or 'cancelled'.
 */
async function shareFile(json, filename) {
  const file = new File([json], filename, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Training backup' });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // Sharing failed for another reason: fall back to a download.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}

async function exportData() {
  const backup = buildBackup();
  let result;
  try {
    result = await shareFile(JSON.stringify(backup, null, 2), backupFilename());
  } catch (e) {
    alert('The backup could not be created. Please try again.');
    return;
  }
  if (result === 'cancelled') { toast('Export cancelled'); return; }
  state.lastExportAt = backup.exportedAt;
  save();
  if (ui.tab === 'settings') render();
  const c = backup.counts;
  toast(`Backup exported · ${c.workouts} workout${c.workouts === 1 ? '' : 's'}`);
}

function hasPreUpdateCopy() {
  try { return !!localStorage.getItem(BACKUP_KEY); } catch (e) { return false; }
}

/** The original data from before the v2 upgrade. It can be restored like any backup. */
function exportPreUpdateCopy() {
  let raw = null;
  try { raw = localStorage.getItem(BACKUP_KEY); } catch (e) { /* ignore */ }
  if (!raw) { toast('No pre-update copy on this device'); return; }
  return shareFile(raw, 'training-backup-before-update.json');
}

/* ---------- Validation ---------- */

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const validId = (v) => (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));
const validDate = (v) => typeof v === 'string' && !isNaN(new Date(v));
/** '' / null / undefined, a finite number, or a numeric string (older data stored typed text). */
const validNumberField = (v) => v == null || v === '' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))));
const SET_NUMBER_FIELDS = ['weight', 'reps', 'distance', 'duration'];

/**
 * Check a parsed backup file completely before anything is replaced.
 * Returns { ok: false, errors } or { ok: true, state, warnings, info }.
 * Any error rejects the whole file: nothing is ever partially imported.
 */
function validateBackup(parsed) {
  const errors = [];
  const warnings = [];
  const fail = (msg) => ({ ok: false, errors: [msg] });

  if (!isObj(parsed)) return fail('The file does not contain Training Tracker data.');
  if (parsed.app != null && parsed.app !== 'training-tracker') return fail('This file was made by a different app.');
  if (typeof parsed.format === 'number' && parsed.format > BACKUP_FORMAT) {
    return fail('This backup was made by a newer version of the app. Update the app (close and reopen it with internet) and try again.');
  }
  const src = isObj(parsed.data) ? parsed.data : parsed;
  if (typeof parsed.format === 'number' && parsed.format >= BACKUP_FORMAT_PLANS && !Array.isArray(src.plans)) {
    return fail('The file looks incomplete: it is marked as containing plans, but the plan list is missing.');
  }
  const schema = Number(parsed.schemaVersion ?? src.schemaVersion) || 1;
  if (schema > SCHEMA_VERSION) {
    return fail('This backup uses a newer data format than this version of the app. Update the app (close and reopen it with internet) and try again.');
  }
  if (!Array.isArray(src.exercises)) errors.push('The exercise list is missing.');
  if (!Array.isArray(src.workouts)) errors.push('The workout list is missing.');
  if (src.templates != null && !Array.isArray(src.templates)) errors.push('The template list is not in the expected format.');
  if (src.bodyweights != null && !Array.isArray(src.bodyweights)) errors.push('The weigh-in list is not in the expected format.');
  if (src.plans != null && !Array.isArray(src.plans)) errors.push('The plan list is not in the expected format.');
  if (errors.length) return { ok: false, errors };

  if (isObj(parsed.counts)) {
    const c = parsed.counts;
    if ((c.workouts != null && c.workouts !== src.workouts.length) || (c.exercises != null && c.exercises !== src.exercises.length) ||
        (c.templates != null && c.templates !== (src.templates || []).length) ||
        (c.bodyweights != null && c.bodyweights !== (src.bodyweights || []).length) ||
        (c.plans != null && c.plans !== (src.plans || []).length)) {
      errors.push('The file looks incomplete: it contains fewer items than it says it should.');
    }
  }

  // Exercises
  const exIds = new Set();
  src.exercises.forEach((e, i) => {
    if (!isObj(e) || !validId(e.id) || typeof e.name !== 'string' || !e.name.trim()) {
      errors.push(`Exercise ${i + 1} is missing its id or name.`);
      return;
    }
    if (exIds.has(String(e.id))) errors.push(`The exercise “${e.name}” appears twice.`);
    exIds.add(String(e.id));
    if (e.category != null && typeof e.category !== 'string') errors.push(`The exercise “${e.name}” has an invalid category.`);
  });

  let missingRefs = 0;
  const checkEntries = (entries, where, isTemplate) => {
    if (!Array.isArray(entries)) { errors.push(`${where} has no exercise list.`); return; }
    entries.forEach((en, k) => {
      const here = `${where}, exercise ${k + 1}`;
      if (!isObj(en) || !validId(en.exerciseId)) { errors.push(`${here} is missing its exercise.`); return; }
      if (!exIds.has(String(en.exerciseId))) missingRefs++;
      if (en.note != null && typeof en.note !== 'string') errors.push(`${here} has an invalid note.`);
      if (en.superset != null && !validId(en.superset)) errors.push(`${here} has an invalid superset group.`);
      if (en.planned != null && !validTarget(en.planned)) errors.push(`${here} has an invalid program target.`);
      if (en.swappedFrom != null && !validId(en.swappedFrom)) errors.push(`${here} has an invalid swap record.`);
      if (isTemplate && typeof en.sets === 'number') return; // oldest templates: just a set count
      if (!Array.isArray(en.sets)) { errors.push(`${here} has no sets.`); return; }
      en.sets.forEach((st, j) => {
        const setHere = `${here}, set ${j + 1}`;
        if (!isObj(st)) { errors.push(`${setHere} is not in the expected format.`); return; }
        if (SET_NUMBER_FIELDS.some((f) => !validNumberField(st[f]))) errors.push(`${setHere} has a value that isn't a number.`);
        if (st.type != null && !['warmup', 'drop', 'working'].includes(st.type)) errors.push(`${setHere} has an unknown set type.`);
        if (st.done != null && typeof st.done !== 'boolean') errors.push(`${setHere} has an invalid done flag.`);
        if (st.target != null && (!isObj(st.target) || SET_NUMBER_FIELDS.some((f) => !validNumberField(st.target[f])))) errors.push(`${setHere} has an invalid planned value.`);
      });
    });
  };

  // Workouts
  const wIds = new Set();
  const checkWorkout = (w, where, finished) => {
    if (!isObj(w)) { errors.push(`${where} is not in the expected format.`); return; }
    const label = `${where}${typeof w.name === 'string' && w.name ? ` (“${w.name}”)` : ''}`;
    if (!validId(w.id)) errors.push(`${label} is missing its id.`);
    else if (finished) {
      if (wIds.has(String(w.id))) errors.push(`${label} appears twice.`);
      wIds.add(String(w.id));
    }
    if (!validDate(w.start)) errors.push(`${label} has no valid date.`);
    if (w.end != null && w.end !== '' && !validDate(w.end)) errors.push(`${label} has an invalid end time.`);
    if (w.planned != null && !(isObj(w.planned) && typeof w.planned.title === 'string' && typeof w.planned.planName === 'string' && (w.planned.date == null || isDateKey(w.planned.date)) &&
        Array.isArray(w.planned.items) && w.planned.items.every((x) => validPlannedRunItem(x) || (validTarget(x) && validId(x.exerciseId))) &&
        (w.planned.run == null || validRunTarget(w.planned.run)))) errors.push(`${label} has an invalid planned session record.`);
    checkEntries(w.entries, label, false);
  };
  src.workouts.forEach((w, i) => checkWorkout(w, `Workout ${i + 1}`, true));
  if (src.active != null) checkWorkout(src.active, 'The workout in progress', false);

  // Templates
  const tIds = new Set();
  (src.templates || []).forEach((t, i) => {
    const label = `Template ${i + 1}${isObj(t) && typeof t.name === 'string' ? ` (“${t.name}”)` : ''}`;
    if (!isObj(t) || !validId(t.id)) { errors.push(`${label} is missing its id.`); return; }
    if (tIds.has(String(t.id))) errors.push(`${label} appears twice.`);
    tIds.add(String(t.id));
    checkEntries(t.entries, label, true);
  });

  // Weigh-ins (optional; older backups have none)
  const bwIds = new Set(), bwDates = new Set();
  (src.bodyweights || []).forEach((w, i) => {
    const label = `Weigh-in ${i + 1}${isObj(w) && typeof w.date === 'string' ? ` (${w.date})` : ''}`;
    if (!isObj(w) || !validId(w.id)) { errors.push(`${label} is missing its id.`); return; }
    if (bwIds.has(String(w.id))) errors.push(`${label} appears twice.`);
    bwIds.add(String(w.id));
    if (!isDateKey(w.date)) errors.push(`${label} has no valid date.`);
    else if (bwDates.has(w.date)) errors.push(`There are two weigh-ins on ${w.date}; only one per day is allowed.`);
    else bwDates.add(w.date);
    if (!validWeightKg(w.kg)) errors.push(`${label} has a weight that isn't between ${WEIGHT_MIN_KG} and ${WEIGHT_MAX_KG} kg.`);
    if (w.note != null && typeof w.note !== 'string') errors.push(`${label} has an invalid note.`);
  });

  // Plans (optional; older backups have none). Links from workouts are checked after restore.
  const planIds = new Set();
  (src.plans || []).forEach((p, i) => {
    planProblems(p, `Plan ${i + 1}`).forEach((m) => errors.push(m));
    if (isObj(p) && typeof p.id === 'string') {
      if (planIds.has(p.id)) errors.push(`Plan ${i + 1} appears twice.`);
      planIds.add(p.id);
    }
  });
  const badLinks = [...src.workouts, ...(src.active ? [src.active] : [])].filter((w) => isObj(w) && w.plan != null && !validPlanLink(w.plan)).length;

  // Settings
  if (src.settings != null && !isObj(src.settings)) errors.push('The settings are not in the expected format.');
  else if (src.settings) {
    if (src.settings.unit != null && !['kg', 'lb'].includes(src.settings.unit)) errors.push('The unit setting is not kg or lb.');
    if (src.settings.rest != null && !(typeof src.settings.rest === 'number' && src.settings.rest >= 0)) warnings.push('The rest timer setting was invalid, so the default (90 s) will be used.');
    if (src.settings.weightGoal != null && !validWeightGoal(src.settings.weightGoal)) warnings.push('The target weight in the backup was invalid, so it will be left out.');
    for (const [k, u] of [['weightStepKg', 'kg'], ['weightStepLb', 'lb']]) {
      const v = src.settings[k];
      if (v != null && !(typeof v === 'number' && v >= WEIGHT_STEP_LIMITS[u][0] && v <= WEIGHT_STEP_LIMITS[u][1])) warnings.push(`The weight step (${u}) in the backup was invalid, so the default (${WEIGHT_STEP_DEFAULT[u]} ${u}) will be used.`);
    }
  }

  if (errors.length) {
    const shown = errors.slice(0, 8);
    if (errors.length > 8) shown.push(`…and ${errors.length - 8} more problem${errors.length - 8 === 1 ? '' : 's'}.`);
    return { ok: false, errors: shown };
  }

  if (missingRefs) warnings.push(`${missingRefs} logged exercise${missingRefs === 1 ? ' refers' : 's refer'} to an exercise that isn't in the backup. ${missingRefs === 1 ? 'It' : 'They'} will show as “Deleted exercise”.`);
  if (badLinks) warnings.push(`${badLinks} workout${badLinks === 1 ? ' has' : 's have'} an unreadable link to a plan; the link${badLinks === 1 ? '' : 's'} will be removed (the workouts are kept).`);
  if (schema < 2 && src.settings?.unit === 'lb') warnings.push('This older backup stored weights in lb; they will be converted to the current format (your numbers stay the same).');

  // Upgrade older data (pure: returns a new object) and fill in defaults for missing optional fields.
  const data = migrate({ ...src, schemaVersion: schema });
  const defaults = defaultState();
  const restored = {
    ...defaults,
    exercises: data.exercises,
    workouts: data.workouts,
    templates: data.templates || [],
    active: data.active || null,
    plans: Array.isArray(data.plans) ? data.plans : [],
    bodyweights: (data.bodyweights || []).map((w) => ({ id: String(w.id), date: w.date, kg: w.kg, ...(typeof w.note === 'string' && w.note.trim() ? { note: w.note } : {}) })),
    settings: { ...defaults.settings, ...(isObj(data.settings) ? data.settings : {}) },
    schemaVersion: SCHEMA_VERSION,
    cardioExercisesAdded: !!data.cardioExercisesAdded
  };
  if (!(typeof restored.settings.rest === 'number' && restored.settings.rest >= 0)) restored.settings.rest = defaults.settings.rest;
  if (!validWeightGoal(restored.settings.weightGoal)) delete restored.settings.weightGoal;
  for (const [k, u] of [['weightStepKg', 'kg'], ['weightStepLb', 'lb']]) {
    const v = restored.settings[k];
    if (!(typeof v === 'number' && v >= WEIGHT_STEP_LIMITS[u][0] && v <= WEIGHT_STEP_LIMITS[u][1])) restored.settings[k] = WEIGHT_STEP_DEFAULT[u];
  }
  addNewDefaultExercises(restored);

  const starts = restored.workouts.map((w) => new Date(w.start)).sort((a, b) => a - b);
  return {
    ok: true,
    state: restored,
    warnings,
    // What the backup itself contains, for restoredState() and the confirmation screen.
    weights: { count: restored.bodyweights.length, goal: !!restored.settings.weightGoal, field: Array.isArray(src.bodyweights) },
    plans: { count: restored.plans.length, field: Array.isArray(src.plans) },
    info: {
      exportedAt: validDate(parsed.exportedAt) ? parsed.exportedAt : null,
      older: !(typeof parsed.format === 'number'),
      first: starts[0] || null,
      last: starts[starts.length - 1] || null
    }
  };
}

const validWeightGoal = (g) => isObj(g) && validWeightKg(g.targetKg) && validWeightKg(g.startKg) && (g.startDate == null || isDateKey(g.startDate));

/**
 * The data to write for a restore. Weigh-ins and the target weight are handled on purpose:
 * - the backup has weigh-ins → they replace the ones on this device (like all other data);
 * - the backup has none (an older backup, or one made before any weigh-ins) → the weigh-ins
 *   on this device are kept. Same for the target weight.
 * "Undo last restore" (origin.source 'undo') brings back exactly the saved copy, unless that
 * copy was saved by a version without weight tracking: then the weigh-ins here are kept too.
 * Pure: returns a new object and changes neither argument.
 */
const exactWeightRestore = (result, origin) => origin?.source === 'undo' && result.weights.field;
const exactPlanRestore = (result, origin) => origin?.source === 'undo' && !!result.plans?.field;
/** Plans: same rule as weigh-ins. A backup with plans replaces them; one without keeps this device's plans. */
const keepCurrentPlans = (result, origin) => !exactPlanRestore(result, origin) && !result.plans?.count;
function restoredState(result, current, origin) {
  const next = JSON.parse(JSON.stringify(result.state));
  if (!exactWeightRestore(result, origin)) {
    if (!result.weights.count) next.bodyweights = JSON.parse(JSON.stringify(Array.isArray(current.bodyweights) ? current.bodyweights : []));
    if (!result.weights.goal && validWeightGoal(current.settings?.weightGoal)) next.settings.weightGoal = { ...current.settings.weightGoal };
  }
  if (keepCurrentPlans(result, origin)) next.plans = JSON.parse(JSON.stringify(Array.isArray(current.plans) ? current.plans : []));
  // Links must match the workouts and plans that are actually there now.
  return reconcilePlans(next).state;
}

/** What happens to this device's weigh-ins and target in a restore (for messages). */
function weightRestorePlan(result, origin) {
  const here = Array.isArray(state.bodyweights) ? state.bodyweights.length : 0;
  const exact = exactWeightRestore(result, origin);
  return {
    here,
    inBackup: result.weights.count,
    keep: !exact && !result.weights.count,
    keepGoal: !exact && !result.weights.goal && validWeightGoal(state.settings?.weightGoal)
  };
}

/** What happens to this device's plans in a restore (for messages). */
function planRestorePlan(result, origin) {
  return { here: Array.isArray(state.plans) ? state.plans.length : 0, inBackup: result.plans?.count || 0, keep: keepCurrentPlans(result, origin) };
}

/* ---------- Restore ---------- */

/** Read a chosen file and either show what's wrong or ask to confirm the restore. */
function importData(file) {
  if (file.size > MAX_BACKUP_BYTES) { showImportError(['The file is too large to be a Training Tracker backup.']); return; }
  const reader = new FileReader();
  reader.onerror = () => showImportError(['The file could not be read. Try saving it again and choose it from Files.']);
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      showImportError(['The file is not a backup file (it isn\'t valid JSON). Choose a .json file exported from this app.']);
      return;
    }
    let result;
    try {
      result = validateBackup(parsed);
    } catch (e) {
      console.error(e);
      result = { ok: false, errors: ['The file could not be checked. It may be damaged.'] };
    }
    if (!result.ok) showImportError(result.errors);
    else openRestoreConfirm(result, { source: 'file', name: file.name });
  };
  reader.readAsText(file);
}

function showImportError(errors) {
  ui.pendingRestore = null;
  openSheet(`
    <div class="sheet-head">
      <span style="width:52px"></span>
      <h2>Can't restore this file</h2>
      <button class="link" data-action="close-sheet">OK</button>
    </div>
    <div class="sheet-body" role="alert">
      <div class="card card-pad">
        <ul class="backup-problems">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      </div>
      <p class="tpl-hint"><b>Nothing was changed.</b> Your current data is still here.</p>
    </div>`);
}

const countText = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Explain what the backup contains and what will be replaced, then wait for confirmation. */
function openRestoreConfirm(result, origin) {
  const hasCurrent = state.workouts.length || state.templates.length || state.active || state.bodyweights?.length || state.plans?.length;
  ui.pendingRestore = { result, origin, saveCopy: !!hasCurrent };
  renderRestoreConfirm();
}

function renderRestoreConfirm() {
  const { result, origin, saveCopy } = ui.pendingRestore;
  const r = result.state, info = result.info;
  const fmtD = (d) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
  const undo = origin.source === 'undo';
  openSheet(`
    <div class="sheet-head">
      <button class="link" data-action="restore-cancel">Cancel</button>
      <h2>${undo ? 'Undo last restore' : 'Restore backup'}</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body">
      <div class="section-title">${undo ? 'Data from before the last restore' : 'This backup'}</div>
      <div class="card card-pad backup-summary">
        ${!undo ? `<div class="sub">${esc(origin.name || 'Backup file')}${info.exportedAt ? ` · exported ${fmtD(info.exportedAt)}` : info.older ? ' · older backup format' : ''}</div>` : info.exportedAt ? `<div class="sub">Saved ${fmtD(info.exportedAt)}</div>` : ''}
        <div><b>${countText(r.workouts.length, 'workout')}</b>${info.first ? ` · ${fmtD(info.first)} – ${fmtD(info.last)}` : ''}</div>
        <div>${countText(r.templates.length, 'template')} · ${countText(r.exercises.length, 'exercise')} · ${result.weights.count ? countText(result.weights.count, 'weigh-in') : 'no weight data'}${result.plans?.count ? ` · ${countText(result.plans.count, 'plan')}` : ''}</div>
        <div>Units: ${r.settings.unit === 'lb' ? 'lb · mi' : 'kg · km'} · Rest timer ${r.settings.rest} s${r.active ? ' · includes a workout in progress' : ''}</div>
      </div>
      ${result.warnings.length ? `<div class="card card-pad backup-warnings" style="margin-top:10px">${result.warnings.map((w) => `<div>⚠️ ${esc(w)}</div>`).join('')}</div>` : ''}
      ${(() => {
        const wp = weightRestorePlan(result, origin);
        if (!wp.keep || !(wp.here || wp.keepGoal)) return '';
        return `<div class="card card-pad backup-keep" role="note" style="margin-top:10px">
          <b>Your weigh-ins are kept.</b> This backup contains no weight data, so the ${countText(wp.here, 'weigh-in')}${wp.keepGoal ? ' and the target weight' : ''} on this device will stay as they are.
        </div>`;
      })()}

      ${(() => {
        const pp = planRestorePlan(result, origin);
        if (!pp.keep || !pp.here) return '';
        return `<div class="card card-pad backup-keep" role="note" style="margin-top:10px">
          <b>Your plans are kept.</b> This backup contains no plans, so the ${countText(pp.here, 'plan')} on this device will stay. Sessions count as done only if their workout is in the restored data.
        </div>`;
      })()}

      <div class="section-title">Your current data will be replaced</div>
      <div class="card card-pad">
        <div>${countText(state.workouts.length, 'workout')}, ${countText(state.templates.length, 'template')}, ${countText(state.exercises.length, 'exercise')}${(() => { const wp = weightRestorePlan(result, origin); const pp = planRestorePlan(result, origin); return `${wp.keep ? '' : `, ${countText(wp.here, 'weigh-in')}`}${pp.keep || !pp.here ? '' : `, ${countText(pp.here, 'plan')}`}`; })()} and your settings on this device will be replaced by the ${undo ? 'saved data' : 'backup'}.</div>
        ${state.active ? '<div style="margin-top:6px;color:var(--danger)">Your workout in progress will be replaced too.</div>' : ''}
      </div>
      <button class="list-item switch-row" data-action="restore-toggle-copy" role="switch" aria-checked="${saveCopy}">
        <span class="grow">Save a copy of my current data first<span class="sub" style="display:block">Exports a backup file before restoring</span></span>
        <span class="switch ${saveCopy ? 'on' : ''}" aria-hidden="true"></span>
      </button>
      <p class="tpl-hint">A copy also stays on this device, so you can use “Undo last restore” in Settings.</p>

      <div class="btn-row"><button class="btn" data-action="restore-confirm">${undo ? 'Undo Restore' : 'Restore Backup'}</button></div>
      <div class="btn-row"><button class="btn danger" data-action="restore-cancel">Cancel</button></div>
    </div>`);
}

/** Keep the current data on the device so the restore (or an erase) can be undone. */
function keepBeforeRestoreCopy() {
  try {
    localStorage.setItem(BEFORE_RESTORE_KEY, JSON.stringify(buildBackup()));
    return true;
  } catch (e) {
    return false;
  }
}

function beforeRestoreInfo() {
  try {
    const raw = localStorage.getItem(BEFORE_RESTORE_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    return { raw, exportedAt: b.exportedAt, workouts: b.counts?.workouts ?? b.data?.workouts?.length ?? 0 };
  } catch (e) {
    return null;
  }
}

async function confirmRestore() {
  const pending = ui.pendingRestore;
  if (!pending) return;
  const before = state;

  // 1. Optional exported copy of the current data.
  if (pending.saveCopy) {
    let result = 'failed';
    try { result = await shareFile(JSON.stringify(buildBackup(), null, 2), backupFilename('before-restore')); } catch (e) { /* handled below */ }
    if (result !== 'shared' && result !== 'downloaded' &&
        !confirm('The copy of your current data was not saved. Restore anyway? A copy is still kept on this device for “Undo last restore”.')) {
      return;
    }
  }

  // 2. Copy kept on the device (needed for undo). Without it, only continue if a file copy was made.
  const kept = keepBeforeRestoreCopy();
  if (!kept && !pending.saveCopy) {
    alert('There is not enough storage on this device to keep a safety copy. Turn on “Save a copy of my current data first” and try again.');
    return;
  }

  // 3. Replace and write. If writing fails, put the previous data back.
  const next = restoredState(pending.result, before, pending.origin);
  next.lastExportAt = before.lastExportAt;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    state = before;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(before)); } catch (err) { /* unchanged on disk */ }
    ui.pendingRestore = null;
    showImportError(['The backup could not be saved on this device (storage may be full).']);
    return;
  }
  state = next;
  applyTheme();
  ui.pendingRestore = null;
  ui.progressExercise = null;
  if (ui.stats) ui.stats.perfEx = null;
  stopRest();
  closeSheet();
  render();
  const r = next;
  const keptWeights = !exactWeightRestore(pending.result, pending.origin) && !pending.result.weights.count && r.bodyweights.length;
  toast(`Restored ${countText(r.workouts.length, 'workout')}, ${countText(r.templates.length, 'template')}${keptWeights ? ` · kept ${countText(r.bodyweights.length, 'weigh-in')}` : ''}`);
}

/** Restore the copy kept before the last restore or erase (goes through the same checks). */
function undoLastRestore() {
  const b = beforeRestoreInfo();
  if (!b) { toast('Nothing to undo'); return; }
  let result;
  try { result = validateBackup(JSON.parse(b.raw)); } catch (e) { result = { ok: false, errors: ['The saved copy could not be read.'] }; }
  if (!result.ok) showImportError(result.errors);
  else openRestoreConfirm(result, { source: 'undo' });
}
