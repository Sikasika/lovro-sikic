'use strict';

/* =========================================================
   Training Tracker: workouts, sets/reps, rest timer, progress.
   All data is stored on the device in localStorage.
   ========================================================= */

const STORAGE_KEY = 'training-tracker.v1';

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
    settings: { unit: 'kg', rest: 90 }
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return { ...defaultState(), ...data, settings: { ...defaultState().settings, ...data.settings } };
    }
  } catch (e) {
    console.error('Could not load data', e);
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

const ui = { tab: 'workout', progressExercise: null, restEnd: null, draft: null };

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

/** Estimated one-rep max (Epley). */
const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));

const completedSets = (entry) => entry.sets.filter((s) => s.done !== false && (num(s.reps) || num(s.weight)));

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
  return sets.map((s) => (num(s.weight) ? `${fmtNum(num(s.weight))}×${num(s.reps) ?? 0}` : `${num(s.reps) ?? 0} reps`)).join(', ');
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

/** Turn workout entries into template entries (exercise + number of sets). */
function entriesToTemplate(entries) {
  return entries.map((e) => ({ exerciseId: e.exerciseId, sets: Math.max(1, e.sets.length) }));
}

function openTemplateEditor() {
  const d = ui.draft;
  openSheet(`
    <div class="sheet-head">
      <button class="link" data-action="close-sheet">Cancel</button>
      <h2>${d.id ? 'Edit Template' : 'New Template'}</h2>
      <button class="link" data-action="save-template" style="font-weight:600">Save</button>
    </div>
    <div class="sheet-body">
      <div class="card">
        <label class="field"><span>Name</span><input id="draft-name" value="${esc(d.name)}" placeholder="e.g. Push Day" autocomplete="off"></label>
        <label class="field"><span>Location</span><input id="draft-location" list="locations" value="${esc(d.location)}" placeholder="Optional" autocomplete="off"></label>
      </div>
      ${locationOptions()}

      <div class="section-title">Exercises</div>
      ${d.entries.length ? `<div class="card">
        ${d.entries.map((e, i) => `
          <div class="list-item">
            <div class="grow truncate">${esc(exName(e.exerciseId))}</div>
            <div class="stepper">
              <button data-action="draft-sets" data-entry="${i}" data-dir="-1" aria-label="Fewer sets">−</button>
              <span>${e.sets} set${e.sets === 1 ? '' : 's'}</span>
              <button data-action="draft-sets" data-entry="${i}" data-dir="1" aria-label="More sets">＋</button>
            </div>
            <button class="link danger" data-action="draft-remove" data-entry="${i}" aria-label="Remove exercise">✕</button>
          </div>`).join('')}
      </div>` : '<div class="card card-pad" style="color:var(--muted)">No exercises yet.</div>'}
      <div class="btn-row"><button class="btn secondary" data-action="draft-add-exercise">＋ Add Exercise</button></div>

      ${d.id ? `<div class="btn-row"><button class="btn danger" data-action="delete-template" data-id="${d.id}">Delete Template</button></div>` : ''}
    </div>
  `);
}

