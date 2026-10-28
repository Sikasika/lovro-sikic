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
  ['Running', 'Cardio'], ['Cycling', 'Cardio'], ['Rowing', 'Cardio']
];

/* ---------- State ---------- */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function defaultState() {
  return {
    exercises: DEFAULT_EXERCISES.map(([name, category]) => ({ id: uid(), name, category })),
    workouts: [],
    templates: [],
    active: null,
    settings: { unit: 'kg', rest: 90 },
    schemaVersion: SCHEMA_VERSION
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
      return { ...defaultState(), ...data, settings: { ...defaultState().settings, ...data.settings } };
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
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save. Storage may be full.');
  }
}

const ui = { tab: 'workout', progressExercise: null, restEnd: null, draft: null, draftOriginal: null, wdraft: null, wdraftOriginal: null };

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

function workoutVolume(w) {
  return w.entries.reduce((sum, e) => sum + completedSets(e).reduce((s, set) => s + (num(set.weight) || 0) * (num(set.reps) || 0), 0), 0);
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

function summarizeSets(sets) {
  return sets.map((s) => (num(s.weight) ? `${fmtWeight(num(s.weight))}×${num(s.reps) ?? 0}` : `${num(s.reps) ?? 0} reps`)).join(', ');
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

const TITLES = { workout: 'Workout', history: 'History', progress: 'Progress', statistics: 'Statistics', settings: 'Settings' };

function render() {
  $('#title').textContent = TITLES[ui.tab];
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const view = $('#view');
  const action = $('#topbar-action');
  action.innerHTML = '';
  if (ui.tab === 'workout') view.innerHTML = state.active ? renderActive(action) : renderStart();
  if (ui.tab === 'history') view.innerHTML = renderHistory();
  if (ui.tab === 'progress') view.innerHTML = renderProgress();
  if (ui.tab === 'statistics') view.innerHTML = renderStatistics();
  if (ui.tab === 'settings') view.innerHTML = renderSettings();
}

/* ----- Workout tab: start screen ----- */

function renderStart() {
  const recent = state.workouts.slice(0, 3);
  return `
    <div class="card card-pad" style="margin-top:12px">
      <div style="font-weight:600;font-size:20px">Ready to train?</div>
      <div class="sub" style="color:var(--muted);margin:4px 0 14px">Start an empty workout and add exercises as you go.</div>
      <button class="btn" data-action="start">Start Empty Workout</button>
    </div>

    <div class="section-title">My templates</div>
    <div class="template-grid">
      ${state.templates.map((t) => `
        <div class="template-tile" role="button" tabindex="0" data-action="start-template" data-id="${t.id}">
          <button class="tile-edit" data-action="edit-template" data-id="${t.id}" aria-label="Edit ${esc(t.name)}">•••</button>
          <div class="tile-name">${esc(t.name)}</div>
          <div class="tile-sub">${t.entries.length} exercise${t.entries.length === 1 ? '' : 's'}</div>
          <div class="tile-ex">${esc(t.entries.map((e) => exName(e.exerciseId)).join(', ') || 'No exercises yet')}</div>
          ${t.location ? `<div class="tile-loc">📍 ${esc(t.location)}</div>` : ''}
        </div>`).join('')}
      <button class="template-tile new" data-action="new-template">
        <span class="plus">＋</span>
        <span>New Template</span>
      </button>
    </div>

    ${recent.length ? `
      <div class="section-title">Repeat a recent workout</div>
      <div class="card">
        ${recent.map((w) => `
          <button class="list-item" data-action="repeat" data-id="${w.id}">
            <div class="grow">
              <div class="truncate">${esc(w.name)}</div>
              <div class="sub truncate">${esc(w.entries.map((e) => exName(e.exerciseId)).join(', ') || 'No exercises')}</div>
            </div>
            <span class="sub">${fmtDate(w.start, { day: 'numeric', month: 'short' })}</span>
            <span class="chev">›</span>
          </button>`).join('')}
      </div>` : ''}
  `;
}

/* ----- Templates ----- */

/** Places used before, most recent first, for location suggestions. */
function knownLocations() {
  const all = [state.active?.location, ...state.workouts.map((w) => w.location), ...state.templates.map((t) => t.location)];
  return [...new Set(all.filter(Boolean).map((l) => l.trim()).filter(Boolean))];
}

function locationOptions() {
  return `<datalist id="locations">${knownLocations().map((l) => `<option value="${esc(l)}">`).join('')}</datalist>`;
}

/*
  Template format: { id, name, location, entries: [{ exerciseId, sets: [{ weight, reps }] }] }
  where weight is a target in kg (number) or '' and reps is a target number or ''.
  Templates saved by older versions store sets as a count ({ sets: 3 }); they are read
  as that many empty sets and only rewritten in the new format when edited and saved.
*/

/** Planned sets of a template entry, in the current format (never mutates the template). */
function templateSets(entry) {
  if (Array.isArray(entry?.sets)) {
    return entry.sets.map((s) => ({ weight: num(s?.weight) ?? '', reps: num(s?.reps) ?? '' }));
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
      return { weight: w != null && w >= 0 ? w : '', reps: r != null && r >= 0 ? r : '' };
    })
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
    ? { id: t.id, name: t.name || '', location: t.location || '', entries: t.entries.map((e) => ({ exerciseId: e.exerciseId, sets: templateSets(e) })) }
    : { id: null, name: '', location: '', entries: [] };
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
  const scroll = $('#sheet .sheet-body')?.scrollTop ?? 0;
  const isEditor = !!$('#sheet .template-editor');
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
        <label class="field"><span>Location</span><input id="draft-location" list="locations" value="${esc(d.location)}" placeholder="Optional" autocomplete="off"></label>
      </div>
      ${locationOptions()}

      <div class="section-title">Exercises</div>
      ${editorExerciseCards(d.entries, 'draft')}
      <div class="btn-row" style="margin-top:16px"><button class="btn secondary" data-action="draft-add-exercise">＋ Add Exercise</button></div>
      <p class="tpl-hint">Leave a target empty to fill it in during the workout. Weights are in ${u}.</p>

      ${d.id ? `<div class="btn-row"><button class="btn danger" data-action="delete-template" data-id="${d.id}">Delete Template</button></div>` : ''}
    </div>
  `);
  // Keep the scroll position when the editor re-renders after a change.
  if (isEditor) $('#sheet .sheet-body').scrollTop = scroll;
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
  return entries.map((e, i) => {
    const name = esc(exName(e.exerciseId));
    return `
    <div class="card exercise-card tpl-card" style="margin-top:12px">
      <div class="ex-head">
        <span class="ex-name">${name}</span>
        <span class="tpl-ex-actions">
          <button class="icon-btn" data-action="${kind}-move-ex" data-entry="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${name} up">↑</button>
          <button class="icon-btn" data-action="${kind}-move-ex" data-entry="${i}" data-dir="1" ${i === entries.length - 1 ? 'disabled' : ''} aria-label="Move ${name} down">↓</button>
          <button class="icon-btn danger" data-action="${kind}-remove" data-entry="${i}" aria-label="Remove ${name}">✕</button>
        </span>
      </div>
      <table class="sets tpl-sets">
        <thead><tr><th>Set</th><th>${target}${u}</th><th>${target}reps</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>
          ${e.sets.map((st, j) => `
          <tr>
            <td class="set-num">${j + 1}</td>
            <td><input inputmode="decimal" ${field}="weight" data-entry="${i}" data-set="${j}" value="${esc(inputWeight(num(st.weight)))}" placeholder="–" aria-label="${name} set ${j + 1} ${target.toLowerCase()}weight (${u})"></td>
            <td><input inputmode="numeric" ${field}="reps" data-entry="${i}" data-set="${j}" value="${esc(st.reps)}" placeholder="–" aria-label="${name} set ${j + 1} ${target.toLowerCase()}reps"></td>
            <td class="tpl-set-actions">
              <button class="icon-btn" data-action="${kind}-move-set" data-entry="${i}" data-set="${j}" ${j === 0 ? 'disabled' : ''} aria-label="Move set ${j + 1} up">↑</button>
              <button class="icon-btn danger" data-action="${kind}-remove-set" data-entry="${i}" data-set="${j}" ${e.sets.length === 1 ? 'disabled' : ''} aria-label="Remove set ${j + 1}">✕</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="ex-actions">
        <button class="link" data-action="${kind}-add-set" data-entry="${i}">＋ Add Set</button>
        <span class="sub">${e.sets.length} set${e.sets.length === 1 ? '' : 's'}</span>
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
  } else if (op === 'remove') {
    if (!confirm(`Remove ${exName(entries[ei].exerciseId)}?`)) return false;
    entries.splice(ei, 1);
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
  const tpl = {
    id: d.id || uid(),
    name: d.name.trim() || 'My Template',
    location: (d.location || '').trim(),
    entries: d.entries.map((e) => ({ exerciseId: e.exerciseId, sets: templateSets(e) }))
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
  state.templates.push({ id: uid(), name: w.name, location: w.location || '', entries: entriesToTemplate(w.entries) });
  save();
  toast(`Saved “${w.name}” as a template`);
}

/* ----- Workout tab: active workout ----- */

function renderActive(action) {
  const w = state.active;
  action.innerHTML = `<button class="btn small" data-action="finish">Finish</button>`;
  return `
    <div class="card card-pad" style="margin-top:8px">
      <div class="workout-head">
        <input id="workout-name" value="${esc(w.name)}" aria-label="Workout name" autocomplete="off">
        <span class="elapsed" id="elapsed">${fmtDuration(Date.now() - new Date(w.start))}</span>
      </div>
      <div class="location-row">
        <span aria-hidden="true">📍</span>
        <input id="workout-location" list="locations" value="${esc(w.location)}" placeholder="Add location" aria-label="Location" autocomplete="off">
      </div>
      ${locationOptions()}
    </div>

    ${w.entries.map((entry, i) => renderEntry(entry, i)).join('')}

    <div class="btn-row" style="margin-top:16px">
      <button class="btn secondary" data-action="add-exercise">＋ Add Exercise</button>
    </div>

    <div class="section-title">Notes</div>
    <div class="card"><textarea class="notes" id="workout-notes" placeholder="How did it feel?">${esc(w.notes)}</textarea></div>

    <div class="btn-row"><button class="btn secondary" data-action="save-active-template">Save as Template</button></div>
    <div class="btn-row"><button class="btn danger" data-action="discard">Discard Workout</button></div>
  `;
}

function renderEntry(entry, i) {
  const last = lastEntryFor(entry.exerciseId);
  const lastSets = last ? completedSets(last) : [];
  return `
    <div class="card exercise-card" style="margin-top:12px" data-entry="${i}">
      <div class="ex-head">
        <span class="ex-name">${esc(exName(entry.exerciseId))}</span>
        <button class="link" data-action="entry-menu" data-entry="${i}" aria-label="Exercise options">•••</button>
      </div>
      ${last ? `<div class="ex-last">Last time: ${esc(summarizeSets(lastSets))}</div>` : ''}
      <table class="sets">
        <thead><tr><th>Set</th><th>${esc(unit())}</th><th>Reps</th><th>✓</th></tr></thead>
        <tbody>
          ${entry.sets.map((s, j) => {
            const prev = lastSets[j];
            return `
            <tr class="${s.done ? 'done' : ''}" data-set="${j}">
              <td class="set-num">${j + 1}</td>
              <td><input inputmode="decimal" data-field="weight" data-entry="${i}" data-set="${j}" value="${esc(inputWeight(num(s.weight)))}" placeholder="${esc(inputWeight(num(prev?.weight)))}" aria-label="Weight (${esc(unit())})"></td>
              <td><input inputmode="numeric" data-field="reps" data-entry="${i}" data-set="${j}" value="${esc(s.reps)}" placeholder="${prev?.reps ?? ''}" aria-label="Reps"></td>
              <td><button class="check" data-action="toggle-set" data-entry="${i}" data-set="${j}" aria-label="Mark set done">✓</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="ex-actions">
        <button class="link" data-action="add-set" data-entry="${i}">＋ Add Set</button>
        ${entry.sets.length > 1 ? `<button class="link danger" data-action="remove-set" data-entry="${i}">Remove Set</button>` : ''}
      </div>
    </div>
  `;
}

/* ----- History tab ----- */

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
      ${list.map((w) => `
        <button class="list-item" data-action="open-workout" data-id="${w.id}">
          <div class="grow">
            <div class="truncate">${esc(w.name)}</div>
            <div class="sub">${fmtDate(w.start)} · ${workoutDurationText(w)} · ${workoutSetCount(w)} sets</div>
            ${w.location ? `<div class="sub truncate">📍 ${esc(w.location)}</div>` : ''}
          </div>
          <span class="chev">›</span>
        </button>`).join('')}
    </div>`).join('');
}

/** Duration of a saved workout, or – when it has no valid end time. */
function workoutDurationText(w) {
  const ms = new Date(w.end) - new Date(w.start);
  return isNaN(ms) || ms < 0 ? '–' : fmtDuration(ms);
}

function renderWorkoutDetail(w) {
  const volume = workoutVolume(w);
  return `
    <div class="sheet-head">
      <button class="link danger" data-action="delete-workout" data-id="${w.id}">Delete</button>
      <h2>${esc(w.name)}</h2>
      <button class="link" data-action="close-sheet">Done</button>
    </div>
    <div class="sheet-body">
      <div class="stats">
        <div class="stat"><div class="num">${workoutDurationText(w)}</div><div class="lbl">Duration</div></div>
        <div class="stat"><div class="num">${workoutSetCount(w)}</div><div class="lbl">Sets</div></div>
        <div class="stat"><div class="num">${fmtWeight(volume)}</div><div class="lbl">Volume (${esc(unit())})</div></div>
      </div>
      <div class="section-title">${fmtDate(w.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${w.location ? ` · 📍 ${esc(w.location)}` : ''}</div>
      ${w.entries.map((e) => `
        <div class="card" style="margin-bottom:10px;padding:6px 0">
          <div class="detail-set" style="font-weight:600;color:var(--accent)">${esc(exName(e.exerciseId))}</div>
          ${completedSets(e).map((s, j) => `
            <div class="detail-set"><span class="muted">Set ${j + 1}</span><span>${num(s.weight) ? `${fmtWeight(num(s.weight))} ${esc(unit())} × ` : ''}${num(s.reps) ?? 0}</span></div>`).join('') || '<div class="detail-set muted">No completed sets</div>'}
        </div>`).join('')}
      ${w.notes ? `<div class="section-title">Notes</div><div class="card card-pad">${esc(w.notes)}</div>` : ''}
      <div class="btn-row"><button class="btn" data-action="edit-workout" data-id="${w.id}">Edit Workout</button></div>
      <div class="btn-row">
        <button class="btn secondary" data-action="repeat" data-id="${w.id}">Repeat Workout</button>
        <button class="btn secondary" data-action="save-history-template" data-id="${w.id}">Save as Template</button>
      </div>
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
    location: w.location || '',
    notes: w.notes || '',
    date: isNaN(start) ? '' : dateInputValue(start),
    startTime: isNaN(start) ? '' : timeInputValue(start),
    endTime: isNaN(end) ? '' : timeInputValue(end),
    entries: (w.entries || []).map((e) => ({
      exerciseId: e.exerciseId,
      sets: (e.sets || []).map((st) => ({ weight: num(st.weight) ?? '', reps: num(st.reps) ?? '', done: st.done !== false }))
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
  const scroll = $('#sheet .sheet-body')?.scrollTop ?? 0;
  const isEditor = !!$('#sheet .workout-editor');
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
        <label class="field"><span>Location</span><input id="wedit-location" list="locations" value="${esc(d.location)}" placeholder="Optional" autocomplete="off"></label>
      </div>
      ${locationOptions()}

      <div class="section-title">Exercises</div>
      ${editorExerciseCards(d.entries, 'wedit')}
      <div class="btn-row" style="margin-top:16px"><button class="btn secondary" data-action="wedit-add-exercise">＋ Add Exercise</button></div>
      <p class="tpl-hint">Sets left completely empty are removed when you save. Weights are in ${esc(unit())}.</p>

      <div class="section-title">Notes</div>
      <div class="card"><textarea class="notes" id="wedit-notes" placeholder="How did it feel?">${esc(d.notes)}</textarea></div>
    </div>
  `);
  if (isEditor) $('#sheet .sheet-body').scrollTop = scroll;
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
        .filter((st) => st.weight !== '' || st.reps !== '')
        .map((st) => ({ weight: st.weight, reps: st.reps === '' ? '' : String(st.reps), done: st.done !== false }))
    }))
    .filter((e) => e.sets.length);
  if (!entries.some((e) => completedSets(e).length)) {
    alert('A workout needs at least one set with weight or reps. To remove the whole workout, use Delete instead.');
    return;
  }
  const updated = {
    ...original,
    name: d.name.trim() || original.name || 'Workout',
    location: d.location.trim(),
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

function renderProgress() {
  const { items, today } = completedWorkouts();
  if (!items.length) {
    return `<div class="empty"><div class="big">📈</div>Finish a workout to see your progress.</div>`;
  }
  const thisWeek = startOfWeek(today);
  const weekCount = items.filter((it) => it.day >= thisWeek).length;
  const streak = weekStreak(items, today);

  // Workouts per week, last 8 weeks.
  const bars = weekBuckets(today, 8).map((b) => ({
    label: b.s.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' }),
    value: items.filter((it) => it.day >= b.s && it.day < b.e).length
  }));

  // Exercises that have history.
  const used = state.exercises.filter((ex) => items.some((it) => it.entries.some((e) => e.exerciseId === ex.id)));
  if (!ui.progressExercise || !used.some((e) => e.id === ui.progressExercise)) ui.progressExercise = used[0]?.id ?? null;

  return `
    <div class="stats" style="margin-top:12px">
      <div class="stat"><div class="num">${weekCount}</div><div class="lbl">This week</div></div>
      <div class="stat"><div class="num">${streak}</div><div class="lbl">Week streak (weeks in a row)</div></div>
      <div class="stat"><div class="num">${items.length}</div><div class="lbl">Total workouts</div></div>
    </div>

    <div class="section-title">Workouts per week</div>
    <div class="card card-pad">${barChart(bars)}</div>

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
  `;
}

function renderExerciseProgress(exerciseId, items) {
  const sessions = exerciseSessions(items, exerciseId);
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

function barChart(bars) {
  const W = 320, H = 140, pad = 20, max = Math.max(1, ...bars.map((b) => b.value));
  const bw = (W - pad) / bars.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Workouts per week">
    <line class="axis" x1="0" y1="${H - pad}" x2="${W}" y2="${H - pad}"/>
    ${bars.map((b, i) => {
      const h = (b.value / max) * (H - pad * 2);
      const x = i * bw + bw * 0.2;
      return `<rect class="bar ${i === bars.length - 1 ? '' : 'dim'}" x="${x}" y="${H - pad - h}" width="${bw * 0.6}" height="${Math.max(h, 0)}" rx="4"/>
        ${b.value ? `<text class="lbl" x="${x + bw * 0.3}" y="${H - pad - h - 4}" text-anchor="middle">${b.value}</text>` : ''}
        <text class="lbl" x="${x + bw * 0.3}" y="${H - 6}" text-anchor="middle">${b.label}</text>`;
    }).join('')}
  </svg>`;
}

function lineChart(points) {
  const W = 320, H = 160, padX = 28, padY = 18;
  if (points.length < 2) {
    return `<div class="empty" style="padding:24px">Log this exercise at least twice to see a trend.</div>`;
  }
  const vals = points.map((p) => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => padX + (i / (points.length - 1)) * (W - padX - 8);
  const y = (v) => padY + (1 - (v - min) / (max - min)) * (H - padY * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${H - padY} L${x(0).toFixed(1)},${H - padY} Z`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress over time">
    <line class="axis" x1="${padX}" y1="${H - padY}" x2="${W}" y2="${H - padY}"/>
    <text class="lbl" x="0" y="${y(max) + 3}">${fmtNum(max)}</text>
    <text class="lbl" x="0" y="${y(min) + 3}">${fmtNum(min)}</text>
    <path class="area" d="${area}"/>
    <path class="line" d="${path}"/>
    ${points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.value)}" r="3"/>`).join('')}
    <text class="lbl" x="${padX}" y="${H - 3}">${fmtDate(points[0].date, { day: 'numeric', month: 'short' })}</text>
    <text class="lbl" x="${W - 8}" y="${H - 3}" text-anchor="end">${fmtDate(points[points.length - 1].date, { day: 'numeric', month: 'short' })}</text>
  </svg>`;
}

/* ----- Settings tab ----- */

function renderSettings() {
  return `
    <div class="section-title">Preferences</div>
    <div class="card">
      <div class="field">
        <span>Weight unit</span>
        <div class="segmented">
          <button data-action="unit" data-unit="kg" class="${unit() === 'kg' ? 'on' : ''}">kg</button>
          <button data-action="unit" data-unit="lb" class="${unit() === 'lb' ? 'on' : ''}">lb</button>
        </div>
      </div>
      <label class="field">
        <span>Rest timer (seconds)</span>
        <input type="number" id="rest-seconds" min="0" step="15" inputmode="numeric" value="${state.settings.rest}">
      </label>
    </div>

    <div class="section-title">Exercises</div>
    <div class="card">
      <button class="list-item" data-action="manage-exercises">
        <span class="grow">Manage exercises</span>
        <span class="sub">${state.exercises.length}</span><span class="chev">›</span>
      </button>
    </div>

    <div class="section-title">Data</div>
    <div class="card">
      <button class="list-item" data-action="export"><span class="grow">Export backup</span><span class="chev">›</span></button>
      <button class="list-item" data-action="import"><span class="grow">Import backup</span><span class="chev">›</span></button>
      ${hasPreUpdateCopy() ? '<button class="list-item" data-action="export-pre-update"><span class="grow">Download pre-update copy</span><span class="chev">›</span></button>' : ''}
      <button class="list-item" data-action="reset" style="color:var(--danger)"><span class="grow">Erase all data</span></button>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" class="hidden">

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
  $('#sheet').classList.add('hidden');
  $('#sheet-backdrop').classList.add('hidden');
  $('#sheet').innerHTML = '';
}

function exercisePickerHtml(query = '', mode = 'pick') {
  const q = query.trim().toLowerCase();
  const list = state.exercises
    .filter((e) => !q || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const groups = new Map();
  list.forEach((e) => { if (!groups.has(e.category)) groups.set(e.category, []); groups.get(e.category).push(e); });
  const exact = state.exercises.some((e) => e.name.toLowerCase() === q);
  return `
    ${q && !exact ? `
      <div class="card" style="margin-bottom:8px">
        <button class="list-item" data-action="create-exercise" data-mode="${mode}" style="color:var(--accent)">＋ Create “${esc(query.trim())}”</button>
      </div>` : ''}
    ${[...groups].map(([cat, exs]) => `
      <div class="section-title">${esc(cat)}</div>
      <div class="card">
        ${exs.map((e) => mode !== 'manage'
          ? `<button class="list-item" data-action="pick-exercise" data-id="${e.id}" data-mode="${mode}"><span class="grow">${esc(e.name)}</span></button>`
          : `<div class="list-item"><span class="grow">${esc(e.name)}</span><button class="link danger" data-action="delete-exercise" data-id="${e.id}">Delete</button></div>`
        ).join('')}
      </div>`).join('') || (q ? '' : '<div class="empty">No exercises</div>')}
  `;
}

function openExercisePicker(mode = 'pick') {
  openSheet(`
    <div class="sheet-head">
      <span style="width:52px"></span>
      <h2>${mode === 'manage' ? 'Exercises' : 'Add Exercise'}</h2>
      <button class="link" data-action="${{ template: 'back-to-template', wedit: 'back-to-wedit' }[mode] || 'close-sheet'}">${mode === 'template' || mode === 'wedit' ? 'Back' : 'Done'}</button>
    </div>
    <div class="sheet-body">
      <input class="search" id="exercise-search" placeholder="Search or create exercise" autocomplete="off" data-mode="${mode}">
      <div id="exercise-list">${exercisePickerHtml('', mode)}</div>
    </div>
  `);
}

function openCategoryPicker(name, mode) {
  const cats = [...new Set([...state.exercises.map((e) => e.category), 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Other'])];
  openSheet(`
    <div class="sheet-head">
      <span style="width:52px"></span>
      <h2>Category for “${esc(name)}”</h2>
      <button class="link" data-action="${{ template: 'back-to-template', wedit: 'back-to-wedit' }[mode] || 'close-sheet'}">Cancel</button>
    </div>
    <div class="sheet-body">
      <div class="card">
        ${cats.map((c) => `<button class="list-item" data-action="choose-category" data-category="${esc(c)}" data-name="${esc(name)}" data-mode="${mode}"><span class="grow">${esc(c)}</span></button>`).join('')}
      </div>
    </div>
  `);
}

/* ---------- Workout actions ---------- */

/**
 * Start a workout from nothing, from a template (sets pre-filled with its targets),
 * or from a past workout to repeat (same exercises and set counts, empty values).
 */
function startWorkout(from) {
  const isTemplate = !!from && state.templates.includes(from);
  const setCount = (e) => (completedSets(e).length || e.sets.length);
  // New objects only, so the workout never changes the template it came from.
  const setsFor = (e) => (isTemplate
    ? templateSets(e).map((p) => ({ weight: p.weight, reps: p.reps === '' ? '' : String(p.reps), done: false }))
    : Array.from({ length: Math.max(1, setCount(e)) }, () => ({ weight: '', reps: '', done: false })));
  state.active = {
    id: uid(),
    name: from ? from.name : defaultWorkoutName(),
    location: from?.location || '',
    templateId: isTemplate ? from.id : null,
    start: new Date().toISOString(),
    notes: '',
    entries: from ? from.entries.map((e) => ({ exerciseId: e.exerciseId, sets: setsFor(e) })) : []
  };
  save();
  ui.tab = 'workout';
  closeSheet();
  render();
}

function addExerciseToWorkout(exerciseId) {
  const last = lastEntryFor(exerciseId);
  const count = last ? completedSets(last).length : 3;
  state.active.entries.push({ exerciseId, sets: Array.from({ length: Math.max(1, count) }, () => ({ weight: '', reps: '', done: false })) });
  save();
  closeSheet();
  render();
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function finishWorkout() {
  const w = state.active;
  // Fill blanks from placeholders (last session) for sets marked done.
  w.entries.forEach((entry) => {
    const lastSets = (() => { const l = lastEntryFor(entry.exerciseId); return l ? completedSets(l) : []; })();
    entry.sets.forEach((s, j) => {
      if (s.done) {
        if (s.weight === '' && lastSets[j]) s.weight = lastSets[j].weight;
        if (s.reps === '' && lastSets[j]) s.reps = lastSets[j].reps;
      }
    });
    entry.sets = entry.sets.filter((s) => s.done);
  });
  w.entries = w.entries.filter((e) => e.sets.length);
  if (!w.entries.length) {
    if (!confirm('No sets are checked off. Discard this workout?')) return;
    state.active = null;
  } else {
    w.end = new Date().toISOString();
    state.workouts.unshift(w);
    state.workouts.sort((a, b) => new Date(b.start) - new Date(a.start));
    state.active = null;
    toast(`Workout saved · ${workoutSetCount(w)} sets 💪`);
  }
  stopRest();
  save();
  render();
}

/* ---------- Rest timer ---------- */

let restInterval = null;

function startRest(seconds = state.settings.rest) {
  if (!seconds) return;
  ui.restEnd = Date.now() + seconds * 1000;
  $('#rest').classList.remove('hidden');
  tickRest();
  clearInterval(restInterval);
  restInterval = setInterval(tickRest, 250);
}

function tickRest() {
  const left = ui.restEnd - Date.now();
  if (left <= 0) {
    stopRest();
    haptic();
    toast('Rest over. Next set! 🔔');
    return;
  }
  $('#rest-time').textContent = fmtDuration(left + 999);
}

function stopRest() {
  clearInterval(restInterval);
  ui.restEnd = null;
  $('#rest').classList.add('hidden');
}

/* ---------- Backup ---------- */

function hasPreUpdateCopy() {
  try { return !!localStorage.getItem(BACKUP_KEY); } catch (e) { return false; }
}

function exportData() {
  const json = JSON.stringify({ app: 'training-tracker', exportedAt: new Date().toISOString(), ...state }, null, 2);
  return shareFile(json, `training-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

/** The original data from before the v2 upgrade. It can be imported again like any backup. */
function exportPreUpdateCopy() {
  let raw = null;
  try { raw = localStorage.getItem(BACKUP_KEY); } catch (e) { /* ignore */ }
  if (!raw) { toast('No pre-update copy on this device'); return; }
  return shareFile(raw, 'training-backup-before-update.json');
}

async function shareFile(json, filename) {
  const file = new File([json], filename, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Training backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.workouts) || !Array.isArray(parsed.exercises)) throw new Error('Invalid file');
      const data = migrate(parsed); // older backups store weights as typed; convert like stored data
      if (!confirm(`Replace current data with backup (${data.workouts.length} workouts)?`)) return;
      state = { ...defaultState(), exercises: data.exercises, workouts: data.workouts, templates: data.templates ?? [], active: data.active ?? null, settings: { ...defaultState().settings, ...data.settings }, schemaVersion: data.schemaVersion };
      save();
      render();
      toast('Backup imported');
    } catch (e) {
      alert('That file is not a valid Training Tracker backup.');
    }
  };
  reader.readAsText(file);
}

/* ---------- Events ---------- */

document.addEventListener('click', (ev) => {
  const tab = ev.target.closest('.tabbar button');
  if (tab) { ui.tab = tab.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); return; }

  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  const ei = el.dataset.entry != null ? +el.dataset.entry : null;
  const si = el.dataset.set != null ? +el.dataset.set : null;

  // Exercise/set editing shared by the template editor (draft-*) and workout editor (wedit-*).
  const edit = action.match(/^(draft|wedit)-(move-ex|remove|add-set|remove-set|move-set)$/);
  if (edit) {
    const isTemplate = edit[1] === 'draft';
    const entries = (isTemplate ? ui.draft : ui.wdraft)?.entries;
    if (entries && editEntries(entries, edit[2], ei, si, +el.dataset.dir)) (isTemplate ? openTemplateEditor : openWorkoutEditor)();
    return;
  }

  switch (action) {
    case 'start': startWorkout(); break;
    case 'repeat': {
      if (state.active && !confirm('Replace the workout in progress?')) return;
      startWorkout(state.workouts.find((w) => w.id === id));
      break;
    }
    case 'finish': finishWorkout(); break;
    case 'start-template': startWorkout(state.templates.find((t) => t.id === id)); break;
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
    case 'discard':
      if (confirm('Discard this workout? This cannot be undone.')) { state.active = null; stopRest(); save(); render(); }
      break;
    case 'add-exercise': openExercisePicker('pick'); setTimeout(() => $('#exercise-search')?.focus(), 300); break;
    case 'pick-exercise':
      if (el.dataset.mode === 'wedit') { ui.wdraft.entries.push({ exerciseId: id, sets: newLoggedSets() }); openWorkoutEditor(); }
      else if (el.dataset.mode === 'template') { ui.draft.entries.push({ exerciseId: id, sets: defaultPlannedSets(id) }); openTemplateEditor(); }
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
      else openExercisePicker('manage');
      break;
    }
    case 'delete-exercise': {
      const usedIn = (list) => list.some((w) => w.entries.some((e) => e.exerciseId === id));
      const used = usedIn(state.workouts) || usedIn(state.templates) || state.active?.entries.some((e) => e.exerciseId === id);
      if (used) { alert('This exercise is used in your workouts or templates and cannot be deleted.'); return; }
      state.exercises = state.exercises.filter((e) => e.id !== id);
      save();
      $('#exercise-list').innerHTML = exercisePickerHtml($('#exercise-search').value, 'manage');
      break;
    }
    case 'manage-exercises': openExercisePicker('manage'); break;
    case 'toggle-set': {
      const set = state.active.entries[ei].sets[si];
      set.done = !set.done;
      el.closest('tr').classList.toggle('done', set.done);
      save();
      if (set.done) { haptic(); startRest(); }
      break;
    }
    case 'add-set': {
      const sets = state.active.entries[ei].sets;
      const prev = sets[sets.length - 1];
      sets.push({ weight: prev?.weight ?? '', reps: prev?.reps ?? '', done: false });
      save(); render();
      break;
    }
    case 'remove-set': state.active.entries[ei].sets.pop(); save(); render(); break;
    case 'entry-menu': {
      const entries = state.active.entries;
      openSheet(`
        <div class="sheet-head"><span style="width:52px"></span><h2>${esc(exName(entries[ei].exerciseId))}</h2><button class="link" data-action="close-sheet">Cancel</button></div>
        <div class="sheet-body"><div class="card">
          ${ei > 0 ? `<button class="list-item" data-action="move-entry" data-entry="${ei}" data-dir="-1">Move up</button>` : ''}
          ${ei < entries.length - 1 ? `<button class="list-item" data-action="move-entry" data-entry="${ei}" data-dir="1">Move down</button>` : ''}
          <button class="list-item" data-action="remove-entry" data-entry="${ei}" style="color:var(--danger)">Remove exercise</button>
        </div></div>`);
      break;
    }
    case 'move-entry': {
      const entries = state.active.entries, to = ei + +el.dataset.dir;
      [entries[ei], entries[to]] = [entries[to], entries[ei]];
      save(); closeSheet(); render();
      break;
    }
    case 'remove-entry': state.active.entries.splice(ei, 1); save(); closeSheet(); render(); break;
    case 'open-workout': openSheet(renderWorkoutDetail(state.workouts.find((w) => w.id === id))); break;
    case 'delete-workout':
      if (confirm('Delete this workout?')) { state.workouts = state.workouts.filter((w) => w.id !== id); save(); closeSheet(); render(); }
      break;
    case 'close-sheet': closeSheet(); break;
    case 'unit': state.settings.unit = el.dataset.unit; save(); render(); break;
    case 'export': exportData(); break;
    case 'export-pre-update': exportPreUpdateCopy(); break;
    case 'import': $('#import-file').click(); break;
    case 'reset':
      if (confirm('Erase ALL workouts and custom exercises? Export a backup first if you want to keep them.')) {
        state = defaultState(); stopRest(); save(); render(); toast('All data erased');
      }
      break;
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.field && state.active) {
    const set = state.active.entries[+t.dataset.entry].sets[+t.dataset.set];
    const value = t.value.replace(',', '.');
    if (t.dataset.field === 'weight') {
      // Typed in the selected unit, stored in kg.
      const v = num(value);
      set.weight = v == null || v < 0 ? '' : toStoredWeight(v);
    } else {
      set[t.dataset.field] = value;
    }
    save();
  } else if (t.id === 'workout-name') {
    state.active.name = t.value; save();
  } else if (t.id === 'workout-location') {
    state.active.location = t.value; save();
  } else if (t.dataset.tfield && ui.draft) {
    // Template targets: weight typed in the selected unit and stored in kg, reps as a whole number.
    const set = ui.draft.entries[+t.dataset.entry].sets[+t.dataset.set];
    const v = num(t.value.replace(',', '.'));
    if (t.dataset.tfield === 'weight') set.weight = v == null || v < 0 ? '' : toStoredWeight(v);
    else set.reps = v == null || v < 0 ? '' : Math.round(v);
  } else if (t.dataset.wfield && ui.wdraft) {
    // Saved-workout sets: weight typed in the selected unit and stored in kg, reps as a whole number.
    const set = ui.wdraft.entries[+t.dataset.entry].sets[+t.dataset.set];
    const v = num(t.value.replace(',', '.'));
    if (t.dataset.wfield === 'weight') set.weight = v == null || v < 0 ? '' : toStoredWeight(v);
    else set.reps = v == null || v < 0 ? '' : Math.round(v);
  } else if (t.id && t.id.startsWith('wedit-') && ui.wdraft) {
    updateWorkoutDraftField(t);
  } else if (t.id === 'draft-name') {
    ui.draft.name = t.value;
  } else if (t.id === 'draft-location') {
    ui.draft.location = t.value;
  } else if (t.id === 'workout-notes') {
    state.active.notes = t.value; save();
  } else if (t.id === 'exercise-search') {
    $('#exercise-list').innerHTML = exercisePickerHtml(t.value, t.dataset.mode);
  } else if (t.id === 'rest-seconds') {
    state.settings.rest = Math.max(0, Math.round(+t.value || 0)); save();
  }
});

function updateWorkoutDraftField(t) {
  const key = { 'wedit-name': 'name', 'wedit-location': 'location', 'wedit-notes': 'notes', 'wedit-date': 'date', 'wedit-start': 'startTime', 'wedit-end': 'endTime' }[t.id];
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
  if (ui.wdraft) cancelWorkoutEdit();
  else if (ui.draft) cancelTemplateDraft();
  else closeSheet();
});
$('#rest-minus').addEventListener('click', () => { ui.restEnd -= 15000; tickRest(); });
$('#rest-plus').addEventListener('click', () => { ui.restEnd += 15000; tickRest(); });
$('#rest-skip').addEventListener('click', stopRest);

// Keep the elapsed workout clock ticking.
setInterval(() => {
  const el = $('#elapsed');
  if (el && state.active) el.textContent = fmtDuration(Date.now() - new Date(state.active.start));
}, 1000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

render();
if (loadWarning) setTimeout(() => alert(loadWarning), 300);
