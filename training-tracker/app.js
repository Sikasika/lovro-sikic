'use strict';

/* =========================================================
   Training Tracker: workouts, sets/reps, rest timer, progress.
   All data is stored on the device in localStorage.
   ========================================================= */

const STORAGE_KEY = 'training-tracker.v1';
// Untouched copy of the data as it was before the v2 upgrade (weights converted to kg).
const BACKUP_KEY = 'training-tracker.v1.backup-before-v2';

const DEFAULT_EXERCISES = [
  ['Bench Press', 'Chest'], ['Incline Dumbbell Press', 'Chest'], ['Push-up', 'Chest'], ['Chest Fly', 'Chest'],
  ['Squat', 'Legs'], ['Deadlift', 'Legs'], ['Romanian Deadlift', 'Legs'], ['Leg Press', 'Legs'],
  ['Lunge', 'Legs'], ['Leg Curl', 'Legs'], ['Leg Extension', 'Legs'], ['Calf Raise', 'Legs'],
  ['Pull-up', 'Back'], ['Barbell Row', 'Back'], ['Lat Pulldown', 'Back'], ['Seated Cable Row', 'Back'],
  ['Overhead Press', 'Shoulders'], ['Lateral Raise', 'Shoulders'], ['Face Pull', 'Shoulders'],
  ['Barbell Curl', 'Arms'], ['Hammer Curl', 'Arms'], ['Tricep Pushdown', 'Arms'], ['Dip', 'Arms'],
  ['Plank', 'Core'], ['Hanging Leg Raise', 'Core'], ['Crunch', 'Core'],
  ['Running', 'Cardio'], ['Walking', 'Cardio'], ['Cycling', 'Cardio'], ['Swimming', 'Cardio'], ['Rowing', 'Cardio']
];

/** Cardio exercises added in a later version; given once to existing users who lack them. */
const ADDED_CARDIO_EXERCISES = ['Walking', 'Swimming'];

/** Add missing newer default exercises once (never removes anything, never re-adds after deletion). */
function addNewDefaultExercises(st) {
  if (st.cardioExercisesAdded) return false;
  const have = new Set((st.exercises || []).map((e) => String(e.name).trim().toLowerCase()));
  ADDED_CARDIO_EXERCISES.forEach((name) => {
    if (!have.has(name.toLowerCase())) st.exercises.push({ id: uid(), name, category: 'Cardio' });
  });
  st.cardioExercisesAdded = true;
  return true;
}

/* ---------- State ---------- */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function defaultState() {
  return {
    exercises: DEFAULT_EXERCISES.map(([name, category]) => ({ id: uid(), name, category })),
    workouts: [],
    templates: [],
    active: null,
    bodyweights: [], // weigh-ins, see bodyweight.js
    plans: [], // plans and programs, see plans.js
    settings: { unit: 'kg', rest: 90, theme: 'system', plateauWeeks: 6, weightStepKg: 2.5, weightStepLb: 5 },
    schemaVersion: SCHEMA_VERSION,
    cardioExercisesAdded: true
  };
}

/**
 * Bring data saved by an older version up to the current format.
 * Returns a new object; the input is left unchanged.
 * v1 → v2: v1 stored weights exactly as typed, in whichever unit was selected
 * (the unit switch only changed the label). v2 stores kilograms, so v1 data
 * saved with "lb" selected is converted; "kg" data keeps its numbers.
 */
function migrate(data) {
  const out = JSON.parse(JSON.stringify(data));
  if ((Number(out.schemaVersion) || 1) < 2) {
    if (out.settings?.unit === 'lb') {
      // Runs during startup, before app.js helpers such as num() exist.
      const convert = (w) => (w?.entries || []).forEach((e) => (e?.sets || []).forEach((set) => {
        if (set?.weight === '' || set?.weight == null) return;
        const v = Number(String(set.weight).replace(',', '.'));
        if (Number.isFinite(v)) set.weight = v * KG_PER_LB;
      }));
      (out.workouts || []).forEach(convert);
      if (out.active) convert(out.active);
    }
    out.schemaVersion = 2;
  }
  return out;
}

let loadWarning = null;

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      let data = JSON.parse(raw);
      if ((Number(data.schemaVersion) || 1) < SCHEMA_VERSION) {
        // Keep the original before changing anything (the oldest copy wins).
        try {
          if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, raw);
        } catch (e) {
          loadWarning = 'Your data was updated to a new format, but there was no room to keep a safety copy. Please export a backup in Settings.';
        }
        data = migrate(data);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* saved on the next change */ }
      }
      const st = { ...defaultState(), ...data, settings: { ...defaultState().settings, ...data.settings } };
      if (!Array.isArray(st.plans)) st.plans = [];
      if (!data.cardioExercisesAdded) {
        st.cardioExercisesAdded = false;
        if (addNewDefaultExercises(st)) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(st)); } catch (e) { /* saved on the next change */ }
        }
      }
      return st;
    }
  } catch (e) {
    console.error('Could not load data', e);
    // Never let unreadable data be overwritten: keep it under a separate key.
    if (raw) {
      try { localStorage.setItem(`${STORAGE_KEY}.unreadable-${Date.now()}`, raw); } catch (err) { /* ignore */ }
      loadWarning = 'Your saved data could not be read. A copy was kept on this device, so please don\'t erase anything; ask for help restoring it.';
    }
  }
  return defaultState();
}

let state = load();

/* ---------- Theme ---------- */

const THEME_COLORS = { light: '#eef2f7', dark: '#070b14' };
/** Apply Settings → Theme: 'system' follows the iPhone appearance, 'light'/'dark' force it. */
function applyTheme() {
  const t = state.settings.theme;
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  // Status bar / browser chrome colour: per-scheme defaults unless a theme is forced.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const scheme = (m.getAttribute('media') || '').includes('dark') ? 'dark' : 'light';
    m.setAttribute('content', THEME_COLORS[t === 'light' || t === 'dark' ? t : scheme]);
  });
}
applyTheme();
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save. Storage may be full.');
  }
}

// Opens on Home; straight into the logger when a workout is in progress.
const ui = { pendingRestore: null, tab: state.active ? 'workout' : 'home', progressView: 'progress', progressExercise: null, restEnd: null, draft: null, draftOriginal: null, wdraft: null, wdraftOriginal: null,
  review: null, savedId: null, wkScroll: 0, tapGuardUntil: 0, // Workout tab state: see workout.js
  bw: { range: '3m', back: 'card', editId: null } }; // Body weight: see bodyweight.js

/* ---------- Helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const fmtNum = (n) => (n == null ? '–' : (Math.round(n * 10) / 10).toLocaleString());
const unit = () => state.settings.unit;
const exById = (id) => state.exercises.find((e) => e.id === id);
const exName = (id) => exById(id)?.name ?? 'Deleted exercise';

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(iso).toLocaleDateString(undefined, opts);
}

function defaultWorkoutName() {
  const h = new Date().getHours();
  if (h < 11) return 'Morning Workout';
  if (h < 17) return 'Afternoon Workout';
  return 'Evening Workout';
}

// Set validity, e1rm and unit conversion live in calc.js.

/** Weight × reps over completed sets, excluding warm-ups. */
function workoutVolume(w) {
  return w.entries.reduce((sum, e) => sum + completedSets(e).filter((set) => set.type !== 'warmup').reduce((s, set) => s + (num(set.weight) || 0) * (num(set.reps) || 0), 0), 0);
}

function workoutSetCount(w) {
  return w.entries.reduce((n, e) => n + completedSets(e).length, 0);
}

/** Most recent finished workout entry for an exercise. */
function lastEntryFor(exerciseId) {
  for (const w of state.workouts) {
    const entry = w.entries.find((e) => e.exerciseId === exerciseId);
    if (entry && completedSets(entry).length) return entry;
  }
  return null;
}

const hasCardioValues = (s) => (num(s?.distance) || 0) > 0 || (num(s?.duration) || 0) > 0;

function summarizeSets(sets, kind = null) {
  // Warm-ups and drop sets are marked "W" / "D". Distance/time are shown even if the
  // exercise was later moved out of Cardio.
  return sets.map((s) => {
    const prefix = setType(s) === 'working' ? '' : `${SET_TYPE_INFO[setType(s)].short} `;
    if (hasCardioValues(s)) return prefix + fmtCardio(num(s.distance) || 0, num(s.duration) || 0, kind || 'other');
    return prefix + (num(s.weight) ? `${fmtWeight(num(s.weight))}×${num(s.reps) ?? 0}` : `${num(s.reps) ?? 0} reps`);
  }).join(', ');
}

/** Value shown in a time input: stored seconds → "25:30". */
const inputClock = (sec) => (num(sec) == null ? '' : fmtClock(num(sec)));
/** Optional cardio fields of a set, only when present (keeps other sets unchanged). */
function cardioFields(s) {
  const out = {};
  const d = num(s?.distance), t = num(s?.duration);
  if (d != null && d >= 0) out.distance = d;
  if (t != null && t >= 0) out.duration = t;
  return out;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function haptic() {
  if (navigator.vibrate) navigator.vibrate(30);
}

/* ---------- Rendering ---------- */

const TITLES = { home: 'Today', workout: 'Train', plans: 'Plans', history: 'History', progress: 'Progress', insights: 'Progress', statistics: 'Progress', body: 'Progress', settings: 'Settings' };
/** Which tab bar button is highlighted for each screen (Progress sections and Settings live under a tab). */
const TAB_OF = { insights: 'progress', statistics: 'progress', body: 'progress', settings: 'home' };

function render() {
  $('#title').textContent = TITLES[ui.tab] || '';
  const tabBtn = TAB_OF[ui.tab] || ui.tab;
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabBtn);
    if (b.dataset.tab === tabBtn) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const view = $('#view');
  const action = $('#topbar-action');
  action.innerHTML = '';
  document.body.classList.toggle('in-session', ui.tab === 'workout' && !!state.active);
  if (ui.tab === 'workout') {
    view.innerHTML = state.active ? renderActive(action) : renderStart();
    if (state.active) syncWorkoutStatus();
  }
  if (ui.tab === 'home') view.innerHTML = renderHome(action);
  if (ui.tab === 'plans') view.innerHTML = renderPlans();
  if (ui.tab === 'history') view.innerHTML = renderHistory();
  // Progress sections (home.js): Overview, Insights, Statistics, Body weight.
  if (isProgressView(ui.tab)) {
    ui.progressView = ui.tab;
    const body = { progress: renderProgress, insights: renderInsights, statistics: renderStatistics, body: renderBodyView }[ui.tab]();
    view.innerHTML = progressSubnav(ui.tab) + body;
  }
  if (ui.tab === 'settings') view.innerHTML = `<button type="button" class="link back-link" data-tab="home">‹ Today</button>${renderSettings()}`;
  updateLiveBar();
}

/* The Workout tab (start screen, live workout, finishing) is in workout.js. */

/* ----- Templates ----- */

/*
  Template format: { id, name, entries: [{ exerciseId, sets: [{ weight, reps }] }] }
  where weight is a target in kg (number) or '' and reps is a target number or ''.
  Templates and workouts saved by older versions may also have a `location`; it is
  kept as it is (no longer shown or asked for).
  Templates saved by older versions store sets as a count ({ sets: 3 }); they are read
  as that many empty sets and only rewritten in the new format when edited and saved.
*/

/** Planned sets of a template entry, in the current format (never mutates the template). */
function templateSets(entry) {
  if (Array.isArray(entry?.sets)) {
    return entry.sets.map((s) => ({ weight: num(s?.weight) ?? '', reps: num(s?.reps) ?? '', ...cardioFields(s), ...typeField(s) }));
  }
  const n = Math.max(1, Math.min(50, Math.round(Number(entry?.sets)) || 1));
  return Array.from({ length: n }, () => ({ weight: '', reps: '' }));
}