function saveTemplate() {
  const d = ui.draft;
  d.name = d.name.trim() || 'My Template';
  d.location = (d.location || '').trim();
  const i = state.templates.findIndex((t) => t.id === d.id);
  if (i >= 0) state.templates[i] = d;
  else state.templates.push({ ...d, id: uid() });
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
              <td><input inputmode="decimal" data-field="weight" data-entry="${i}" data-set="${j}" value="${esc(s.weight)}" placeholder="${prev?.weight ?? ''}" aria-label="Weight"></td>
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
            <div class="sub">${fmtDate(w.start)} · ${fmtDuration(new Date(w.end) - new Date(w.start))} · ${workoutSetCount(w)} sets</div>
            ${w.location ? `<div class="sub truncate">📍 ${esc(w.location)}</div>` : ''}
          </div>
          <span class="chev">›</span>
        </button>`).join('')}
    </div>`).join('');
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
        <div class="stat"><div class="num">${fmtDuration(new Date(w.end) - new Date(w.start))}</div><div class="lbl">Duration</div></div>
        <div class="stat"><div class="num">${workoutSetCount(w)}</div><div class="lbl">Sets</div></div>
        <div class="stat"><div class="num">${fmtNum(volume)}</div><div class="lbl">Volume (${esc(unit())})</div></div>
      </div>
      <div class="section-title">${fmtDate(w.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${w.location ? ` · 📍 ${esc(w.location)}` : ''}</div>
      ${w.entries.map((e) => `
        <div class="card" style="margin-bottom:10px;padding:6px 0">
          <div class="detail-set" style="font-weight:600;color:var(--accent)">${esc(exName(e.exerciseId))}</div>
          ${completedSets(e).map((s, j) => `
            <div class="detail-set"><span class="muted">Set ${j + 1}</span><span>${num(s.weight) ? `${fmtNum(num(s.weight))} ${esc(unit())} × ` : ''}${num(s.reps) ?? 0}</span></div>`).join('') || '<div class="detail-set muted">No completed sets</div>'}
        </div>`).join('')}
      ${w.notes ? `<div class="section-title">Notes</div><div class="card card-pad">${esc(w.notes)}</div>` : ''}
      <div class="btn-row">
        <button class="btn secondary" data-action="repeat" data-id="${w.id}">Repeat Workout</button>
        <button class="btn secondary" data-action="save-history-template" data-id="${w.id}">Save as Template</button>
      </div>
    </div>
  `;
}

/* ----- Progress tab ----- */

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

function renderProgress() {
  if (!state.workouts.length) {
    return `<div class="empty"><div class="big">📈</div>Finish a workout to see your progress.</div>`;
  }
  const thisWeek = startOfWeek(new Date());
  const weekWorkouts = state.workouts.filter((w) => new Date(w.start) >= thisWeek);

  // Weekly streak: consecutive weeks (ending this or last week) with at least one workout.
  const weeks = new Set(state.workouts.map((w) => startOfWeek(w.start).getTime()));
  let streak = 0;
  const cursor = new Date(thisWeek);
  if (!weeks.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 7);
  while (weeks.has(cursor.getTime())) { streak++; cursor.setDate(cursor.getDate() - 7); }

  // Workouts per week, last 8 weeks.
  const bars = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(thisWeek); start.setDate(start.getDate() - i * 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    bars.push({
      label: start.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' }),
      value: state.workouts.filter((w) => { const d = new Date(w.start); return d >= start && d < end; }).length
    });
  }

  // Exercises that have history.
  const used = state.exercises.filter((ex) => state.workouts.some((w) => w.entries.some((e) => e.exerciseId === ex.id && completedSets(e).length)));
  if (!ui.progressExercise || !used.some((e) => e.id === ui.progressExercise)) ui.progressExercise = used[0]?.id ?? null;

  return `
    <div class="stats" style="margin-top:12px">
      <div class="stat"><div class="num">${weekWorkouts.length}</div><div class="lbl">This week</div></div>
      <div class="stat"><div class="num">${streak}</div><div class="lbl">Week streak</div></div>
      <div class="stat"><div class="num">${state.workouts.length}</div><div class="lbl">Total workouts</div></div>
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
      ${renderExerciseProgress(ui.progressExercise)}` : ''}
  `;
}

function renderExerciseProgress(exerciseId) {
  const points = [];
  let bestWeight = 0, bestReps = 0, best1rm = 0;
  for (const w of [...state.workouts].reverse()) {
    const sets = w.entries.filter((e) => e.exerciseId === exerciseId).flatMap(completedSets);
    if (!sets.length) continue;
    let top = 0;
    for (const s of sets) {
      const weight = num(s.weight) || 0, reps = num(s.reps) || 0;
      bestWeight = Math.max(bestWeight, weight);
      bestReps = Math.max(bestReps, reps);
      top = Math.max(top, weight ? e1rm(weight, reps) : reps);
    }
    best1rm = Math.max(best1rm, top);
    points.push({ date: w.start, value: top });
  }
  const bodyweight = bestWeight === 0;
  return `
    <div class="card card-pad" style="margin-top:12px">
      <div class="sub" style="color:var(--muted);font-size:13px;margin-bottom:6px">${bodyweight ? 'Best reps per session' : `Estimated 1-rep max per session (${esc(unit())})`}</div>
      ${lineChart(points)}
    </div>
    <div class="stats" style="margin-top:12px">
      ${bodyweight
        ? `<div class="stat"><div class="num">${bestReps}</div><div class="lbl">Best reps</div></div>`
        : `<div class="stat"><div class="num">${fmtNum(bestWeight)}</div><div class="lbl">Heaviest (${esc(unit())})</div></div>
           <div class="stat"><div class="num">${fmtNum(best1rm)}</div><div class="lbl">Best est. 1RM</div></div>`}
      <div class="stat"><div class="num">${points.length}</div><div class="lbl">Sessions</div></div>
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
      <button class="link" data-action="${mode === 'template' ? 'back-to-template' : 'close-sheet'}">${mode === 'template' ? 'Back' : 'Done'}</button>
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
      <button class="link" data-action="${mode === 'template' ? 'back-to-template' : 'close-sheet'}">Cancel</button>
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
 * Start a workout. `from` can be a template ({ entries: [{ exerciseId, sets: n }] })
 * or a past workout to repeat ({ entries: [{ exerciseId, sets: [...] }] }).
 */
function startWorkout(from) {
  const setCount = (e) => (typeof e.sets === 'number' ? e.sets : (completedSets(e).length || e.sets.length));
  state.active = {
    id: uid(),
    name: from ? from.name : defaultWorkoutName(),
    location: from?.location || '',
    templateId: from && state.templates.includes(from) ? from.id : null,
    start: new Date().toISOString(),
    notes: '',
    entries: from
      ? from.entries.map((e) => ({
          exerciseId: e.exerciseId,
          sets: Array.from({ length: Math.max(1, setCount(e)) }, () => ({ weight: '', reps: '', done: false }))
        }))
      : []
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

async function exportData() {
  const json = JSON.stringify({ app: 'training-tracker', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2);
  const filename = `training-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.workouts) || !Array.isArray(data.exercises)) throw new Error('Invalid file');
      if (!confirm(`Replace current data with backup (${data.workouts.length} workouts)?`)) return;
      state = { ...defaultState(), exercises: data.exercises, workouts: data.workouts, templates: data.templates ?? [], active: data.active ?? null, settings: { ...defaultState().settings, ...data.settings } };
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
      ui.draft = { id: null, name: '', location: '', entries: [] };
      openTemplateEditor();
      setTimeout(() => $('#draft-name')?.focus(), 300);
      break;
    case 'edit-template': {
      const t = state.templates.find((x) => x.id === id);
      ui.draft = { ...t, entries: t.entries.map((e) => ({ ...e })) };
      openTemplateEditor();
      break;
    }
    case 'save-template': saveTemplate(); break;
    case 'delete-template':
      if (confirm(`Delete the template “${ui.draft.name}”? Your past workouts are kept.`)) {
        state.templates = state.templates.filter((t) => t.id !== id);
        ui.draft = null; save(); closeSheet(); render();
      }
      break;
    case 'draft-add-exercise': openExercisePicker('template'); break;
    case 'back-to-template': openTemplateEditor(); break;
    case 'draft-sets': {
      const e = ui.draft.entries[ei];
      e.sets = Math.min(20, Math.max(1, e.sets + +el.dataset.dir));
      openTemplateEditor();
      break;
    }
    case 'draft-remove': ui.draft.entries.splice(ei, 1); openTemplateEditor(); break;
    case 'save-active-template': saveAsTemplate(state.active); break;
    case 'save-history-template': saveAsTemplate(state.workouts.find((w) => w.id === id)); break;
    case 'discard':
      if (confirm('Discard this workout? This cannot be undone.')) { state.active = null; stopRest(); save(); render(); }
      break;
    case 'add-exercise': openExercisePicker('pick'); setTimeout(() => $('#exercise-search')?.focus(), 300); break;
    case 'pick-exercise':
      if (el.dataset.mode === 'template') { ui.draft.entries.push({ exerciseId: id, sets: 3 }); openTemplateEditor(); }
      else addExerciseToWorkout(id);
      break;
    case 'create-exercise': openCategoryPicker($('#exercise-search').value.trim(), el.dataset.mode); break;
    case 'choose-category': {
      const ex = { id: uid(), name: el.dataset.name, category: el.dataset.category };
      state.exercises.push(ex);
      save();
      if (el.dataset.mode === 'template') { ui.draft.entries.push({ exerciseId: ex.id, sets: 3 }); openTemplateEditor(); }
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
    state.active.entries[+t.dataset.entry].sets[+t.dataset.set][t.dataset.field] = t.value.replace(',', '.');
    save();
  } else if (t.id === 'workout-name') {
    state.active.name = t.value; save();
  } else if (t.id === 'workout-location') {
    state.active.location = t.value; save();
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

document.addEventListener('change', (ev) => {
  if (ev.target.id === 'progress-exercise') { ui.progressExercise = ev.target.value; render(); }
  if (ev.target.id === 'import-file' && ev.target.files[0]) { importData(ev.target.files[0]); ev.target.value = ''; }
});

$('#sheet-backdrop').addEventListener('click', closeSheet);
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