const emptyPlannedSet = () => ({ weight: '', reps: '' });

/** Turn workout entries into template entries, keeping each set's weight and reps as targets. */
function entriesToTemplate(entries) {
  return entries.map((e) => ({
    exerciseId: e.exerciseId,
    sets: (e.sets.length ? e.sets : [emptyPlannedSet()]).map((s) => {
      const w = num(s.weight), r = num(s.reps);
      return { weight: w != null && w >= 0 ? w : '', reps: r != null && r >= 0 ? r : '', ...cardioFields(s), ...typeField(s) };
    }),
    ...entryExtras(e)
  }));
}

/** Planned sets for a newly added exercise: last time's sets if any, else three empty ones. */
function defaultPlannedSets(exerciseId) {
  const last = lastEntryFor(exerciseId);
  return last ? entriesToTemplate([{ exerciseId, sets: completedSets(last) }])[0].sets : [emptyPlannedSet(), emptyPlannedSet(), emptyPlannedSet()];
}

/** Start editing a copy of a template (or a new one); the original is untouched until Save. */
function beginTemplateDraft(t) {
  ui.draft = t
    ? { id: t.id, name: t.name || '', entries: t.entries.map((e) => ({ exerciseId: e.exerciseId, sets: templateSets(e), ...entryExtras(e) })) }
    : { id: null, name: '', entries: [] };
  ui.draftOriginal = JSON.stringify(ui.draft);
}

const draftChanged = () => ui.draft && JSON.stringify(ui.draft) !== ui.draftOriginal;

/** Close the editor, asking first if there are unsaved changes. */
function cancelTemplateDraft() {
  if (draftChanged() && !confirm('Discard your changes to this template?')) return;
  ui.draft = null;
  closeSheet();
}

function openTemplateEditor() {
  const d = ui.draft;
  const isEditor = !!$('#sheet .template-editor');
  const scroll = isEditor ? ($('#sheet .sheet-body')?.scrollTop ?? 0) : ui.returnScroll;
  ui.returnScroll = null;
  const u = esc(unit());
  openSheet(`
    <div class="sheet-head">
      <button class="link" data-action="cancel-template">Cancel</button>
      <h2>${d.id ? 'Edit Template' : 'New Template'}</h2>
      <button class="link" data-action="save-template" style="font-weight:600">Save</button>
    </div>
    <div class="sheet-body template-editor">
      <div class="card">
        <label class="field"><span>Name</span><input id="draft-name" value="${esc(d.name)}" placeholder="e.g. Push Day" autocomplete="off"></label>
      </div>

      <div class="section-title">Exercises</div>
      ${editorExerciseCards(d.entries, 'draft')}
      <div class="btn-row" style="margin-top:16px"><button class="btn secondary" data-action="draft-add-exercise">＋ Add Exercise</button></div>
      <p class="tpl-hint">Leave a target empty to fill it in during the workout. Weights are in ${u}.</p>

      ${d.id ? `<div class="btn-row"><button class="btn danger" data-action="delete-template" data-id="${d.id}">Delete Template</button></div>` : ''}
    </div>
  `);
  // Keep the scroll position when the editor re-renders after a change or a set menu.
  if (scroll != null) $('#sheet .sheet-body').scrollTop = scroll;
}

/**
 * Exercise cards with editable sets, shared by the template editor (kind 'draft',
 * target weight/reps) and the saved-workout editor (kind 'wedit', logged weight/reps).
 * Weights are stored in kg and shown in the selected unit.
 */
function editorExerciseCards(entries, kind) {
  if (!entries.length) return '<div class="card card-pad" style="color:var(--muted)">No exercises yet.</div>';
  const u = esc(unit());
  const field = kind === 'draft' ? 'data-tfield' : 'data-wfield';
  const target = kind === 'draft' ? 'Target ' : '';
  const letters = supersetLetters(entries);
  return entries.map((e, i) => {
    const name = esc(exName(e.exerciseId));
    const ck = cardioKindOf(e.exerciseId);
    const labels = setLabels(e.sets);
    const ss = letters[i];
    const ssCont = ss && letters[i - 1] === ss;
    return `
    <div class="card exercise-card tpl-card${ss ? ' superset' : ''}" style="margin-top:${ssCont ? 4 : 12}px">
      <div class="ex-head">
        <span class="ex-name">${ss ? `<span class="ss-badge">Superset ${ss}</span>` : ''}${name}</span>
        <span class="tpl-ex-actions">
          <button class="icon-btn" data-action="${kind}-move-ex" data-entry="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${name} up">↑</button>
          <button class="icon-btn" data-action="${kind}-move-ex" data-entry="${i}" data-dir="1" ${i === entries.length - 1 ? 'disabled' : ''} aria-label="Move ${name} down">↓</button>
          <button class="icon-btn danger" data-action="${kind}-remove" data-entry="${i}" aria-label="Remove ${name}">✕</button>
        </span>
      </div>
      <div class="ex-note-row"><input class="ex-note-input" data-note="${kind}" data-entry="${i}" value="${esc(e.note || '')}" placeholder="${kind === 'draft' ? 'Exercise note, e.g. pause at the bottom' : 'Exercise note'}" aria-label="Note for ${name}"></div>
      <table class="sets tpl-sets">
        <thead><tr><th>Set</th>${ck ? `<th>${target}${distanceUnit(ck)}</th><th>${target}time</th>` : `<th>${target}${u}</th><th>${target}reps</th>`}<th><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>
          ${e.sets.map((st, j) => `
          <tr class="type-${setType(st)}">
            <td class="set-num"><button class="set-label ${setType(st)}" data-action="set-menu" data-ctx="${kind}" data-entry="${i}" data-set="${j}" aria-label="${setType(st) === 'working' ? `Set ${labels[j]}` : SET_TYPE_INFO[setType(st)].label}. Change type, move or delete">${labels[j]}</button></td>
            ${ck ? `
            <td><input inputmode="decimal" ${field}="distance" data-kind="${ck}" data-entry="${i}" data-set="${j}" value="${esc(inputDistance(num(st.distance), ck))}" placeholder="–" aria-label="${name} set ${j + 1} ${target.toLowerCase()}distance (${distanceUnit(ck)})"></td>
            <td><input inputmode="decimal" ${field}="duration" data-entry="${i}" data-set="${j}" value="${esc(inputClock(st.duration))}" placeholder="min" aria-label="${name} set ${j + 1} ${target.toLowerCase()}time, minutes or mm:ss"></td>` : `
            <td><input inputmode="decimal" ${field}="weight" data-entry="${i}" data-set="${j}" value="${esc(inputWeight(num(st.weight)))}" placeholder="–" aria-label="${name} set ${j + 1} ${target.toLowerCase()}weight (${u})"></td>
            <td><input inputmode="numeric" ${field}="reps" data-entry="${i}" data-set="${j}" value="${esc(st.reps)}" placeholder="–" aria-label="${name} set ${j + 1} ${target.toLowerCase()}reps"></td>`}
            <td class="tpl-set-actions">
              <button class="icon-btn" data-action="${kind}-move-set" data-entry="${i}" data-set="${j}" ${j === 0 ? 'disabled' : ''} aria-label="Move set ${j + 1} up">↑</button>
              <button class="icon-btn danger" data-action="${kind}-remove-set" data-entry="${i}" data-set="${j}" ${e.sets.length === 1 ? 'disabled' : ''} aria-label="Remove set ${j + 1}">✕</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="ex-actions">
        <button class="link" data-action="${kind}-add-set" data-entry="${i}">＋ Add Set</button>
        ${i < entries.length - 1 && (!e.superset || entries[i + 1].superset !== e.superset)
          ? `<button class="link" data-action="${kind}-link" data-entry="${i}">Superset with next</button>`
          : e.superset ? `<button class="link" data-action="${kind}-unlink" data-entry="${i}">Unlink</button>` : `<span class="sub">${e.sets.length} set${e.sets.length === 1 ? '' : 's'}</span>`}
      </div>
    </div>`;
  }).join('');
}

/** Add, remove or reorder exercises and sets in an editor's entries. Returns true if something changed. */
function editEntries(entries, op, ei, si, dir) {
  if (op === 'move-ex') {
    const to = ei + dir;
    if (to < 0 || to >= entries.length) return false;
    [entries[ei], entries[to]] = [entries[to], entries[ei]];
    normalizeSupersets(entries);
  } else if (op === 'link') {
    linkWithNext(entries, ei);
  } else if (op === 'unlink') {
    unlinkSuperset(entries, ei);
  } else if (op === 'remove') {
    if (!confirm(`Remove ${exName(entries[ei].exerciseId)}?`)) return false;
    entries.splice(ei, 1);
    normalizeSupersets(entries);
  } else if (op === 'add-set') {
    const sets = entries[ei].sets;
    sets.push({ ...sets[sets.length - 1] });
  } else if (op === 'remove-set') {
    if (entries[ei].sets.length < 2) return false;
    entries[ei].sets.splice(si, 1);
  } else if (op === 'move-set') {
    const sets = entries[ei].sets;
    if (si < 1) return false;
    [sets[si - 1], sets[si]] = [sets[si], sets[si - 1]];
  }
  return true;
}

function saveTemplate() {
  const d = ui.draft;
  const old = state.templates.find((t) => t.id === d.id);
  const tpl = {
    id: d.id || uid(),
    name: d.name.trim() || 'My Template',
    ...(old?.location ? { location: old.location } : {}), // kept from older versions
    entries: normalizeSupersets(d.entries.map((e) => ({ exerciseId: e.exerciseId, sets: templateSets(e), ...entryExtras(e) })))
  };
  const i = state.templates.findIndex((t) => t.id === d.id);
  if (i >= 0) state.templates[i] = tpl;
  else state.templates.push(tpl);
  ui.draft = null;
  save();
  closeSheet();
  render();
  toast('Template saved');
}

/** Save a workout (in progress or finished) as a new template. */
function saveAsTemplate(w) {
  if (!w.entries.length) { alert('Add at least one exercise first.'); return; }
  state.templates.push({ id: uid(), name: w.name, entries: entriesToTemplate(w.entries) });
  save();
  toast(`Saved “${w.name}” as a template`);
}

/* ----- Set types, exercise notes and supersets ----- */

/*
  Optional fields (absent in older data, which keeps working unchanged):
    set.type      'warmup' | 'drop'   (no type = working set)
    set.target    { weight, reps, distance, duration } planned by a template
    entry.note    text note for that exercise in that workout/template
    entry.superset  group id shared by consecutive exercises done as a superset
*/
const SET_TYPE_INFO = { working: { short: '', label: 'Working set' }, warmup: { short: 'W', label: 'Warm-up' }, drop: { short: 'D', label: 'Drop set' } };
const setType = (s) => (s?.type === 'warmup' || s?.type === 'drop' ? s.type : 'working');
const typeField = (s) => (setType(s) === 'working' ? {} : { type: setType(s) });

/** Set labels: working sets numbered 1..n, warm-ups "W", drop sets "D". */
function setLabels(sets) {
  let n = 0;
  return sets.map((s) => (setType(s) === 'working' ? String(++n) : SET_TYPE_INFO[setType(s)].short));
}

/** "Superset A", "B", ... for each entry in order of first appearance (null when not grouped). */
function supersetLetters(entries) {
  const seen = new Map();
  return entries.map((e) => {
    if (!e.superset) return null;
    if (!seen.has(e.superset)) seen.set(e.superset, String.fromCharCode(65 + (seen.size % 26)));
    return seen.get(e.superset);
  });
}

/** Keep superset groups valid: consecutive, at least two exercises each. */
function normalizeSupersets(entries) {
  const used = new Set();
  let i = 0;
  while (i < entries.length) {
    const id = entries[i].superset;
    let j = i;
    while (id && j + 1 < entries.length && entries[j + 1].superset === id) j++;
    if (id) {
      if (j === i) delete entries[i].superset;
      else if (used.has(id)) { const fresh = uid(); for (let k = i; k <= j; k++) entries[k].superset = fresh; used.add(fresh); }
      else used.add(id);
    }
    i = j + 1;
  }
  return entries;
}

function linkWithNext(entries, i) {
  const a = entries[i], b = entries[i + 1];
  if (!b) return;
  const id = a.superset || b.superset || uid();
  const old = b.superset;
  entries.forEach((e) => { if (old && e.superset === old) e.superset = id; });
  a.superset = id; b.superset = id;
  normalizeSupersets(entries);
}
function unlinkSuperset(entries, i) {
  delete entries[i].superset;
  normalizeSupersets(entries);
}
/** Rest only after the last exercise of a superset round. */
const isLastInSuperset = (entries, i) => !entries[i].superset || entries[i + 1]?.superset !== entries[i].superset;

/** Exercise-level fields carried between workouts, templates and editors. */
function entryExtras(e, { keepNote = true, keepPlan = false } = {}) {
  const out = {};
  if (keepNote && typeof e.note === 'string' && e.note.trim()) out.note = e.note.trim();
  if (e.superset) out.superset = e.superset;
  // Program target and swap record: kept when editing a saved workout, never copied into
  // templates or repeated workouts.
  if (keepPlan && e.planned) out.planned = { ...e.planned };
  if (keepPlan && e.swappedFrom != null) out.swappedFrom = e.swappedFrom;
  return out;
}

/** Planned values of a set that has any (from a template), else null. */
function plannedValues(p) {
  const t = {};
  ['weight', 'reps', 'distance', 'duration'].forEach((k) => { const v = num(p?.[k]); if (v != null && v > 0) t[k] = v; });
  return Object.keys(t).length ? t : null;
}

/** Short text for one set's values, e.g. "60×8", "12 reps", "5.00 km · 25:00 · …". */
function setValueText(s, kind) {
  if (hasCardioValues(s)) return fmtCardio(num(s.distance) || 0, num(s.duration) || 0, kind || 'other');
  if (num(s.weight)) return `${fmtWeight(num(s.weight))}×${num(s.reps) ?? 0}`;
  return num(s.reps) != null ? `${num(s.reps)} reps` : '–';
}

/** Which list of entries a context refers to: the live workout, the template draft or the workout draft. */
const contextEntries = (ctx) => (ctx === 'active' ? state.active?.entries : ctx === 'draft' ? ui.draft?.entries : ui.wdraft?.entries);

/** Return to whatever was open after a small menu (set menu) closes. */
function returnFromMenu(ctx) {
  if (ctx === 'active') { save(); closeSheet(); render(); }
  else if (ctx === 'draft') openTemplateEditor();
  else openWorkoutEditor();
}

/** Menu for one set: type, move, delete. Used by the live workout and both editors. */
function openSetMenu(ctx, ei, si) {
  const entries = contextEntries(ctx);
  const sets = entries[ei].sets;
  const t = setType(sets[si]);
  if (ctx !== 'active') ui.returnScroll = $('#sheet .sheet-body')?.scrollTop ?? 0;
  const label = setLabels(sets)[si];
  const btn = (action, text, extra = '') => `<button class="list-item" data-action="${action}" data-ctx="${ctx}" data-entry="${ei}" data-set="${si}" ${extra}>${text}</button>`;
  openSheet(`
    <div class="sheet-head">
      <span style="width:52px"></span>
      <h2>${esc(exName(entries[ei].exerciseId))} · ${t === 'working' ? `Set ${label}` : SET_TYPE_INFO[t].label}</h2>
      <button class="link" data-action="set-menu-back" data-ctx="${ctx}">Cancel</button>
    </div>
    <div class="sheet-body">
      <div class="section-title">Set type</div>
      <div class="card" role="radiogroup" aria-label="Set type">
        ${['working', 'warmup', 'drop'].map((k) => btn('set-type', `<span class="grow">${SET_TYPE_INFO[k].label}</span>${t === k ? '<span class="tick" aria-hidden="true">✓</span>' : ''}`, `data-v="${k}" role="radio" aria-checked="${t === k}"`)).join('')}
      </div>
      <div class="card" style="margin-top:12px">
        ${si > 0 ? btn('set-move', 'Move set up', 'data-dir="-1"') : ''}
        ${si < sets.length - 1 ? btn('set-move', 'Move set down', 'data-dir="1"') : ''}
        ${sets.length > 1 ? btn('set-delete', 'Delete set', 'style="color:var(--danger)"') : ''}
      </div>
    </div>`);
}

/* ----- History tab ----- */

/** Distinct exercises with at least one completed set. */
const workoutExerciseCount = (w) => new Set(w.entries.filter((e) => completedSets(e).length).map((e) => e.exerciseId)).size;
const countWord = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function renderHistory() {
  if (!state.workouts.length) {
    return `<div class="empty"><div class="big">📅</div>No workouts yet.<br>Finished workouts will show up here.</div>`;
  }
  const groups = new Map();
  for (const w of state.workouts) {
    const key = fmtDate(w.start, { month: 'long', year: 'numeric' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  return [...groups].map(([month, list]) => `
    <div class="section-title">${esc(month)}</div>
    <div class="card">
      ${list.map((w) => {
        const vol = workoutVolume(w);
        const meta = [workoutDurationText(w) === '–' ? 'No duration' : workoutDurationText(w), countWord(workoutExerciseCount(w), 'exercise'), countWord(workoutSetCount(w), 'set')];
        if (vol > 0) meta.push(`${fmtWeight(vol)} ${unit()}`);
        return `
        <button type="button" class="list-item hist-item" data-action="open-workout" data-id="${esc(w.id)}">
          <div class="grow">
            <div class="hist-top"><span class="truncate hist-name">${esc(w.name)}</span><span class="hist-date">${fmtDate(w.start)}</span></div>
            <div class="sub">${w.planned ? `<span class="plan-tag small">Plan</span> ` : ''}${esc(meta.join(' · '))}</div>
          </div>
          <span class="chev">›</span>
        </button>`;
      }).join('')}
    </div>`).join('');
}

/** Duration of a saved workout, or – when it has no valid end time. */
function workoutDurationText(w) {
  const ms = new Date(w.end) - new Date(w.start);
  return isNaN(ms) || ms < 0 ? '–' : fmtDuration(ms);
}

/** Value of one saved set: "60 kg × 10", "12 reps", "5.00 km · 25:00 · 5:00 /km". */
function historySetText(s, ck) {
  const d = num(s.distance) || 0, t = num(s.duration) || 0;
  if (ck && (d || t)) return fmtCardio(d, t, ck);
  const w = num(s.weight), r = num(s.reps);
  if (!w && r == null) return '–';
  return `${w ? `${fmtWeight(w)} ${unit()} × ` : ''}${r ?? 0}${w ? '' : ' reps'}`;
}
const shortSet = (s) => (num(s.weight) ? `${fmtWeight(num(s.weight))}×${num(s.reps) ?? 0}` : `${num(s.reps) ?? 0} reps`);
const signedNum = (v, f = fmtNum) => `${v > 0 ? '+' : '−'}${f(Math.abs(v))}`;

/** "+2.5 kg", "+1 rep", "+2.5 kg, −1 rep", "same" — never "better" or "worse". */
function deltaText(dl) {
  const parts = [];
  // Differences that round to 0 in the display unit count as unchanged.
  if (dl.dw != null && Math.abs(toDisplayWeight(dl.dw)) >= 0.05) parts.push(`${signedNum(dl.dw, fmtWeight)} ${unit()}`);
  if (dl.dr) parts.push(`${dl.dr > 0 ? '+' : '−'}${Math.abs(dl.dr)} rep${Math.abs(dl.dr) === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'same';
}

/**
 * Comparison of one exercise with its previous session (rules in calc.js):
 * { line: html, perSet: Map(set → html) }.
 */
function exerciseComparison(w, exerciseId, ck) {
  const perSet = new Map();
  const cur = comparableSets(w, exerciseId);
  const prev = previousExerciseSession(state.workouts, w, exerciseId);
  const dateText = (x) => fmtDate(x.workout.start, { weekday: 'short', day: 'numeric', month: 'short', year: new Date(x.workout.start).getFullYear() === new Date(w.start).getFullYear() ? undefined : 'numeric' });
  if (!prev) return { line: '<div class="hcmp muted">No previous session</div>', perSet };
  if (!cur.working.length && !cur.drop.length) return { line: `<div class="hcmp muted">Previous ${esc(dateText(prev))}: only warm-ups logged this time, so nothing to compare</div>`, perSet };
  if (ck) {
    const a = cardioTotals(cur), b = cardioTotals(prev.sets);
    const desc = (t) => [t.dist ? fmtDistance(t.dist, ck) : null, t.time ? fmtClock(t.time) : null].filter(Boolean).join(' · ') || 'no distance or time';
    const parts = [];
    if (a.dist && b.dist && Math.abs(a.dist - b.dist) > 0.5) parts.push(`${signedNum(a.dist - b.dist, (m) => fmtDistance(m, ck))}`);
    if (a.time && b.time && Math.abs(a.time - b.time) >= 1) parts.push(`${a.time > b.time ? '+' : '−'}${fmtClock(Math.abs(a.time - b.time))}`);
    if (a.bd && a.bt && b.bd && b.bt && paceUnit(ck)) {
      const pa = paceSeconds(a.bt, a.bd, ck), pb = paceSeconds(b.bt, b.bd, ck);
      if (Math.abs(pa - pb) >= 1) parts.push(`pace ${pa > pb ? '+' : '−'}${fmtClock(Math.abs(pa - pb))} ${paceUnit(ck)}`);
    } else if (a.bd && a.bt && b.bd && b.bt && CARDIO_KINDS[ck]?.speed) {
      const sa = speedValue(a.bd, a.bt), sb = speedValue(b.bd, b.bt);
      if (Math.abs(sa - sb) >= 0.05) parts.push(`speed ${signedNum(sa - sb)} ${speedUnit()}`);
    }
    const comparable = (a.dist && b.dist) || (a.time && b.time);
    return { line: `<div class="hcmp"><span class="muted">Previous ${esc(dateText(prev))}:</span> ${esc(desc(b))}${comparable ? ` · <b>${esc(parts.length ? parts.join(' · ') : 'same')}</b>` : ''}</div>`, perSet };
  }
  for (const pair of matchSets(cur, prev.sets)) {
    perSet.set(pair.cur, pair.delta
      ? `<span class="hcmp-d">${esc(deltaText(pair.delta))}</span><span class="hcmp-was">was ${esc(shortSet(pair.prev))}</span>`
      : `<span class="hcmp-was">was ${esc(shortSet(pair.prev))}</span>`);
  }
  const list = [...prev.sets.working.map(shortSet), ...prev.sets.drop.map((x) => `D ${shortSet(x)}`)].join(', ');
  const diff = cur.working.length - prev.sets.working.length;
  const countNote = diff ? ` · ${countWord(Math.abs(diff), 'working set')} ${diff > 0 ? 'more' : 'fewer'} this time` : '';
  return { line: `<div class="hcmp"><span class="muted">Previous ${esc(dateText(prev))}:</span> ${esc(list)}${esc(countNote)}</div>`, perSet };
}

/* ----- Progression display (rules in calc.js), shared by History and the Workout tab ----- */

const shortDay = (iso) => fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const loadText = (kg) => `${fmtWeight(kg)} ${unit()}`;
const setPair = (s) => (setW(s) ? `${fmtWeight(setW(s))} ${unit()} × ${setR(s)}` : `${setR(s)} reps`);

/** Trend line (↑ ↓ → with words), or a plain "no clear trend" note. '' when there's nothing to compare. */
function trendHtml(t, vsLabel) {
  if (!t) return '';
  if (!t.dir) {
    const why = t.reason === 'mixed' ? 'one session used added weight and the other bodyweight only'
      : `the weights differ and sets above ${E1RM_MAX_REPS} reps can't be converted to estimated strength`;
    return `<div class="trend none"><span class="trend-t">No clear trend ${esc(vsLabel)}: ${esc(why)}.</span></div>`;
  }
  const ic = { up: '↑', down: '↓', same: '→' }[t.dir];
  const reps = (d) => `${d > 0 ? '+' : '−'}${Math.abs(d)} rep${Math.abs(d) === 1 ? '' : 's'}`;
  let text;
  if (t.kind === 'weight') text = t.dir === 'same' ? `No significant change at ${loadText(t.weight)} (best set ${t.curReps} reps)` : `${reps(t.dr)} at ${loadText(t.weight)}`;
  else if (t.kind === 'reps') text = t.dir === 'same' ? `No significant change (best set ${t.curReps} reps)` : `${reps(t.dr)} (best set ${t.curReps} vs ${t.prevReps})`;
  else if (t.kind === 'heavier') text = `${setPair(t.cur)} vs ${setPair(t.prev)} (heavier, at least as many reps)`;
  else if (t.kind === 'lighter') text = `${setPair(t.cur)} vs ${setPair(t.prev)} (lighter, no more reps)`;
  else {
    const pct = `${t.pct > 0 ? '+' : '−'}${Math.round(Math.abs(t.pct) * 100)}%`;
    text = t.dir === 'same'
      ? `No significant change: ${setPair(t.cur)} vs ${setPair(t.prev)} (similar estimated strength)`
      : `${setPair(t.cur)} vs ${setPair(t.prev)} (estimated strength ${pct})`;
  }
  return `<div class="trend ${t.dir}"><span class="trend-ic" aria-hidden="true">${ic}</span><span class="trend-t">${esc(text)} <span class="trend-vs">${esc(vsLabel)}</span></span></div>`;
}

/** Recommendation line (neutral colour, never an arrow). '' when there is none. */
function adviceHtml(a, label, basis, extra = '') {
  if (!a) return '';
  const text = a.action === 'keep' ? `Keep ${loadText(a.load)} · aim for more reps`
    : `${a.action === 'increase' ? 'Increase' : 'Decrease'} weight${a.next != null ? ` → ${loadText(a.next)}` : ''}`;
  return `<div class="rec rec-${a.action}"><span class="rec-k">${esc(label)}</span><span class="rec-t"><b>${esc(text)}</b> <span class="rec-basis">${esc(basis)}</span></span>${extra}</div>`;
}

/** Which plan session a saved workout was done for (and whether it still counts for it). */
function planContextLine(w) {
  const p = w.planned;
  const plan = w.plan && findPlan(state, w.plan.planId);
  const linked = plan && sessionStatus(plan, w.plan.sessionKey)?.workoutId === w.id;
  return `<div class="plan-context"><span class="plan-tag">Plan</span><span>${esc(p.planName)}${p.week ? ` · Week ${esc(p.week)}` : ''} · ${esc(p.title)}${p.date ? ` (planned ${esc(sessionDayText(p.date))})` : ''}${linked ? '' : ' · no longer linked to the plan'}</span></div>`;
}

/** Trend + recommendation for one strength exercise in a saved workout. */
function historyProgression(w, exerciseId) {
  const cur = progressionSets(w, exerciseId);
  if (!cur.length) return '';
  const prev = previousWorkingSession(state.workouts, w, exerciseId);
  const later = laterWorkingSession(state.workouts, w, exerciseId);
  const range = workoutRepRange(w, exerciseId);
  const advice = progressionAdvice(cur, weightStep(), range);
  const target = isDefaultRange(range) ? '' : ` · target ${rangeText(range)}`;
  const trend = prev ? trendHtml(strengthTrend(cur, prev.sets), `vs ${shortDay(prev.workout.start)}`) : '';
  const rec = later
    ? adviceHtml(advice, 'At the time', `from this session · done again on ${shortDay(later.start)}${target}`)
    : adviceHtml(advice, 'Next time', `from this session${target}`);
  return trend || rec ? `<div class="prog">${trend}${rec}</div>` : '';
}

/** Every saved set of an entry, completed or not, with its comparison. */
function historySetRows(e, ck, perSet) {
  const labels = setLabels(e.sets || []);
  return (e.sets || []).map((s, j) => {
    const t = setType(s);
    const valid = isValidSet(s);
    const status = valid ? '' : s.done === false ? 'Not done' : 'No values';
    const plan = s.target ? setValueText(s.target, ck) : null;
    const planNote = plan && plan !== setValueText(s, ck) ? `<span class="hset-plan">plan ${esc(plan)}</span>` : '';
    const label = t === 'working' ? `Set ${labels[j]}` : t === 'warmup' ? 'Warm-up' : 'Drop set';
    const cmp = valid && t !== 'warmup' ? perSet.get(s) : null;
    return `
      <div class="hset type-${t}${valid ? '' : ' undone'}">
        <span class="hset-l">${label}</span>
        <span class="hset-v">${esc(historySetText(s, ck))}${status ? ` <span class="hset-status">${status}</span>` : ''}${planNote}</span>
        <span class="hset-c">${cmp || ''}</span>
      </div>`;
  }).join('');
}

/** Cardio totals line for an exercise with 2+ completed sets. */
function cardioTotalLine(e, ck) {
  const sets = completedSets(e);
  if (!ck || sets.length < 2) return '';
  const t = cardioTotals({ working: sets, drop: [] });
  const parts = [];
  if (t.dist) parts.push(fmtDistance(t.dist, ck));
  if (t.time) parts.push(fmtClock(t.time));
  if (t.bd && t.bt) {
    if (paceUnit(ck)) parts.push(`${fmtClock(paceSeconds(t.bt, t.bd, ck))} ${paceUnit(ck)}`);
    if (CARDIO_KINDS[ck].speed) parts.push(`${fmtNum(speedValue(t.bd, t.bt))} ${speedUnit()}`);
  }
  return parts.length ? `<div class="hset hset-total"><span class="hset-l">Total</span><span class="hset-v"><b>${esc(parts.join(' · '))}</b></span><span class="hset-c"></span></div>` : '';
}

function renderWorkoutDetail(w) {
  const volume = workoutVolume(w);
  const done = workoutSetCount(w);
  const notDone = w.entries.reduce((n, e) => n + (e.sets || []).filter((s) => !isValidSet(s)).length, 0);
  const letters = supersetLetters(w.entries);
  const seen = new Set();
  const fromHistory = ui.tab === 'history';
  const start = new Date(w.start);
  return `
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">${fromHistory ? '‹ History' : 'Done'}</button>
      <h2 class="truncate" style="max-width:55%">${esc(w.name)}</h2>
      <button type="button" class="link" data-action="edit-workout" data-id="${esc(w.id)}" style="font-weight:600">Edit</button>
    </div>
    <div class="sheet-body hist-detail">
      <div class="hist-when">${fmtDate(w.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${isNaN(start) ? '' : ` · ${start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}</div>
      <div class="card card-pad">
        <div class="bw-metrics hist-metrics">
          <div class="bw-metric"><div class="bw-metric-v">${workoutDurationText(w)}</div><div class="bw-metric-l">Duration</div></div>
          <div class="bw-metric"><div class="bw-metric-v">${workoutExerciseCount(w)}</div><div class="bw-metric-l">Exercises</div></div>
          <div class="bw-metric"><div class="bw-metric-v">${done}</div><div class="bw-metric-l">Sets done</div>${notDone ? `<div class="bw-metric-h">${countWord(notDone, 'set')} not done</div>` : ''}</div>
          ${volume > 0 ? `<div class="bw-metric"><div class="bw-metric-v">${fmtWeight(volume)}</div><div class="bw-metric-l">Volume (${esc(unit())})</div><div class="bw-metric-h">Warm-ups excluded</div></div>` : ''}
        </div>
      </div>
      ${w.planned ? planContextLine(w) + plannedVsActualHtml(w) : ''}
      ${w.entries.map((e, i) => {
        const ck = cardioKindOf(e.exerciseId) || ((e.sets || []).some(hasCardioValues) ? 'other' : null);
        const first = !seen.has(e.exerciseId);
        seen.add(e.exerciseId);
        const cmp = first ? exerciseComparison(w, e.exerciseId, ck) : { line: '<div class="hcmp muted">Compared above, with the earlier entry of this exercise</div>', perSet: exerciseComparison(w, e.exerciseId, ck).perSet };
        const ss = letters[i], ssCont = ss && letters[i - 1] === ss, ssNext = ss && letters[i + 1] === ss;
        return `
        <section class="card hist-ex${ss ? ' superset' : ''}${ssCont ? ' ss-cont' : ''}${ssNext ? ' ss-next' : ''}">
          ${ss && !ssCont ? `<span class="ss-badge">Superset ${ss}</span>` : ''}
          <div class="hist-ex-head"><span class="hist-ex-name">${esc(exName(e.exerciseId))}</span>${catTag(e.exerciseId)}</div>
          ${e.note ? `<div class="detail-note">📝 ${esc(e.note)}</div>` : ''}
          ${e.planned ? `<div class="ex-target"><span class="rec-k">Target</span><span>${e.planned.sets} × ${e.planned.min}–${e.planned.max} reps${e.swappedFrom != null ? ` · <span class="swap-note">instead of ${esc(exName(e.swappedFrom))}</span>` : ''}</span></div>` : ''}
          ${cmp.line}
          ${!ck && first ? historyProgression(w, e.exerciseId) : ''}
          <div class="hsets">${historySetRows(e, ck, cmp.perSet)}${cardioTotalLine(e, ck)}</div>
        </section>`;
      }).join('')}
      ${w.notes ? `<div class="section-title">Notes</div><div class="card card-pad">${esc(w.notes)}</div>` : ''}
      <p class="tpl-hint">Each exercise is compared with the last earlier workout that included it. Warm-ups are not compared; working and drop sets are matched in order.</p>
      <div class="btn-row">
        <button type="button" class="btn secondary" data-action="repeat" data-id="${esc(w.id)}">Repeat Workout</button>
        <button type="button" class="btn secondary" data-action="save-history-template" data-id="${esc(w.id)}">Save as Template</button>
      </div>
      <div class="btn-row"><button type="button" class="btn danger" data-action="delete-workout" data-id="${esc(w.id)}">Delete Workout</button></div>
    </div>
  `;
}

/* ----- Editing a saved workout ----- */

const pad2 = (n) => String(n).padStart(2, '0');
const dateInputValue = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const timeInputValue = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Start editing a copy of a saved workout; the workout itself is untouched until Save. */
function beginWorkoutEdit(w) {
  const start = new Date(w.start), end = new Date(w.end);
  ui.wdraft = {
    id: w.id,
    name: w.name || '',
    notes: w.notes || '',
    date: isNaN(start) ? '' : dateInputValue(start),
    startTime: isNaN(start) ? '' : timeInputValue(start),
    endTime: isNaN(end) ? '' : timeInputValue(end),
    entries: (w.entries || []).map((e) => ({
      exerciseId: e.exerciseId,
      sets: (e.sets || []).map((st) => ({ weight: num(st.weight) ?? '', reps: num(st.reps) ?? '', ...cardioFields(st), ...typeField(st), ...(st.target ? { target: st.target } : {}), done: st.done !== false })),
      ...entryExtras(e, { keepPlan: true })
    }))
  };
  ui.wdraftOriginal = JSON.stringify(ui.wdraft);
}

const workoutDraftChanged = () => ui.wdraft && JSON.stringify(ui.wdraft) !== ui.wdraftOriginal;

/**
 * Start and end of the draft as Dates (local time). An end time earlier than the
 * start means the workout ran past midnight. Untouched fields keep the original
 * timestamps exactly. Returns null when the date or start time is missing.
 */
function workoutDraftTimes(d, original) {
  const o = JSON.parse(ui.wdraftOriginal);
  const [y, m, day] = (d.date || '').split('-').map(Number);
  const [sh, sm] = (d.startTime || '').split(':').map(Number);
  if (!y || !m || !day || isNaN(sh) || isNaN(sm)) return null;
  const sameStart = d.date === o.date && d.startTime === o.startTime;
  const start = sameStart && !isNaN(new Date(original.start)) ? new Date(original.start) : new Date(y, m - 1, day, sh, sm);
  let end = null;
  if (d.endTime) {
    const [eh, em] = d.endTime.split(':').map(Number);
    if (sameStart && d.endTime === o.endTime && !isNaN(new Date(original.end))) end = new Date(original.end);
    else {
      end = new Date(y, m - 1, day, eh, em);
      if (end < start) end = new Date(y, m - 1, day + 1, eh, em);
    }
  }
  return { start, end };
}

function workoutDraftDurationText() {
  const d = ui.wdraft;
  const orig = state.workouts.find((w) => w.id === d.id) || {};
  const t = workoutDraftTimes(d, orig);
  if (!t) return 'Enter a date and start time';
  if (!t.end) return 'No end time · duration unknown';
  const nextDay = sDay(t.end) > sDay(t.start);
  return `Duration ${fmtDuration(t.end - t.start)}${nextDay ? ' · ends the next day' : ''}`;
}

function openWorkoutEditor() {
  const d = ui.wdraft;
  const isEditor = !!$('#sheet .workout-editor');
  const scroll = isEditor ? ($('#sheet .sheet-body')?.scrollTop ?? 0) : ui.returnScroll;
  ui.returnScroll = null;
  openSheet(`
    <div class="sheet-head">
      <button class="link" data-action="cancel-wedit">Cancel</button>
      <h2>Edit Workout</h2>
      <button class="link" data-action="save-wedit" style="font-weight:600">Save</button>
    </div>
    <div class="sheet-body workout-editor">
      <div class="card">
        <label class="field"><span>Name</span><input id="wedit-name" value="${esc(d.name)}" placeholder="Workout name" autocomplete="off"></label>
        <label class="field"><span>Date</span><input type="date" id="wedit-date" value="${esc(d.date)}" max="${dateInputValue(new Date())}"></label>
        <label class="field"><span>Start time</span><input type="time" id="wedit-start" value="${esc(d.startTime)}"></label>
        <label class="field"><span>End time</span><input type="time" id="wedit-end" value="${esc(d.endTime)}"></label>
        <div class="field wedit-duration" id="wedit-duration" aria-live="polite">${esc(workoutDraftDurationText())}</div>
      </div>

      <div class="section-title">Exercises</div>
      ${editorExerciseCards(d.entries, 'wedit')}
      <div class="btn-row" style="margin-top:16px"><button class="btn secondary" data-action="wedit-add-exercise">＋ Add Exercise</button></div>
      <p class="tpl-hint">Sets left completely empty are removed when you save. Weights are in ${esc(unit())}.</p>

      <div class="section-title">Notes</div>
      <div class="card"><textarea class="notes" id="wedit-notes" placeholder="How did it feel?">${esc(d.notes)}</textarea></div>
    </div>
  `);
  if (scroll != null) $('#sheet .sheet-body').scrollTop = scroll;
}

/** Close the editor without saving, asking first if anything changed. */
function cancelWorkoutEdit() {
  const d = ui.wdraft;
  if (workoutDraftChanged() && !confirm('Discard your changes to this workout?')) return;
  const w = state.workouts.find((x) => x.id === d.id);
  ui.wdraft = null;
  if (w) openSheet(renderWorkoutDetail(w)); else closeSheet();
}

/** Write the draft back into the same workout (same id), never creating a copy. */
/** Empty sets for an exercise added while editing a saved workout. */
const newLoggedSets = () => Array.from({ length: 3 }, () => ({ weight: '', reps: '', done: true }));

function saveWorkoutEdit() {
  const d = ui.wdraft;
  const i = state.workouts.findIndex((w) => w.id === d.id);
  if (i < 0) { alert('This workout no longer exists.'); ui.wdraft = null; closeSheet(); render(); return; }
  const original = state.workouts[i];
  const times = workoutDraftTimes(d, original);
  if (!times) { alert('Please enter a date and a start time.'); return; }
  if (times.start > new Date()) { alert('The workout can\'t start in the future.'); return; }
  const entries = d.entries
    .map((e) => ({
      exerciseId: e.exerciseId,
      sets: e.sets
        .filter((st) => st.weight !== '' || st.reps !== '' || num(st.distance) != null || num(st.duration) != null)
        .map((st) => ({ weight: st.weight, reps: st.reps === '' ? '' : String(st.reps), ...cardioFields(st), ...typeField(st), ...(st.target ? { target: st.target } : {}), done: st.done !== false })),
      ...entryExtras(e, { keepPlan: true })
    }))
    .filter((e) => e.sets.length);
  normalizeSupersets(entries);
  if (!entries.some((e) => completedSets(e).length)) {
    alert('A workout needs at least one set with weight or reps. To remove the whole workout, use Delete instead.');
    return;
  }
  const updated = {
    ...original,
    name: d.name.trim() || original.name || 'Workout',
    notes: d.notes,
    start: times.start.toISOString(),
    entries
  };
  if (times.end) updated.end = times.end.toISOString(); else delete updated.end;
  state.workouts[i] = updated;
  state.workouts.sort((a, b) => new Date(b.start) - new Date(a.start));
  ui.wdraft = null;
  save();
  render();
  openSheet(renderWorkoutDetail(updated));
  toast('Workout updated');
}

/* ----- Progress tab ----- */

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

/** Text for one record metric value, e.g. "100 kg", "8.00 km", "4:50 /km". */
function recordValueText(metric, v, exerciseId) {
  const kind = cardioKindOf(exerciseId);
  if (metric === 'weight' || metric === 'e1rm') return `${fmtWeight(v)} ${unit()}`;
  if (metric === 'distance') return fmtDistance(v, kind);
  if (metric === 'pace') return `${fmtClock(paceSeconds(v, 1, kind))} ${paceUnit(kind)}`;
  if (metric === 'speed') return `${fmtNum(speedValue(v, 1))} ${speedUnit()}`;
  return `${fmtNum(v)} reps`;
}
const RECORD_LABELS = { weight: 'Heaviest', e1rm: 'Est. 1RM', reps: 'Most reps', distance: 'Longest', pace: 'Fastest pace', speed: 'Top speed' };

/* Progress: quick summaries. Deeper analysis (frequency, breakdowns, every metric) is in Statistics. */
function renderProgress() {
  const { items, today } = completedWorkouts();
  if (!items.length) {
    return `<div class="empty" style="padding-top:28px"><div class="big">📈</div>Finish a workout to see your workout progress.<br>Weigh-ins are under Body.</div>`;
  }
  const thisWeekStart = startOfWeek(today);
  const lastWeekStart = sAddDays(thisWeekStart, -7);
  const cur = summarizeWorkouts(items.filter((it) => it.day >= thisWeekStart));
  const prev = summarizeWorkouts(items.filter((it) => it.day >= lastWeekStart && it.day < thisWeekStart));
  const cell = (v, f) => (v == null ? '<span class="muted">–</span>' : f(v));
  const timeCell = (x) => (x.minutes == null ? cell(null) : `${fmtHours(x.minutes)}${x.untimed ? '<sup>*</sup>' : ''}`);
  const anyUntimed = cur.untimed || prev.untimed;

  // Records set in the last 30 days (newest first).
  const since = sAddDays(today, -29);
  const recent = recordEvents(items).filter((ev) => sDay(new Date(ev.date)) >= since).reverse().slice(0, 6);

  const used = state.exercises.filter((ex) => items.some((it) => it.entries.some((e) => e.exerciseId === ex.id)));
  if (!ui.progressExercise || !used.some((e) => e.id === ui.progressExercise)) ui.progressExercise = used[0]?.id ?? null;

  return `
    <div class="stats" style="margin-top:12px">
      <div class="stat"><div class="num">${items.length}</div><div class="lbl">Total workouts</div></div>
      <div class="stat"><div class="num">${weekStreak(items, today)}<small> wk</small></div><div class="lbl">Week streak</div><div class="stat-hint">Weeks in a row</div></div>
      <div class="stat"><div class="num">${dayStreak(items, today)}<small> d</small></div><div class="lbl">Day streak</div><div class="stat-hint">Days in a row</div></div>
    </div>

    <div class="section-title">This week vs last week</div>
    <div class="card">
      <table class="compare">
        <thead><tr><th></th><th>This week</th><th>Last week</th></tr></thead>
        <tbody>
          <tr><th>Workouts</th><td>${cur.count}</td><td>${prev.count}</td></tr>
          <tr><th>Training time</th><td>${timeCell(cur)}</td><td>${timeCell(prev)}</td></tr>
          <tr><th>Volume (${esc(unit())})</th><td>${cell(cur.volume, fmtWeight)}</td><td>${cell(prev.volume, fmtWeight)}</td></tr>
          <tr><th>Cardio time</th><td>${cell(cur.cardioSec, fmtClock)}</td><td>${cell(prev.cardioSec, fmtClock)}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="stats-note">Weeks start on Monday. – means nothing was recorded.${anyUntimed ? ' * Some workouts have no end time and are not included in training time.' : ''} Volume leaves out warm-up sets.</p>

    <div class="section-title">Recent records · last 30 days</div>
    ${recent.length ? `<div class="card">
      ${recent.map((ev) => `
        <div class="list-item">
          <div class="grow">
            <div class="truncate">${esc(exName(ev.exerciseId))}</div>
            <div class="sub">${RECORD_LABELS[ev.metric]} ${esc(recordValueText(ev.metric, ev.value, ev.exerciseId))} · was ${esc(recordValueText(ev.metric, ev.prev, ev.exerciseId))}</div>
          </div>
          <span class="sub">${fmtDate(ev.date, { day: 'numeric', month: 'short' })}</span>
        </div>`).join('')}
    </div>` : `<div class="card card-pad stats-empty">No new records in the last 30 days. A record needs an earlier session of the same exercise to beat.</div>`}

    ${used.length ? `
      <div class="section-title">Exercise progress</div>
      <div class="card">
        <label class="field">
          <span>Exercise</span>
          <select id="progress-exercise">
            ${used.map((ex) => `<option value="${ex.id}" ${ex.id === ui.progressExercise ? 'selected' : ''}>${esc(ex.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      ${renderExerciseProgress(ui.progressExercise, items)}` : ''}
    <p class="stats-note">Workout frequency, breakdowns and every metric for each exercise are in Statistics.</p>
  `;
}

function renderExerciseProgress(exerciseId, items) {
  const sessions = exerciseSessions(items, exerciseId);
  const ck = cardioKindOf(exerciseId);
  if (ck) return renderCardioProgress(sessions, ck);
  const weighted = sessions.some((s) => s.v.weight != null);
  const metric = weighted ? 'e1rm' : 'reps';
  const points = sessions
    .filter((s) => s.v[metric] != null)
    .map((s) => ({ date: s.date, value: metric === 'e1rm' ? toDisplayWeight(s.v.e1rm) : s.v.reps }));
  const heaviest = bestSession(sessions, 'weight');
  const best1rm = bestSession(sessions, 'e1rm');
  const mostReps = bestSession(sessions, 'reps');
  return `
    <div class="card card-pad" style="margin-top:12px">
      <div class="sub" style="color:var(--muted);font-size:13px;margin-bottom:6px">${weighted ? `Estimated 1-rep max per session (${esc(unit())})` : 'Most reps in a set per session'}</div>
      ${weighted && !points.length
        ? `<div class="empty" style="padding:24px">The estimate needs a set of 1–${E1RM_MAX_REPS} reps with weight.</div>`
        : lineChart(points)}
    </div>
    <div class="stats" style="margin-top:12px">
      ${weighted
        ? `<div class="stat"><div class="num">${fmtWeight(heaviest.v.weight)}</div><div class="lbl">Heaviest (${esc(unit())})</div></div>
           <div class="stat"><div class="num">${best1rm ? fmtWeight(best1rm.v.e1rm) : '–'}</div><div class="lbl">Best est. 1RM</div></div>`
        : `<div class="stat"><div class="num">${mostReps ? mostReps.v.reps : '–'}</div><div class="lbl">Most reps in a set</div></div>`}
      <div class="stat"><div class="num">${sessions.length}</div><div class="lbl">Sessions</div></div>
    </div>
  `;
}

/**
 * Line chart of one value per session. Axis labels show only values that occur in the
 * data (highest and lowest); the caption gives the number of sessions and the date range.
 */
function lineChart(points, fmt = fmtNum) {
  const W = 320, H = 160, padX = 34, padY = 18;
  if (points.length < 2) {
    return `<div class="empty" style="padding:24px">${points.length ? 'Only one session so far. ' : ''}Log this at least twice to see a trend.</div>`;
  }
  const vals = points.map((p) => p.value);
  const dMin = Math.min(...vals), dMax = Math.max(...vals);
  let min = dMin, max = dMax;
  if (min === max) { min -= 1; max += 1; } // flat line in the middle; labels still show the real value
  const x = (i) => padX + (i / (points.length - 1)) * (W - padX - 8);
  const y = (v) => padY + (1 - (v - min) / (max - min)) * (H - padY * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${H - padY} L${x(0).toFixed(1)},${H - padY} Z`;
  const first = new Date(points[0].date), last = new Date(points[points.length - 1].date);
  const withYear = first.getFullYear() !== last.getFullYear() || last.getFullYear() !== new Date().getFullYear();
  const dOpts = withYear ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
  const range = `${fmtDate(points[0].date, dOpts)} – ${fmtDate(points[points.length - 1].date, dOpts)}`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${points.length} sessions, ${esc(range)}. Highest ${esc(fmt(dMax))}, lowest ${esc(fmt(dMin))}.">
    <line class="axis" x1="${padX}" y1="${H - padY}" x2="${W}" y2="${H - padY}"/>
    <text class="lbl" x="0" y="${y(dMax) + 3}">${fmt(dMax)}</text>
    ${dMin !== dMax ? `<text class="lbl" x="0" y="${y(dMin) + 3}">${fmt(dMin)}</text>` : ''}
    <path class="area" d="${area}"/>
    <path class="line" d="${path}"/>
    ${points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.value)}" r="3"/>`).join('')}
    <text class="lbl" x="${padX}" y="${H - 3}">${fmtDate(points[0].date, dOpts)}</text>
    <text class="lbl" x="${W - 8}" y="${H - 3}" text-anchor="end">${fmtDate(points[points.length - 1].date, dOpts)}</text>
  </svg>
  <div class="chart-caption">${points.length} sessions · ${esc(range)}</div>`;
}

/** Progress for a cardio exercise: distance (or time) per session and its best values. */
function renderCardioProgress(sessions, ck) {
  const hasDist = sessions.some((s) => s.v.distance != null);
  const metric = hasDist ? 'distance' : 'duration';
  const points = sessions.filter((s) => s.v[metric] != null)
    .map((s) => ({ date: s.date, value: metric === 'distance' ? toDisplayDistance(s.v.distance, ck) : s.v.duration }));
  const longest = bestSession(sessions, 'distance');
  const longestTime = bestSession(sessions, 'duration');
  const fastest = bestSession(sessions, 'pace');
  const card = (value, label) => `<div class="stat"><div class="num">${value}</div><div class="lbl">${label}</div></div>`;
  let speedCard = '';
  if (fastest) {
    speedCard = paceUnit(ck)
      ? card(fmtClock(paceSeconds(fastest.v.pace, 1, ck)), `Best pace (${paceUnit(ck)})`)
      : card(fmtNum(speedValue(fastest.v.speed, 1)), `Top speed (${speedUnit()})`);
  }
  return `
    <div class="card card-pad" style="margin-top:12px">
      <div class="sub" style="color:var(--muted);font-size:13px;margin-bottom:6px">${hasDist ? `Distance per session (${distanceUnit(ck)})` : 'Time per session'}</div>
      ${points.length ? lineChart(points, hasDist ? fmtNum : (v) => fmtClock(v * 60)) : '<div class="empty" style="padding:24px">Log distance or time to see a trend.</div>'}
    </div>
    <div class="stats" style="margin-top:12px">
      ${longest ? card(fmtDistance(longest.v.distance, ck), 'Longest') : longestTime ? card(fmtClock(longestTime.v.duration * 60), 'Longest time') : ''}
      ${speedCard}
      ${card(sessions.length, 'Sessions')}
    </div>
    ${hasDist && !fastest ? `<p class="stats-note">Log both distance and time in the same set to see ${paceUnit(ck) ? 'pace' : 'speed'}.</p>` : ''}
  `;
}

/* ----- Settings tab ----- */

function renderSettings() {
  return `
    <div class="section-title">Preferences</div>
    <div class="card">
      <div class="field">
        <span>Units</span>
        <div class="segmented" role="group" aria-label="Units">
          <button data-action="unit" data-unit="kg" class="${unit() === 'kg' ? 'on' : ''}" aria-label="Metric: kilograms and kilometres">kg · km</button>
          <button data-action="unit" data-unit="lb" class="${unit() === 'lb' ? 'on' : ''}" aria-label="Imperial: pounds and miles">lb · mi</button>
        </div>
      </div>
      <div class="field">
        <span>Theme</span>
        <div class="segmented" role="group" aria-label="Theme">
          ${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-action="theme" data-v="${v}" class="${(state.settings.theme || 'system') === v ? 'on' : ''}" aria-pressed="${(state.settings.theme || 'system') === v}"${v === 'system' ? ' aria-label="Auto: follow the iPhone appearance"' : ''}>${l}</button>`).join('')}
        </div>
      </div>
      <label class="field">
        <span>Rest timer (seconds)</span>
        <input type="number" id="rest-seconds" min="0" step="15" inputmode="numeric" value="${state.settings.rest}">
      </label>
      <label class="field">
        <span>Weight step (${esc(unit())})<span class="sub" style="display:block;font-size:13px;color:var(--muted)">Used for suggested next weights</span></span>
        <input type="number" id="weight-step" min="${WEIGHT_STEP_LIMITS[unit()][0]}" max="${WEIGHT_STEP_LIMITS[unit()][1]}" step="any" inputmode="decimal" value="${weightStep()}">
      </label>
    </div>

    <div class="section-title">Exercises</div>
    <div class="card">
      <button class="list-item" data-action="manage-exercises">
        <span class="grow">Manage exercises</span>
        <span class="sub">${state.exercises.length}</span><span class="chev">›</span>
      </button>
    </div>

    <div class="section-title">Backup</div>
    <div class="card">
      <button class="list-item" data-action="export">
        <div class="grow"><div>Export backup</div><div class="sub">${state.lastExportAt ? `Last exported ${fmtDate(state.lastExportAt, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Not exported from this device yet'}</div></div>
        <span class="chev">›</span>
      </button>
      <button class="list-item" data-action="import">
        <div class="grow"><div>Restore from backup</div><div class="sub">Checks the file and asks before replacing anything</div></div>
        <span class="chev">›</span>
      </button>
      ${(() => { const b = beforeRestoreInfo(); return b ? `<button class="list-item" data-action="undo-restore"><div class="grow"><div>Undo last restore</div><div class="sub">Brings back the ${b.workouts} workout${b.workouts === 1 ? '' : 's'} saved${b.exportedAt ? ` on ${fmtDate(b.exportedAt, { day: 'numeric', month: 'short' })}` : ''}</div></div><span class="chev">›</span></button>` : ''; })()}
      ${hasPreUpdateCopy() ? '<button class="list-item" data-action="export-pre-update"><span class="grow">Download pre-update copy</span><span class="chev">›</span></button>' : ''}
      <button class="list-item" data-action="reset" style="color:var(--danger)"><span class="grow">Erase all data</span></button>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" class="hidden">
    <p class="tpl-hint">A backup is one .json file with all workouts, templates, exercises, weigh-ins and settings. Save it to Files or iCloud Drive. Your data is only stored on this device.</p>

    <div class="section-title">Install on iPhone</div>
    <div class="card card-pad" style="font-size:15px;color:var(--muted)">
      Open this page in Safari, tap the <b>Share</b> button, then choose <b>Add to Home Screen</b>.
      Your data is stored only on this device, so export a backup now and then.
    </div>
  `;
}

/* ---------- Sheets ---------- */

function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  $('#sheet-backdrop').classList.remove('hidden');
}

function closeSheet() {
  ui.draft = null; // drafts only live while their editor is open
  ui.wdraft = null;
  ui.exdraft = null;
  $('#sheet').classList.add('hidden');
  $('#sheet-backdrop').classList.add('hidden');
  $('#sheet').innerHTML = '';
}

/* ---------- Exercise library ---------- */

const CATEGORIES = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Sports', 'Other'];
const catOf = (e) => String(e?.category || '').trim() || 'Other';
/** The standard categories plus any custom ones found in older data (kept, never renamed). */
const allCategories = () => [...new Set([...CATEGORIES, ...state.exercises.map(catOf)])];
const catTag = (exerciseId) => `<span class="cat-tag">${esc(catOf(exById(exerciseId)))}</span>`;

/** How many saved workouts and templates (and the workout in progress) use an exercise. */
function exerciseUsage(id) {
  const uses = (w) => (w?.entries || []).some((e) => e.exerciseId === id);
  return {
    workouts: state.workouts.filter(uses).length,
    templates: state.templates.filter(uses).length,
    active: uses(state.active)
  };
}
const usageText = (u) => {
  const parts = [];
  if (u.workouts) parts.push(`${u.workouts} workout${u.workouts === 1 ? '' : 's'}`);
  if (u.templates) parts.push(`${u.templates} template${u.templates === 1 ? '' : 's'}`);
  if (u.active) parts.push('the workout in progress');
  return parts.length ? `Used in ${parts.join(', ')}` : 'Not used yet';
};

function matchesQuery(e, q) {
  return !q || e.name.toLowerCase().includes(q) || catOf(e).toLowerCase().includes(q);
}

function categoryChips(selected, action, cats) {
  return `<div class="cat-chips" role="group" aria-label="Filter by category">
    ${['All', ...cats].map((c) => {
      const v = c === 'All' ? 'all' : c;
      return `<button class="cat-chip ${selected === v ? 'on' : ''}" data-action="${action}" data-v="${esc(v)}" aria-pressed="${selected === v}">${esc(c)}</button>`;
    }).join('')}
  </div>`;
}

function groupByCategory(list) {
  const groups = new Map();
  list.sort((a, b) => allCategories().indexOf(catOf(a)) - allCategories().indexOf(catOf(b)) || a.name.localeCompare(b.name))
    .forEach((e) => { if (!groups.has(catOf(e))) groups.set(catOf(e), []); groups.get(catOf(e)).push(e); });
  return [...groups];
}

/** Exercise list for picking an exercise (workout, template, or workout editor). Archived ones are hidden. */
function exercisePickerHtml(query = '', mode = 'pick') {
  const q = query.trim().toLowerCase();
  const active = state.exercises.filter((e) => !e.archived);
  const cat = ui.pickCat || 'all';
  const list = active.filter((e) => matchesQuery(e, q) && (cat === 'all' || catOf(e) === cat));
  const exact = state.exercises.find((e) => e.name.toLowerCase() === q);
  const cats = allCategories().filter((c) => active.some((e) => catOf(e) === c));
  return `
    ${categoryChips(cat, 'pick-cat', cats)}
    ${q && !exact ? `
      <div class="card" style="margin-bottom:8px">
        <button class="list-item" data-action="create-exercise" data-mode="${mode}" style="color:var(--accent)">＋ Create “${esc(query.trim())}”</button>
      </div>` : ''}
    ${exact?.archived ? `<div class="card card-pad stats-empty" style="margin-bottom:8px">“${esc(exact.name)}” is archived. Restore it in Settings → Manage exercises to use it again.</div>` : ''}
    ${groupByCategory(list).map(([c, exs]) => `
      <div class="section-title">${esc(c)}</div>
      <div class="card">
        ${exs.map((e) => `<button class="list-item" data-action="pick-exercise" data-id="${e.id}" data-mode="${mode}"><span class="grow">${esc(e.name)}</span></button>`).join('')}
      </div>`).join('') || (q ? '' : '<div class="empty">No exercises in this category</div>')}
  `;
}

function openExercisePicker(mode = 'pick') {
  ui.pickCat = 'all';
  openSheet(`
    <div class="sheet-head">
      <span style="width:52px"></span>
      <h2>${mode === 'swap' ? 'Swap Exercise' : 'Add Exercise'}</h2>
      <button class="link" data-action="${{ template: 'back-to-template', wedit: 'back-to-wedit' }[mode] || 'close-sheet'}">${mode === 'template' || mode === 'wedit' ? 'Back' : mode === 'swap' ? 'Cancel' : 'Done'}</button>
    </div>
    <div class="sheet-body">
      <input class="search" id="exercise-search" type="search" placeholder="Search or create exercise" autocomplete="off" data-mode="${mode}" aria-label="Search exercises">
      <div id="exercise-list">${exercisePickerHtml('', mode)}</div>
    </div>
  `);
}

function openCategoryPicker(name, mode) {
  openSheet(`
    <div class="sheet-head">
      <span style="width:52px"></span>
      <h2>Category for “${esc(name)}”</h2>
      <button class="link" data-action="${{ template: 'back-to-template', wedit: 'back-to-wedit' }[mode] || 'close-sheet'}">Cancel</button>
    </div>
    <div class="sheet-body">
      <div class="card">
        ${allCategories().map((c) => `<button class="list-item" data-action="choose-category" data-category="${esc(c)}" data-name="${esc(name)}" data-mode="${mode}"><span class="grow">${esc(c)}</span></button>`).join('')}
      </div>
    </div>
  `);
}

/* ----- Settings → Manage exercises ----- */

function exerciseManagerList() {
  const q = (ui.exm.q || '').trim().toLowerCase();
  const cat = ui.exm.cat;
  const match = (e) => matchesQuery(e, q) && (cat === 'all' || catOf(e) === cat);
  const active = state.exercises.filter((e) => !e.archived && match(e));
  const archived = state.exercises.filter((e) => e.archived && match(e));
  const row = (e) => `
    <button class="list-item" data-action="exm-edit" data-id="${e.id}">
      <div class="grow"><div class="truncate">${esc(e.name)}</div><div class="sub">${esc(usageText(exerciseUsage(e.id)))}</div></div>
      <span class="chev">›</span>
    </button>`;
  return `
    ${categoryChips(cat, 'exm-cat', allCategories())}
    ${groupByCategory(active).map(([c, exs]) => `
      <div class="section-title">${esc(c)}</div>
      <div class="card">${exs.map(row).join('')}</div>`).join('') || '<div class="empty" style="padding:24px">No matching exercises</div>'}
    ${archived.length ? `
      <div class="section-title">Archived</div>
      <div class="card">${archived.sort((a, b) => a.name.localeCompare(b.name)).map(row).join('')}</div>
      <p class="tpl-hint">Archived exercises are hidden when picking exercises but stay in your history, statistics and templates.</p>` : ''}`;
}

function openExerciseManager() {
  ui.exm = ui.exm || { q: '', cat: 'all' };
  openSheet(`
    <div class="sheet-head">
      <button class="link" data-action="exm-new">＋ New</button>
      <h2>Exercises</h2>
      <button class="link" data-action="close-sheet">Done</button>
    </div>
    <div class="sheet-body">
      <input class="search" id="exm-search" type="search" placeholder="Search exercises" value="${esc(ui.exm.q)}" autocomplete="off" aria-label="Search exercises">
      <div id="exm-list">${exerciseManagerList()}</div>
    </div>
  `);
}

/** Create (id null) or edit an exercise. Changes are kept in ui.exdraft until Save. */
function openExerciseEditor(id) {
  if (id !== undefined) {
    const ex = id ? exById(id) : null;
    ui.exdraft = { id: ex?.id || null, name: ex?.name || '', category: ex ? catOf(ex) : (ui.exm?.cat !== 'all' && ui.exm?.cat) || 'Other' };
  }
  const d = ui.exdraft;
  const ex = d.id ? exById(d.id) : null;
  const usage = d.id ? exerciseUsage(d.id) : null;
  const used = usage && (usage.workouts || usage.templates || usage.active);
  const wasCardio = ex && catOf(ex) === 'Cardio';
  const cardioChange = ex && used && wasCardio !== (d.category === 'Cardio');
  openSheet(`
    <div class="sheet-head">
      <button class="link" data-action="exd-cancel">Cancel</button>
      <h2>${d.id ? 'Edit Exercise' : 'New Exercise'}</h2>
      <button class="link" data-action="exd-save" style="font-weight:600">Save</button>
    </div>
    <div class="sheet-body">
      <div class="card">
        <label class="field"><span>Name</span><input id="exd-name" value="${esc(d.name)}" placeholder="e.g. Hip Thrust" autocomplete="off"></label>
      </div>
      <div class="section-title">Category</div>
      <div class="cat-grid" role="radiogroup" aria-label="Category">
        ${allCategories().map((c) => `<button class="cat-option ${d.category === c ? 'on' : ''}" role="radio" aria-checked="${d.category === c}" data-action="exd-cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      <p class="tpl-hint">${d.category === 'Cardio' ? 'Cardio exercises log distance and time.' : d.category === 'Sports' ? 'Sports count as their own activity type in Statistics.' : 'Logged as weight × reps.'}</p>
      ${cardioChange ? `<div class="card card-pad stats-empty" style="margin-top:10px">${wasCardio
        ? 'New sets will be logged as weight × reps. Distance and time already logged stay in your history and are still shown.'
        : 'New sets will be logged as distance and time. Weight and reps already logged stay in your history.'}</div>` : ''}
      ${d.id ? `
        <div class="section-title">Usage</div>
        <div class="card card-pad stats-empty">${esc(usageText(usage))}${used ? '. Renaming or changing the category updates it everywhere; logged sets are not changed.' : '.'}</div>
        <div class="btn-row">
          ${ex.archived
            ? '<button class="btn secondary" data-action="exd-restore">Restore Exercise</button>'
            : used
              ? '<button class="btn secondary" data-action="exd-archive">Archive Exercise</button>'
              : '<button class="btn danger" data-action="exd-delete">Delete Exercise</button>'}
        </div>
        ${!ex.archived && used ? '<p class="tpl-hint">This exercise is in use, so it can\'t be deleted without breaking those records. Archiving hides it from exercise lists but keeps your history, statistics and templates intact.</p>' : ''}` : ''}
    </div>
  `);
}

function saveExerciseDraft() {
  const d = ui.exdraft;
  const name = d.name.trim().replace(/\s+/g, ' ');
  if (!name) { alert('Please enter a name.'); return; }
  const clash = state.exercises.find((e) => e.id !== d.id && e.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) { alert(`There is already an exercise called “${clash.name}”${clash.archived ? ' (archived)' : ''}.`); return; }
  if (d.id) {
    const ex = exById(d.id);
    ex.name = name;
    ex.category = d.category;
  } else {
    state.exercises.push({ id: uid(), name, category: d.category });
  }
  save();
  ui.exdraft = null;
  openExerciseManager();
  render();
  toast(d.id ? 'Exercise updated' : 'Exercise added');
}

/* ---------- Backup ---------- */

// Backup export, validation and restore live in backup.js.

/* ---------- Events ---------- */

document.addEventListener('click', (ev) => {
  // Tab bar buttons and in-page links to a screen ([data-tab]). The Progress tab button
  // returns to the last Progress section viewed.
  const tab = ev.target.closest('[data-tab]');
  if (tab && !(performance.now() < ui.tapGuardUntil && tab.closest('#view'))) {
    // The live workout keeps its scroll position while you look at other tabs.
    if (ui.tab === 'workout' && state.active) ui.wkScroll = window.scrollY;
    ui.tab = tab.closest('.tabbar') && tab.dataset.tab === 'progress' ? ui.progressView : tab.dataset.tab;
    closeSheet();
    render();
    window.scrollTo(0, ui.tab === 'workout' && state.active ? ui.wkScroll : 0);
    return;
  }
  // Right after the screen changes (workout started, saved or discarded), ignore taps on
  // the page for a moment so the second tap of a double tap can't hit the new screen.
  if (performance.now() < ui.tapGuardUntil && ev.target.closest('#view')) return;

  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const ei = el.dataset.entry != null ? +el.dataset.entry : null;
  const si = el.dataset.set != null ? +el.dataset.set : null;

  // Exercise/set editing shared by the template editor (draft-*) and workout editor (wedit-*).
  const edit = action.match(/^(draft|wedit)-(move-ex|remove|add-set|remove-set|move-set|link|unlink)$/);
  if (edit) {
    const isTemplate = edit[1] === 'draft';
    const entries = (isTemplate ? ui.draft : ui.wdraft)?.entries;
    if (entries && editEntries(entries, edit[2], ei, si, +el.dataset.dir)) (isTemplate ? openTemplateEditor : openWorkoutEditor)();
    return;
  }

  switch (action) {
    case 'new-template':
      beginTemplateDraft(null);
      openTemplateEditor();
      setTimeout(() => $('#draft-name')?.focus(), 300);
      break;
    case 'edit-template': {
      beginTemplateDraft(state.templates.find((x) => x.id === id));
      openTemplateEditor();
      break;
    }
    case 'save-template': saveTemplate(); break;
    case 'cancel-template': cancelTemplateDraft(); break;
    case 'delete-template':
      if (confirm(`Delete the template “${ui.draft.name}”? Your past workouts are kept.`)) {
        state.templates = state.templates.filter((t) => t.id !== id);
        ui.draft = null; save(); closeSheet(); render();
      }
      break;
    case 'draft-add-exercise': openExercisePicker('template'); break;
    case 'back-to-template': openTemplateEditor(); break;
    case 'save-active-template': saveAsTemplate(state.active); break;
    case 'edit-workout': beginWorkoutEdit(state.workouts.find((w) => w.id === id)); openWorkoutEditor(); break;
    case 'save-wedit': saveWorkoutEdit(); break;
    case 'cancel-wedit': cancelWorkoutEdit(); break;
    case 'wedit-add-exercise': openExercisePicker('wedit'); break;
    case 'back-to-wedit': openWorkoutEditor(); break;
    case 'save-history-template': saveAsTemplate(state.workouts.find((w) => w.id === id)); break;
    case 'pick-exercise':
      if (el.dataset.mode === 'wedit') { ui.wdraft.entries.push({ exerciseId: id, sets: newLoggedSets() }); openWorkoutEditor(); }
      else if (el.dataset.mode === 'template') { ui.draft.entries.push({ exerciseId: id, sets: defaultPlannedSets(id) }); openTemplateEditor(); }
      else if (el.dataset.mode === 'swap') swapExercise(ui.swapEntry, id);
      else addExerciseToWorkout(id);
      break;
    case 'create-exercise': openCategoryPicker($('#exercise-search').value.trim(), el.dataset.mode); break;
    case 'choose-category': {
      const ex = { id: uid(), name: el.dataset.name, category: el.dataset.category };
      state.exercises.push(ex);
      save();
      if (el.dataset.mode === 'wedit') { ui.wdraft.entries.push({ exerciseId: ex.id, sets: newLoggedSets() }); openWorkoutEditor(); }
      else if (el.dataset.mode === 'template') { ui.draft.entries.push({ exerciseId: ex.id, sets: defaultPlannedSets(ex.id) }); openTemplateEditor(); }
      else if (el.dataset.mode === 'pick' && state.active) addExerciseToWorkout(ex.id);
      else if (el.dataset.mode === 'swap' && state.active) swapExercise(ui.swapEntry, ex.id);
      else { ui.exm = { q: '', cat: 'all' }; openExerciseManager(); }
      break;
    }
    case 'pick-cat': {
      ui.pickCat = el.dataset.v;
      const search = $('#exercise-search');
      $('#exercise-list').innerHTML = exercisePickerHtml(search.value, search.dataset.mode);
      break;
    }
    case 'exm-cat': ui.exm.cat = el.dataset.v; $('#exm-list').innerHTML = exerciseManagerList(); break;
    case 'exm-new': openExerciseEditor(null); setTimeout(() => $('#exd-name')?.focus(), 300); break;
    case 'exm-edit': openExerciseEditor(id); break;
    case 'exd-cat': ui.exdraft.category = el.dataset.v; openExerciseEditor(); break;
    case 'exd-cancel': ui.exdraft = null; openExerciseManager(); break;
    case 'exd-save': saveExerciseDraft(); break;
    case 'exd-archive': {
      const ex = exById(ui.exdraft.id);
      if (!confirm(`Archive “${ex.name}”? It will be hidden when picking exercises. ${usageText(exerciseUsage(ex.id))}, and those records stay as they are.`)) break;
      ex.archived = true; save(); ui.exdraft = null; openExerciseManager(); render(); toast('Exercise archived');
      break;
    }
    case 'exd-restore': {
      const ex = exById(ui.exdraft.id);
      delete ex.archived; save(); ui.exdraft = null; openExerciseManager(); render(); toast('Exercise restored');
      break;
    }
    case 'exd-delete': {
      const ex = exById(ui.exdraft.id);
      const u = exerciseUsage(ex.id);
      if (u.workouts || u.templates || u.active) { alert('This exercise is in use and can only be archived.'); break; }
      if (!confirm(`Delete “${ex.name}”? It isn't used anywhere, so no history is affected.`)) break;
      state.exercises = state.exercises.filter((e) => e.id !== ex.id); save(); ui.exdraft = null; openExerciseManager(); render(); toast('Exercise deleted');
      break;
    }
    case 'manage-exercises': ui.exm = { q: '', cat: 'all' }; openExerciseManager(); break;
    case 'set-menu': openSetMenu(el.dataset.ctx, ei, si); break;
    case 'set-menu-back': returnFromMenu(el.dataset.ctx); break;
    case 'set-type': {
      const set = contextEntries(el.dataset.ctx)[ei].sets[si];
      if (el.dataset.v === 'working') delete set.type; else set.type = el.dataset.v;
      returnFromMenu(el.dataset.ctx);
      break;
    }
    case 'set-move': {
      const sets = contextEntries(el.dataset.ctx)[ei].sets, to = si + +el.dataset.dir;
      [sets[si], sets[to]] = [sets[to], sets[si]];
      returnFromMenu(el.dataset.ctx);
      break;
    }
    case 'set-delete': {
      const sets = contextEntries(el.dataset.ctx)[ei].sets;
      if (el.dataset.ctx === 'active' && !confirmRemoveSet(sets[si])) break;
      if (sets.length > 1) sets.splice(si, 1);
      returnFromMenu(el.dataset.ctx);
      break;
    }
    case 'open-workout': openSheet(renderWorkoutDetail(state.workouts.find((w) => w.id === id))); break;
    case 'delete-workout':
      if (confirm('Delete this workout?')) { state.workouts = state.workouts.filter((w) => w.id !== id); save(); closeSheet(); render(); }
      break;
    case 'close-sheet': closeSheet(); break;
    case 'open-settings': ui.tab = 'settings'; closeSheet(); render(); window.scrollTo(0, 0); break;
    case 'unit': state.settings.unit = el.dataset.unit; save(); render(); break;
    case 'theme': state.settings.theme = el.dataset.v; save(); applyTheme(); render(); break;
    case 'export': exportData(); break;
    case 'restore-confirm': confirmRestore(); break;
    case 'restore-cancel': ui.pendingRestore = null; closeSheet(); toast('Restore cancelled. Nothing was changed.'); break;
    case 'restore-toggle-copy': ui.pendingRestore.saveCopy = !ui.pendingRestore.saveCopy; renderRestoreConfirm(); break;
    case 'undo-restore': undoLastRestore(); break;
    case 'export-pre-update': exportPreUpdateCopy(); break;
    case 'import': $('#import-file').click(); break;
    case 'reset':
      if (confirm('Erase ALL workouts, templates, weigh-ins, plans and custom exercises? A copy stays on this device for “Undo last restore”, but exporting a backup first is safer.')) {
        keepBeforeRestoreCopy();
        state = defaultState(); stopRest(); save(); applyTheme(); render(); toast('All data erased');
      }
      break;
    default:
      // Workout tab actions (workout.js), then body weight (bodyweight.js).
      if (!handleWorkoutAction(action, el, ei, si) && !handlePlanAction(action, el)) handleWeightAction(action, el);
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.note) {
    // Exercise note in the live workout or an editor.
    const entries = contextEntries(t.dataset.note);
    if (entries?.[+t.dataset.entry]) entries[+t.dataset.entry].note = t.value;
    if (t.dataset.note === 'active') save();
  } else if (handleWorkoutInput(t)) {
    // Live workout fields (workout.js).
  } else if ((t.dataset.tfield && ui.draft) || (t.dataset.wfield && ui.wdraft)) {
    // Editor sets (template targets or a saved workout): weight typed in the selected unit and
    // stored in kg, reps as a whole number, distance stored in metres, time in seconds.
    const field = t.dataset.tfield || t.dataset.wfield;
    const set = (t.dataset.tfield ? ui.draft : ui.wdraft).entries[+t.dataset.entry].sets[+t.dataset.set];
    const v = num(t.value.replace(',', '.'));
    if (field === 'weight') set.weight = v == null || v < 0 ? '' : toStoredWeight(v);
    else if (field === 'reps') set.reps = v == null || v < 0 ? '' : Math.round(v);
    else setCardioField(set, field, t.value, t.dataset.kind);
  } else if (t.id && t.id.startsWith('wedit-') && ui.wdraft) {
    updateWorkoutDraftField(t);
  } else if (t.id === 'draft-name') {
    ui.draft.name = t.value;
  } else if (t.id === 'exm-search') {
    ui.exm.q = t.value;
    $('#exm-list').innerHTML = exerciseManagerList();
  } else if (t.id === 'exd-name' && ui.exdraft) {
    ui.exdraft.name = t.value;
  } else if (t.id === 'exercise-search') {
    $('#exercise-list').innerHTML = exercisePickerHtml(t.value, t.dataset.mode);
  } else if (t.id === 'rest-seconds') {
    state.settings.rest = Math.max(0, Math.round(+t.value || 0)); save();
  } else if (t.id === 'weight-step') {
    // Kept per unit; out-of-range values are ignored (the default stays in use).
    const v = num(t.value.replace(',', '.')), u = unit() === 'lb' ? 'lb' : 'kg';
    const [lo, hi] = WEIGHT_STEP_LIMITS[u];
    if (v != null && v >= lo && v <= hi) { state.settings[u === 'lb' ? 'weightStepLb' : 'weightStepKg'] = v; save(); }
  }
});

/** Store a typed cardio value: distance (in the display unit) → metres, time → seconds; invalid → ''. */
function setCardioField(set, field, value, kind) {
  if (field === 'distance') {
    const v = num(String(value).replace(',', '.'));
    set.distance = v == null || v < 0 ? '' : toStoredDistance(v, kind);
  } else {
    const sec = parseClock(value);
    set.duration = sec == null ? '' : Math.round(sec);
  }
}

function updateWorkoutDraftField(t) {
  const key = { 'wedit-name': 'name', 'wedit-notes': 'notes', 'wedit-date': 'date', 'wedit-start': 'startTime', 'wedit-end': 'endTime' }[t.id];
  if (!key) return;
  ui.wdraft[key] = t.value;
  const dur = $('#wedit-duration');
  if (dur) dur.textContent = workoutDraftDurationText();
}

document.addEventListener('change', (ev) => {
  // Some iOS date/time pickers only report the final value on change.
  if (ev.target.id && ev.target.id.startsWith('wedit-') && ui.wdraft) updateWorkoutDraftField(ev.target);
  if (ev.target.id === 'progress-exercise') { ui.progressExercise = ev.target.value; render(); }
  if (ev.target.id === 'import-file' && ev.target.files[0]) { importData(ev.target.files[0]); ev.target.value = ''; }
});

$('#sheet-backdrop').addEventListener('click', () => {
  // A set menu opened from an editor goes back to that editor.
  const back = $('#sheet [data-action="set-menu-back"]');
  if (back) returnFromMenu(back.dataset.ctx);
  else if (ui.wdraft) cancelWorkoutEdit();
  else if (ui.draft) cancelTemplateDraft();
  else closeSheet();
});

// Offline support. A new version is installed in the background (see sw.js); when it
// takes over, offer a reload. All data is saved, so reloading never loses anything.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: nothing to update
    showUpdateNotice();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Home-screen apps are often resumed rather than reopened: check for updates then too.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  });
  window.reloadForUpdate = () => { reloading = true; location.reload(); };
}

function showUpdateNotice() {
  if ($('#update-notice')) return;
  const el = document.createElement('div');
  el.id = 'update-notice';
  el.className = 'update-notice';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span>New version ready</span><button type="button">Reload</button>';
  el.querySelector('button').addEventListener('click', () => window.reloadForUpdate());
  document.body.appendChild(el);
}

// First render once every script has loaded (Home uses Statistics and Insights helpers).
document.addEventListener('DOMContentLoaded', () => {
  render();
  if (loadWarning) setTimeout(() => alert(loadWarning), 300);
});
