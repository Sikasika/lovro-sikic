/*
  Workout tab: start screen, choosing and reviewing a template, the live session,
  the rest timer and finishing.

  Loaded before app.js. Everything here runs only when called (after all scripts
  have loaded), so it can use app.js and calc.js helpers freely.

  Flow: Start Workout → pick a template / recent workout (→ review → Begin) or
  "Start empty workout". The workout clock starts only at that explicit step.

  Set completion: a set is done only when its ✓ button is tapped. Ticking a set
  whose weight/reps are blank fills them from the template target or last time's
  values (the grey placeholders), so the row shows exactly what will be saved.
  All visual state (done rows, next set, counts) is re-derived from `state.active`
  by syncWorkoutStatus(), never toggled on its own, so screen and data can't drift.
*/

/* ---------- Helpers ---------- */

/** True when a set has any value entered (weight, reps, distance or time). */
function setHasValues(s) {
  return ['weight', 'reps', 'distance', 'duration'].some((k) => (num(s?.[k]) || 0) > 0);
}

/** Completed sets of the most recent saved workout with this exercise. */
function lastSetsFor(exerciseId) {
  const last = lastEntryFor(exerciseId);
  return last ? completedSets(last) : [];
}

/**
 * Fill blank weight/reps of set j from its template target, else last time's set j
 * (the values shown as placeholders). Cardio distance/time are never filled in:
 * only what was measured is kept. Returns true if anything changed.
 */
function fillFromSuggestion(entry, j, lastSets = lastSetsFor(entry.exerciseId)) {
  if (cardioKindOf(entry.exerciseId)) return false;
  const s = entry.sets[j];
  const src = s.target || lastSets[j];
  let changed = false;
  if ((s.weight === '' || s.weight == null) && num(src?.weight) != null) { s.weight = num(src.weight); changed = true; }
  if ((s.reps === '' || s.reps == null) && num(src?.reps) != null) { s.reps = String(num(src.reps)); changed = true; }
  return changed;
}

/** Short "previous" text for one set: "80×5", "12 reps", "5.00 km 25:00". */
function prevText(s, ck) {
  if (!s) return '–';
  if (ck || hasCardioValues(s)) {
    const parts = [];
    if (num(s.distance) > 0) parts.push(fmtDistance(num(s.distance), ck || 'other'));
    if (num(s.duration) > 0) parts.push(fmtClock(num(s.duration)));
    return parts.join(' ') || setValueText(s, ck);
  }
  return setValueText(s, null);
}

/** Most common activity type in a list of entries (weights/cardio/sports/other), for colour. */
function mainActivity(entries) {
  const n = {};
  entries.forEach((e) => { const t = entryType(e); n[t] = (n[t] || 0) + 1; });
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || 'other';
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Up to two initials of a name, for the template badge. */
const initials = (name) => (String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '•');

/** The set to do next: first unticked set; in a superset, round by round across its exercises. */
function nextSetPosition(entries) {
  for (let i = 0; i < entries.length;) {
    let k = i;
    while (entries[i].superset && entries[k + 1]?.superset === entries[i].superset) k++;
    let best = null;
    for (let x = i; x <= k; x++) {
      const j = entries[x].sets.findIndex((s) => !s.done);
      if (j >= 0 && (!best || j < best.j)) best = { i: x, j };
    }
    if (best) return best;
    i = k + 1;
  }
  return null;
}

/** Counts for the live workout: ticked sets, all sets, unticked sets that have values. */
function sessionCounts(w) {
  let done = 0, total = 0, pendingValues = 0;
  w.entries.forEach((e) => e.sets.forEach((s) => {
    total++;
    if (s.done) done++;
    else if (setHasValues(s)) pendingValues++;
  }));
  return { done, total, pendingValues };
}

/** Ignore taps on the page briefly after the screen changes, so a double tap can't hit the new screen. */
function guardTaps(ms = 450) { ui.tapGuardUntil = performance.now() + ms; } // monotonic: unaffected by clock changes

/** Go to the live workout, back where it was scrolled to. */
function showActiveWorkout() {
  ui.tab = 'workout';
  closeSheet();
  render();
  window.scrollTo(0, ui.wkScroll || 0);
}

/* ---------- Start screen ---------- */

function templateRow(t, withEdit) {
  const n = t.entries.length;
  const sets = t.entries.reduce((a, e) => a + templateSets(e).length, 0);
  return `
    <div class="tpl-row">
      <button type="button" class="tpl-main" data-action="review" data-kind="template" data-id="${t.id}">
        <span class="tpl-badge act-${mainActivity(t.entries)}" aria-hidden="true">${esc(initials(t.name))}</span>
        <span class="grow">
          <span class="tpl-name truncate">${esc(t.name)}</span>
          <span class="tpl-sub truncate">${n ? `${plural(n, 'exercise')} · ${plural(sets, 'set')} · ${esc(t.entries.map((e) => exName(e.exerciseId)).join(', '))}` : 'No exercises yet'}</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      ${withEdit ? `<button type="button" class="tpl-more" data-action="edit-template" data-id="${t.id}" aria-label="Edit template ${esc(t.name)}">•••</button>` : ''}
    </div>`;
}

function recentRow(w) {
  return `
    <div class="tpl-row">
      <button type="button" class="tpl-main" data-action="review" data-kind="repeat" data-id="${w.id}">
        <span class="tpl-badge recent act-${mainActivity(w.entries)}" aria-hidden="true">↻</span>
        <span class="grow">
          <span class="tpl-name truncate">${esc(w.name)}</span>
          <span class="tpl-sub truncate">${fmtDate(w.start)} · ${esc(w.entries.map((e) => exName(e.exerciseId)).join(', ') || 'No exercises')}</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
    </div>`;
}

function savedCard(w) {
  return `
    <div class="saved-card" role="status">
      <span class="saved-icon" aria-hidden="true">✓</span>
      <div class="grow">
        <div class="saved-title">Workout saved</div>
        <div class="saved-sub truncate">${esc(w.name)} · ${workoutDurationText(w)} · ${workoutSetCount(w)} sets</div>
      </div>
      <button type="button" class="link" data-action="open-workout" data-id="${w.id}">View</button>
      <button type="button" class="saved-close" data-action="dismiss-saved" aria-label="Dismiss">✕</button>
    </div>`;
}

function renderStart() {
  const last = state.workouts[0];
  const saved = ui.savedId && state.workouts.find((w) => w.id === ui.savedId);
  const recent = state.workouts.slice(0, 3);
  return `
    ${saved ? savedCard(saved) : ''}
    <section class="start-hero">
      <h2 class="hero-title">Ready to train?</h2>
      <p class="hero-sub">${last ? `Last workout: ${esc(last.name)} · ${fmtDate(last.start)}` : 'Pick a template or start an empty workout.'}</p>
      <button type="button" class="hero-btn" data-action="start-flow">Start Workout</button>
    </section>

    <div class="section-row">
      <div class="section-title">Templates</div>
      <button type="button" class="link small" data-action="new-template">＋ New template</button>
    </div>
    ${state.templates.length
      ? `<div class="card">${state.templates.map((t) => templateRow(t, true)).join('')}</div>`
      : `<div class="card card-pad empty-tpl">
          <div>No templates yet. Save your usual sessions as templates to start them in two taps.</div>
          <button type="button" class="btn secondary small" data-action="new-template">Create a Template</button>
        </div>`}

    ${recent.length ? `
      <div class="section-title">Repeat a recent workout</div>
      <div class="card">${recent.map(recentRow).join('')}</div>` : ''}
  `;
}

/* ---------- Choosing and reviewing ---------- */

function openStartChooser() {
  if (state.active) { showActiveWorkout(); return; }
  ui.review = null;
  const recent = state.workouts.slice(0, 3);
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">Cancel</button>
      <h2>Start a Workout</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body chooser">
      ${(() => {
        const today = todaysPlannedSessions();
        if (!today.length) return '';
        return `<div class="section-title" style="margin-top:4px">From your plan</div>
          <div class="card">${today.map(({ plan, session: s }) => `
            <div class="tpl-row">
              <button type="button" class="tpl-main" data-action="review" data-kind="planned" data-id="${esc(`${plan.id}|${s.key}`)}">
                <span class="tpl-badge act-weights" aria-hidden="true">${esc(initials(s.title))}</span>
                <span class="grow"><span class="tpl-name truncate">Today: ${esc(s.title)}</span>
                  <span class="tpl-sub truncate">${esc(plan.name)} · Week ${esc(s.week)} · ${sportLengthText(s.targets) ? esc(sportLengthText(s.targets)) : plural(s.targets?.exercises?.length || 0, 'exercise')}</span></span>
                <span class="chev" aria-hidden="true">›</span>
              </button>
            </div>`).join('')}</div>`;
      })()}
      <div class="section-title"${todaysPlannedSessions().length ? '' : ' style="margin-top:4px"'}>From a template</div>
      ${state.templates.length
        ? `<div class="card">${state.templates.map((t) => templateRow(t, false)).join('')}</div>`
        : `<div class="card card-pad empty-tpl"><div>No templates yet.</div><button type="button" class="btn secondary small" data-action="new-template">Create a Template</button></div>`}
      ${recent.length ? `<div class="section-title">Repeat a recent workout</div><div class="card">${recent.map(recentRow).join('')}</div>` : ''}
      <div class="section-title">Or start from scratch</div>
      <button type="button" class="btn secondary" data-action="start-empty">Start Empty Workout</button>
      <p class="tpl-hint">Starts the workout clock now. Add exercises as you go.</p>
    </div>`);
}

/** Planned sets of an entry as short chips, e.g. "Warm-up 40×10", "3 × 80×5", "3 sets". */
function planChips(entry, isTemplate) {
  const ck = cardioKindOf(entry.exerciseId);
  const sets = isTemplate ? templateSets(entry) : (completedSets(entry).length ? completedSets(entry) : entry.sets);
  const runs = [];
  sets.forEach((s) => {
    const t = setType(s);
    const p = isTemplate ? plannedValues(s) : s;
    const text = p && (isTemplate || setHasValues(p)) ? setValueText(p, ck) : '';
    const last = runs[runs.length - 1];
    if (last && last.t === t && last.text === text) last.n++;
    else runs.push({ t, text, n: 1 });
  });
  return runs.map((r) => {
    const prefix = r.t === 'working' ? '' : `${r.t === 'warmup' ? 'Warm-up' : 'Drop'} `;
    const body = r.text ? `${r.n > 1 ? `${r.n} × ` : ''}${r.text}` : `${r.n} set${r.n === 1 ? '' : 's'}`;
    return `<span class="chip type-${r.t}">${esc(prefix + body)}</span>`;
  }).join('');
}

function openReview(kind, id) {
  if (state.active) { toast('A workout is already in progress'); showActiveWorkout(); return; }
  if (kind === 'planned') { openPlannedReview(id); return; }
  const isT = kind === 'template';
  const src = isT ? state.templates.find((t) => t.id === id) : state.workouts.find((w) => w.id === id);
  if (!src) { closeSheet(); render(); return; }
  ui.review = { kind, id };
  const letters = supersetLetters(src.entries);
  const setsTotal = src.entries.reduce((n, e) => n + (isT ? templateSets(e).length : (completedSets(e).length || e.sets.length)), 0);
  const n = src.entries.length;
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="start-flow">Back</button>
      <h2>Review</h2>
      ${isT ? `<button type="button" class="link" data-action="edit-template" data-id="${src.id}">Edit</button>` : '<span style="width:52px"></span>'}
    </div>
    <div class="sheet-body review">
      <div class="review-name">${esc(src.name)}</div>
      <div class="review-sub">${isT ? 'Template' : `Repeat of ${fmtDate(src.start)}`} · ${plural(n, 'exercise')} · ${plural(setsTotal, 'set')}</div>
      ${n ? `<div class="card review-list">
        ${src.entries.map((e, i) => `
          <div class="rv-ex${letters[i] ? ' superset' : ''}">
            <div class="rv-name"><span class="act-dot act-${entryType(e)}" aria-hidden="true"></span>${letters[i] ? `<span class="ss-badge">Superset ${letters[i]}</span>` : ''}${esc(exName(e.exerciseId))}</div>
            <div class="rv-chips">${planChips(e, isT)}</div>
            ${isT && e.note ? `<div class="rv-note">📝 ${esc(e.note)}</div>` : ''}
          </div>`).join('')}
      </div>` : '<div class="card card-pad" style="color:var(--muted)">No exercises yet. You can add them during the workout.</div>'}
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn begin-btn" data-action="begin">Begin Workout</button>
      <div class="foot-hint">The workout clock starts when you tap Begin.</div>
    </div>`);
}

/** Review of a planned session (id "planId|sessionKey") before Begin: its plan context and targets. */
function openPlannedReview(id) {
  const [planId, key] = String(id).split('|');
  const plan = findPlan(state, planId);
  const s = plan && sessionStatus(plan, key);
  if (!s) { toast('This session is no longer in your plan'); closeSheet(); render(); return; }
  ui.review = { kind: 'planned', id };
  const items = s.targets?.exercises || [];
  const sets = items.reduce((n, x) => n + x.sets, 0);
  const sport = s.targets?.run || s.targets?.swim || s.targets?.ride;
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">Cancel</button>
      <h2>Review</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body review">
      <div class="review-name">${esc(s.title)}</div>
      <div class="review-sub">${esc(plan.name)} · Week ${esc(s.week)} · ${esc(sessionDayText(s.date))}${sport ? '' : ` · ${plural(items.length, 'exercise')} · ${plural(sets, 'set')}`}</div>
      ${s.targets?.deload ? '<div class="plan-flag">Lighter week</div>' : ''}
      ${s.objective ? `<p class="plan-objective">${esc(s.objective)}</p>` : ''}
      ${s.status === 'completed' || s.status === 'skipped' ? `<div class="finish-note"><span aria-hidden="true">i</span><div>This session is marked ${esc(s.status)}. Logging it now links the new workout to it.</div></div>` : ''}
      ${sport ? sportDetailsHtml(s.targets) : `<div class="card review-list">
        ${items.map((x) => `
          <div class="rv-ex">
            <div class="rv-name"><span class="act-dot act-weights" aria-hidden="true"></span>${esc(x.exerciseId ? exName(x.exerciseId) : x.name)}</div>
            <div class="rv-chips"><span class="chip type-working">${x.sets} × ${x.min}–${x.max} reps</span></div>
          </div>`).join('')}
      </div>`}
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn begin-btn" data-action="begin">Begin Workout</button>
      <div class="foot-hint">The workout clock starts when you tap Begin.</div>
    </div>`);
}

/** Start the planned session in the logger (linked to the plan). */
function startPlannedSession(id) {
  if (state.active) { toast('A workout is already in progress'); showActiveWorkout(); return; }
  const [planId, key] = String(id).split('|');
  const plan = findPlan(state, planId);
  const s = plan && sessionStatus(plan, key);
  if (!s) { toast('This session is no longer in your plan'); closeSheet(); render(); return; }
  // Nothing in the plan changes until the workout is saved (see claimSession).
  state.active = plannedWorkout(plan, s);
  ui.savedId = null;
  ui.review = null;
  ui.wkScroll = 0;
  save();
  ui.tab = 'workout';
  closeSheet();
  guardTaps();
  render();
  window.scrollTo(0, 0);
}

/* ---------- Starting ---------- */

/**
 * Start a workout from nothing, from a template (sets carry its targets as plans),
 * or from a past workout to repeat (same exercises, set types and counts, empty values).
 * Never starts a second workout while one is in progress.
 */
function startWorkout(from) {
  if (state.active) { toast('A workout is already in progress'); showActiveWorkout(); return; }
  const isTemplate = !!from && state.templates.includes(from);
  // New objects only, so the workout never changes the template or workout it came from.
  const setsFor = (e) => {
    if (isTemplate) {
      return templateSets(e).map((p) => {
        const target = plannedValues(p);
        return { weight: '', reps: '', ...typeField(p), ...(target ? { target } : {}), done: false };
      });
    }
    const src = completedSets(e).length ? completedSets(e) : e.sets;
    return (src.length ? src : [{}]).map((p) => ({ weight: '', reps: '', ...typeField(p), done: false }));
  };
  state.active = {
    id: uid(),
    name: from ? from.name : defaultWorkoutName(),
    templateId: isTemplate ? from.id : null,
    start: new Date().toISOString(),
    notes: '',
    entries: from ? normalizeSupersets(from.entries.map((e) => ({ exerciseId: e.exerciseId, sets: setsFor(e), ...entryExtras(e, { keepNote: isTemplate }) }))) : []
  };
  ui.savedId = null;
  ui.review = null;
  ui.wkScroll = 0;
  save();
  ui.tab = 'workout';
  closeSheet();
  guardTaps();
  render();
  window.scrollTo(0, 0);
}

/* ---------- Live workout ---------- */

function renderActive(action) {
  const w = state.active;
  action.innerHTML = '';
  const letters = supersetLetters(w.entries);
  return `
    <div class="session-bar" id="session-bar">
      <div class="sb-top">
        <input id="workout-name" class="sb-name" value="${esc(w.name)}" aria-label="Workout name" autocomplete="off" enterkeyhint="done">
        <span class="sb-clock"><span class="live-dot" aria-hidden="true"></span><span id="elapsed" aria-label="Workout time">${fmtDuration(Date.now() - new Date(w.start))}</span></span>
        <button type="button" class="finish-btn" data-action="finish">Finish</button>
      </div>
      <div class="sb-progress" id="sb-progress">
        <span class="sb-count" id="sb-count"></span>
        <span class="sb-track" aria-hidden="true"><span id="sb-fill"></span></span>
      </div>
      <div class="sb-rest hidden" id="sb-rest" role="timer" aria-label="Rest timer">
        <span class="rest-label">Rest</span>
        <span class="rest-time" id="sb-rest-time"></span>
        <button type="button" data-action="rest-adjust" data-dir="-15" aria-label="15 seconds less">−15</button>
        <button type="button" data-action="rest-adjust" data-dir="15" aria-label="15 seconds more">+15</button>
        <button type="button" data-action="rest-skip">Skip</button>
      </div>
    </div>

    ${w.planned ? planBanner(w) : ''}

    ${w.entries.length
      ? w.entries.map((entry, i) => renderEntry(entry, i, letters)).join('')
      : `<div class="empty-session">
          <div class="es-title">Your workout has started</div>
          <div class="es-sub">Add your first exercise to start logging sets.</div>
        </div>`}

    <button type="button" class="add-ex-btn" data-action="add-exercise">＋ Add Exercise</button>

    <div class="section-title">Workout notes</div>
    <div class="card"><textarea class="notes" id="workout-notes" placeholder="How did it feel?">${esc(w.notes)}</textarea></div>

    <div class="session-foot">
      <button type="button" class="btn secondary small" data-action="save-active-template">Save as Template</button>
      <button type="button" class="btn danger small" data-action="discard">Discard Workout</button>
    </div>
  `;
}

function renderEntry(entry, i, letters = []) {
  const ck = cardioKindOf(entry.exerciseId);
  const last = lastEntryFor(entry.exerciseId);
  const lastSets = last ? completedSets(last) : [];
  const labels = setLabels(entry.sets);
  const ss = letters[i];
  const ssCont = ss && letters[i - 1] === ss;
  const ssNext = ss && letters[i + 1] === ss;
  const name = esc(exName(entry.exerciseId));
  return `
    <section class="ex-card${ss ? ' superset' : ''}${ssCont ? ' ss-cont' : ''}${ssNext ? ' ss-next' : ''}" data-entry="${i}" aria-label="${name}">
      <div class="ex-top">
        <div class="ex-title">
          ${ss ? `<span class="ss-badge">Superset ${ss}</span>` : ''}
          <h3 class="ex-name"><span class="act-dot act-${entryType(entry)}" aria-hidden="true"></span>${name}</h3>
        </div>
        <span class="ex-status"></span>
        <button type="button" class="ex-more" data-action="entry-menu" data-entry="${i}" aria-label="Options for ${name}">•••</button>
      </div>
      ${entry.note !== undefined ? `<div class="ex-note-row"><input class="ex-note-input" data-note="active" data-entry="${i}" value="${esc(entry.note)}" placeholder="Exercise note, e.g. seat 4, grip width" aria-label="Note for ${name}"></div>` : ''}
      ${last?.note ? `<div class="ex-hint">Last note: “${esc(last.note)}”</div>` : ''}
      ${entry.planned ? `<div class="ex-target"><span class="rec-k">Target</span><span>${entry.planned.sets} × ${entry.planned.min}–${entry.planned.max} reps${entry.swappedFrom != null ? ` · <span class="swap-note">instead of ${esc(exName(entry.swappedFrom))}</span>` : ''}</span></div>` : ''}
      ${ck ? '' : `<div class="prog-wrap" data-prog="${i}">${liveProgression(i)}</div>`}
      <div class="set-grid${ck ? ' cardio' : ''}">
        <div class="set-head" aria-hidden="true">
          <span>Set</span><span>Previous</span>
          ${ck ? `<span>${esc(distanceUnit(ck))}</span><span>Time</span>` : `<span>${esc(unit())}</span><span>Reps</span>`}
          <span>✓</span>
        </div>
        ${entry.sets.map((s, j) => setRow(i, s, j, labels[j], ck, lastSets)).join('')}
      </div>
      ${ck ? '<div class="ex-hint">Time in minutes (25) or mm:ss (25:30). Leave blank what you didn\'t measure.</div>' : ''}
      <div class="ex-foot">
        <button type="button" class="ex-add-set" data-action="add-set" data-entry="${i}">＋ Add set</button>
        ${entry.sets.length > 1 ? `<button type="button" class="ex-remove-set" data-action="remove-set" data-entry="${i}">Remove last</button>` : ''}
      </div>
    </section>`;
}

/** Plan context shown above the exercises of a planned workout. */
function planBanner(w) {
  const p = w.planned;
  if (p.kind === 'swim' || p.kind === 'ride') {
    const lines = p.kind === 'swim' ? (p.swim ? swimPartsText(p.swim) : []) : (p.ride ? ridePartsText(p.ride) : []);
    const effort = (p.swim || p.ride)?.effort || '';
    return `<div class="plan-banner sport-${p.kind}">
      <div class="plan-banner-top"><span class="sport-tag sport-${p.kind}">${p.kind === 'swim' ? 'Swim' : 'Ride'}</span><span class="truncate">${esc(p.planName)}${p.week ? ` · Week ${esc(p.week)}` : ''}</span></div>
      ${lines.length ? `<ol class="run-parts compact">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol><div class="plan-banner-sub">${esc(effort)}</div>` : ''}
      <div class="plan-banner-sub">${p.kind === 'swim' ? 'Log the swim as one set: total distance and time (rests included).' : 'Log the ride as one set: time, and distance if you have it.'}</div>
    </div>`;
  }
  if (p.kind === 'run') {
    return `<div class="plan-banner">
      <div class="plan-banner-top"><span class="plan-tag">Plan</span><span class="truncate">${esc(p.planName)}${p.week ? ` · Week ${esc(p.week)}` : ''}</span></div>
      ${p.run ? `<ol class="run-parts compact">${runPartsText(p.run).map((l) => `<li>${esc(l)}</li>`).join('')}</ol><div class="plan-banner-sub">${esc(p.run.effort || '')}</div>` : ''}
      <div class="plan-banner-sub">Log the whole run as one set: total distance and time.</div>
    </div>`;
  }
  return `<div class="plan-banner">
    <div class="plan-banner-top"><span class="plan-tag">Plan</span><span class="truncate">${esc(p.planName)}${p.week ? ` · Week ${esc(p.week)}` : ''}</span></div>
    ${p.deload ? '<div class="plan-banner-sub">Lighter week: fewer sets, about 10% less weight.</div>' : '<div class="plan-banner-sub">Work in each exercise\'s target range; the recommendation uses it.</div>'}
  </div>`;
}

/**
 * Progression panel for a strength exercise in the live workout (rules in calc.js):
 * last session's working sets; once working sets are ticked, today's trend vs last time;
 * and the recommendation — from last session until working sets are ticked, then from
 * today's ticked working sets ("based on today so far"). Display only, plus "Use" which
 * fills empty weights of unticked working sets in this exercise.
 */
function liveProgression(i) {
  const w = state.active, e = w?.entries[i];
  if (!e || cardioKindOf(e.exerciseId)) return '';
  const id = e.exerciseId;
  const prev = previousWorkingSession(state.workouts, w, id);
  const today = progressionSets(w, id);
  const lastLine = prev
    ? `<div class="prog-last"><span class="rec-k">Last</span><span>${esc(shortDay(prev.workout.start))}: ${esc(prev.sets.map(shortSet).join(', '))}</span></div>`
    : '<div class="prog-last muted">No previous session with working sets</div>';
  const trend = today.length && prev ? trendHtml(strengthTrend(today, prev.sets), `today vs ${shortDay(prev.workout.start)}`) : '';
  // A program's rep range for this exercise applies to both (the target is for today's session).
  const range = repRange(e.planned);
  const advice = today.length ? progressionAdvice(today, weightStep(), range) : prev ? progressionAdvice(prev.sets, weightStep(), range) : null;
  const basis = `${today.length ? 'based on today so far' : prev ? `based on ${shortDay(prev.workout.start)}` : ''}${advice && !isDefaultRange(range) ? ` · target ${rangeText(range)}` : ''}`;
  const kg = advice ? (advice.action === 'keep' ? advice.load : advice.next) : null;
  const fillable = kg != null && e.sets.some((s) => setType(s) === 'working' && !s.done && (s.weight === '' || s.weight == null));
  const use = fillable ? `<button type="button" class="rec-use" data-action="use-weight" data-entry="${i}" data-kg="${kg}">Use ${esc(loadText(kg))}</button>` : '';
  return `<div class="prog">${lastLine}${trend}${adviceHtml(advice, 'Next', basis, use)}</div>`;
}

/** Re-render progression panels whose content changed (after ticks and typing). */
function refreshProgression() {
  if (!state.active) return;
  document.querySelectorAll('#view .prog-wrap').forEach((el) => {
    const html = liveProgression(+el.dataset.prog);
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  });
}

/** One set row: label (opens the set menu), previous, two inputs, ✓. */
function setRow(i, s, j, label, ck, lastSets) {
  const plan = s.target;
  const src = plan || lastSets[j];
  const t = setType(s);
  const setName = t === 'working' ? `Set ${label}` : SET_TYPE_INFO[t].label;
  const ids = `data-entry="${i}" data-set="${j}"`;
  const cls = `set-input${plan ? ' planned' : ''}`;
  const prev = lastSets[j];
  return `
    <div class="set-row type-${t}" ${ids}>
      <button type="button" class="set-label ${t}" data-action="set-menu" data-ctx="active" ${ids} aria-label="${setName}: change type, move or delete">${label}</button>
      <span class="prev" title="Last time">${prev ? esc(prevText(prev, ck)).replace('×', '×<wbr>') : '–'}</span>
      ${ck ? `
      <input class="${cls}" inputmode="decimal" autocomplete="off" data-field="distance" data-kind="${ck}" ${ids} value="${esc(inputDistance(num(s.distance), ck))}" placeholder="${plan && num(plan.distance) != null ? esc(inputDistance(num(plan.distance), ck)) : '–'}" aria-label="${setName} distance (${esc(distanceUnit(ck))})">
      <input class="${cls}" inputmode="decimal" autocomplete="off" data-field="duration" ${ids} value="${esc(inputClock(s.duration))}" placeholder="${plan && num(plan.duration) != null ? esc(inputClock(plan.duration)) : 'min'}" aria-label="${setName} time, minutes or mm:ss">` : `
      <input class="${cls}" inputmode="decimal" autocomplete="off" data-field="weight" ${ids} value="${esc(inputWeight(num(s.weight)))}" placeholder="${esc(inputWeight(num(src?.weight)))}" aria-label="${setName} weight (${esc(unit())})${plan && num(plan.weight) != null ? `, planned ${esc(inputWeight(num(plan.weight)))}` : ''}">
      <input class="${cls}" inputmode="numeric" autocomplete="off" data-field="reps" ${ids} value="${esc(s.reps ?? '')}" placeholder="${num(src?.reps) ?? ''}" aria-label="${setName} reps${plan && num(plan.reps) != null ? `, planned ${num(plan.reps)}` : ''}">`}
      <button type="button" class="set-check" data-action="toggle-set" ${ids} aria-pressed="false" aria-label="${setName} done">
        <span class="box"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
      </button>
    </div>`;
}

/**
 * Bring the screen in line with state.active: done rows, ✓ buttons, the next set,
 * the current and completed exercises, and the session progress.
 */
function syncWorkoutStatus() {
  const w = state.active;
  const view = $('#view');
  if (!w || !view) return;
  const next = nextSetPosition(w.entries);
  w.entries.forEach((e, i) => {
    const card = view.querySelector(`.ex-card[data-entry="${i}"]`);
    if (!card) return;
    const d = e.sets.filter((s) => s.done).length;
    const complete = e.sets.length > 0 && d === e.sets.length;
    card.classList.toggle('complete', complete);
    card.classList.toggle('current', next?.i === i);
    const status = card.querySelector('.ex-status');
    if (status) status.textContent = complete ? '✓ Done' : `${d}/${e.sets.length}`;
    e.sets.forEach((s, j) => {
      const row = card.querySelector(`.set-row[data-set="${j}"]`);
      if (!row) return;
      row.classList.toggle('done', !!s.done);
      row.classList.toggle('next', next?.i === i && next?.j === j);
      row.querySelector('.set-check')?.setAttribute('aria-pressed', String(!!s.done));
    });
  });
  const c = sessionCounts(w);
  const count = $('#sb-count');
  if (count) count.textContent = c.total ? `${c.done} of ${c.total} sets done` : 'No sets yet';
  const fill = $('#sb-fill');
  if (fill) fill.style.width = `${c.total ? Math.round((c.done / c.total) * 100) : 0}%`;
  updateRestUI();
  refreshProgression();
}

/** Tick or untick one set. */
function toggleSet(ei, si) {
  const entry = state.active?.entries[ei];
  const set = entry?.sets[si];
  if (!set) return;
  set.done = !set.done;
  if (set.done && fillFromSuggestion(entry, si)) {
    // Show the values that were filled in from the placeholders.
    const row = document.querySelector(`#view .set-row[data-entry="${ei}"][data-set="${si}"]`);
    const wIn = row?.querySelector('[data-field="weight"]');
    const rIn = row?.querySelector('[data-field="reps"]');
    if (wIn) wIn.value = inputWeight(num(set.weight));
    if (rIn) rIn.value = set.reps ?? '';
  }
  save();
  syncWorkoutStatus();
  // In a superset, rest only after the round's last exercise.
  if (set.done) { haptic(); if (isLastInSuperset(state.active.entries, ei)) startRest(); }
}

function addExerciseToWorkout(exerciseId) {
  if (!state.active) { closeSheet(); render(); return; }
  const last = lastEntryFor(exerciseId);
  const count = last ? completedSets(last).length : 3;
  state.active.entries.push({ exerciseId, sets: Array.from({ length: Math.max(1, count) }, () => ({ weight: '', reps: '', done: false })) });
  save();
  closeSheet();
  render();
  const cards = document.querySelectorAll('#view .ex-card');
  if (cards.length) scrollBelowBar(cards[cards.length - 1]);
}

/** Scroll so an element sits just below the sticky session bar. */
function scrollBelowBar(el) {
  const bar = $('#session-bar');
  const offset = (bar ? bar.getBoundingClientRect().height : 0) + 10;
  window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset));
}

/** Is there anything in this set worth asking about before deleting it? */
const setMatters = (s) => !!s && (s.done || setHasValues(s));

function confirmRemoveSet(s) {
  return !setMatters(s) || confirm(`Remove this set? ${s.done ? 'It is ticked as done' : 'It has values entered'}.`);
}

function openEntryMenu(ei) {
  const entries = state.active.entries;
  const e = entries[ei];
  if (!e) return;
  openSheet(`
    <div class="sheet-head"><span style="width:52px"></span><h2>${esc(exName(e.exerciseId))}</h2><button type="button" class="link" data-action="close-sheet">Cancel</button></div>
    <div class="sheet-body"><div class="card">
      ${e.planned ? `<button type="button" class="list-item" data-action="swap-exercise" data-entry="${ei}">Swap exercise${e.swappedFrom != null ? ` (planned: ${esc(exName(e.swappedFrom))})` : ''}</button>` : ''}
      ${e.note === undefined ? `<button type="button" class="list-item" data-action="entry-note" data-entry="${ei}">Add exercise note</button>` : ''}
      ${ei < entries.length - 1 && (!e.superset || entries[ei + 1].superset !== e.superset) ? `<button type="button" class="list-item" data-action="entry-link" data-entry="${ei}">Superset with ${esc(exName(entries[ei + 1].exerciseId))}</button>` : ''}
      ${e.superset ? `<button type="button" class="list-item" data-action="entry-unlink" data-entry="${ei}">Remove from superset</button>` : ''}
      ${ei > 0 ? `<button type="button" class="list-item" data-action="move-entry" data-entry="${ei}" data-dir="-1">Move up</button>` : ''}
      ${ei < entries.length - 1 ? `<button type="button" class="list-item" data-action="move-entry" data-entry="${ei}" data-dir="1">Move down</button>` : ''}
      <button type="button" class="list-item" data-action="remove-entry" data-entry="${ei}" style="color:var(--danger)">Remove exercise</button>
    </div></div>`);
}

/**
 * Replace a planned exercise with another for this workout only. The entry keeps its
 * target and records the planned exercise (swappedFrom); the plan and templates are not
 * changed. Sets already entered are cleared (after confirmation), keeping their number.
 */
function swapExercise(ei, exerciseId) {
  const e = state.active?.entries[ei];
  if (!e || !e.planned) { closeSheet(); render(); return; }
  if (exerciseId === e.exerciseId) { closeSheet(); return; }
  const n = e.sets.filter(setMatters).length;
  if (n && !confirm(`Swap to ${exName(exerciseId)}? The ${plural(n, 'set')} entered for ${exName(e.exerciseId)} will be cleared.`)) return;
  const original = e.swappedFrom ?? e.exerciseId;
  e.exerciseId = exerciseId;
  if (exerciseId === original) delete e.swappedFrom; else e.swappedFrom = original;
  e.sets = e.sets.map((s) => ({ weight: '', reps: '', ...typeField(s), done: false }));
  ui.swapEntry = null;
  save();
  closeSheet();
  render();
  toast(exerciseId === original ? `Back to ${exName(exerciseId)}` : `Swapped to ${exName(exerciseId)} for this workout`);
}

/** Planned vs actual block (Finish summary and History). */
function plannedVsActualHtml(w) {
  const pva = plannedVsActual(w);
  if (!pva) return '';
  if (pva.sport) {
    const st = { done: 'Done', partial: 'Partly done', skipped: 'Not done' }[pva.status];
    const swim = pva.sport === 'swim';
    const dist = (m) => (swim ? fmtDistance(m, 'swim') : runKmText(m / 1000));
    const main = swim
      ? `Distance ${pva.doneM ? esc(dist(pva.doneM)) : '–'} of ${esc(dist(pva.plannedM))}`
      : `Time ${pva.doneSec ? esc(rideTime(pva.doneSec / 60)) : '–'} of ${esc(rideTime((pva.plannedSec || 0) / 60))}`;
    const sub = swim
      ? `${pva.doneSec ? `Time ${fmtClock(pva.doneSec)}` : 'No time logged'}${pva.plannedSec ? ` · planned about ${Math.round(pva.plannedSec / 60)} min` : ''}${pva.pace100 ? ` · ${fmtClock(pva.pace100 * (isImperial() ? 0.9144 : 1))} per 100 ${isImperial() ? 'yd' : 'm'} including rests` : ''}`
      : `${pva.doneM ? `Distance ${esc(runKmText(pva.doneM / 1000))}` : 'No distance logged'}${pva.plannedM ? ` · planned about ${esc(runKmText(pva.plannedM / 1000))} (terrain varies)` : ''}${pva.speed ? ` · average ${esc(fmtNum(pva.speed * (isImperial() ? 1 / 1.609344 : 1)))} ${isImperial() ? 'mph' : 'km/h'}` : ''}`;
    return `
    <div class="section-title">Planned vs actual</div>
    <div class="card card-pad pva">
      <div class="pva-head">${esc(w.planned.title)}${w.planned.week ? ` · Week ${esc(w.planned.week)}` : ''}</div>
      <div class="pva-row pva-${pva.status}">
        <span class="pva-ic" aria-hidden="true">${{ done: '✓', partial: '◐', skipped: '–' }[pva.status]}</span>
        <span class="grow"><span class="pva-name">${main}</span><span class="pva-sub">${sub}</span></span>
        <span class="pva-status">${st}</span>
      </div>
      ${pva.others.length ? `<div class="pva-sub" style="margin-top:6px">Also logged: ${esc(pva.others.map(exName).join(', '))}</div>` : ''}
    </div>`;
  }
  if (pva.run) {
    const st = { done: 'Done', partial: 'Partly done', skipped: 'Not done' }[pva.status];
    const paceTxt = pva.pace ? `${fmtClock(pva.pace * (isImperial() ? M_PER_MI / 1000 : 1))} ${isImperial() ? '/mi' : '/km'}` : null;
    return `
    <div class="section-title">Planned vs actual</div>
    <div class="card card-pad pva">
      <div class="pva-head">${esc(w.planned.title)}${w.planned.week ? ` · Week ${esc(w.planned.week)}` : ''}</div>
      <div class="pva-row pva-${pva.status}">
        <span class="pva-ic" aria-hidden="true">${{ done: '✓', partial: '◐', skipped: '–' }[pva.status]}</span>
        <span class="grow"><span class="pva-name">Distance ${pva.doneM ? esc(runKmText(pva.doneM / 1000)) : '–'} of ${esc(runKmText(pva.plannedM / 1000))}</span>
          <span class="pva-sub">${pva.doneSec ? `Time ${fmtClock(pva.doneSec)}` : 'No time logged'}${pva.plannedSec ? ` · planned about ${Math.round(pva.plannedSec / 60)} min` : ''}${paceTxt ? ` · pace ${paceTxt}` : ''}</span></span>
        <span class="pva-status">${st}</span>
      </div>
      ${pva.paceCheck ? `<div class="pva-row"><span class="pva-ic" aria-hidden="true">${pva.paceCheck === 'in range' ? '✓' : '!'}</span><span class="grow"><span class="pva-name">Pace ${pva.paceCheck === 'in range' ? 'in the easy range' : pva.paceCheck === 'faster' ? 'faster than the easy range' : 'slower than the easy range'}</span><span class="pva-sub">Planned ${esc(paceRangeText([pva.paceLo, pva.paceHi]))}${pva.paceCheck === 'faster' ? '. Easy runs work best when they are truly easy.' : ''}</span></span></div>` : ''}
      ${!pva.paceCheck && pva.type !== 'easy' && pva.type !== 'long' && pva.doneM ? '<div class="pva-sub" style="margin-top:6px">The pace of the hard parts can\'t be checked from one total; compare with the plan by feel.</div>' : ''}
      ${pva.others.length ? `<div class="pva-sub" style="margin-top:6px">Also logged: ${esc(pva.others.map(exName).join(', '))}</div>` : ''}
    </div>`;
  }
  const icon = { done: '✓', partial: '◐', skipped: '–', added: '+' };
  const statusText = { done: 'Done', partial: 'Partly done', skipped: 'Not done', added: 'Added' };
  return `
    <div class="section-title">Planned vs actual</div>
    <div class="card card-pad pva">
      <div class="pva-head">${esc(w.planned.title)}${w.planned.week ? ` · Week ${esc(w.planned.week)}` : ''} · ${pva.doneSets} of ${plural(pva.plannedSets, 'planned set')}${pva.swaps ? ` · ${plural(pva.swaps, 'swap')}` : ''}</div>
      ${pva.rows.map((r) => {
        const name = r.status === 'added' ? exName(r.actualId) : r.swapped ? exName(r.actualId) : exName(r.exerciseId);
        const range = r.status === 'added' ? '' : `${r.min}–${r.max} reps`;
        const reps = r.reps.length ? `reps ${r.reps.join(', ')}` : '';
        const inRange = r.inRange == null ? '' : r.inRange ? ' · in range' : ' · outside range';
        return `<div class="pva-row pva-${r.status}">
          <span class="pva-ic" aria-hidden="true">${icon[r.status]}</span>
          <span class="grow"><span class="pva-name">${esc(name)}</span>${r.swapped ? `<span class="swap-note"> instead of ${esc(exName(r.exerciseId))}</span>` : ''}
            <span class="pva-sub">${r.status === 'added' ? `${plural(r.done, 'set')} · not in the plan` : `${Math.min(r.done, r.plannedSets)}/${r.plannedSets} sets${r.done > r.plannedSets ? ` (+${r.done - r.plannedSets})` : ''} · target ${range}${reps ? ` · ${reps}` : ''}${inRange}`}</span></span>
          <span class="pva-status">${statusText[r.status]}</span>
        </div>`;
      }).join('')}
    </div>`;
}

/* ---------- Finishing and discarding ---------- */

/**
 * The workout as it would be saved: a copy of state.active (the live workout is never
 * changed here), with ticked sets filled from their placeholders, and only valid ticked
 * sets kept. markPending also counts unticked sets that have values as done.
 */
function preparedWorkout(markPending) {
  const w = JSON.parse(JSON.stringify(state.active));
  w.entries.forEach((entry) => {
    const lastSets = lastSetsFor(entry.exerciseId);
    entry.sets.forEach((s, j) => {
      if (!s.done && markPending && setHasValues(s)) s.done = true;
      if (s.done) fillFromSuggestion(entry, j, lastSets);
    });
    entry.sets = entry.sets.filter(isValidSet);
    if (typeof entry.note === 'string') { entry.note = entry.note.trim(); if (!entry.note) delete entry.note; }
  });
  w.entries = normalizeSupersets(w.entries.filter((e) => e.sets.length));
  return w;
}

function openFinishSheet() {
  const w = state.active;
  if (!w) return;
  const c = sessionCounts(w);
  const toSave = preparedWorkout(false);
  const saveSets = workoutSetCount(toSave);
  const tickedEmpty = c.done - saveSets;
  const untickedEmpty = c.total - c.done - c.pendingValues;
  const notes = [];
  if (c.pendingValues) notes.push(`<div class="finish-note warn"><span aria-hidden="true">!</span><div><b>${plural(c.pendingValues, 'set')} ${c.pendingValues === 1 ? 'has' : 'have'} values but ${c.pendingValues === 1 ? 'isn\'t' : 'aren\'t'} ticked.</b> ${saveSets ? `${c.pendingValues === 1 ? 'It is' : 'They are'} left out unless you tick ${c.pendingValues === 1 ? 'it' : 'them'}.` : ''}</div></div>`);
  if (tickedEmpty > 0) notes.push(`<div class="finish-note"><span aria-hidden="true">i</span><div>${plural(tickedEmpty, 'ticked set')} without any values ${tickedEmpty === 1 ? 'is' : 'are'} left out.</div></div>`);
  if (untickedEmpty > 0) notes.push(`<div class="finish-note"><span aria-hidden="true">i</span><div>${plural(untickedEmpty, 'empty set')} not done ${untickedEmpty === 1 ? 'is' : 'are'} left out.</div></div>`);
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">Back</button>
      <h2>Finish Workout</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body finish">
      <div class="review-name">${esc(w.name || 'Workout')}</div>
      <div class="stats" style="margin-top:12px">
        <div class="stat"><div class="num">${fmtDuration(Date.now() - new Date(w.start))}</div><div class="lbl">Duration</div></div>
        <div class="stat"><div class="num">${saveSets}</div><div class="lbl">Sets to save</div></div>
        <div class="stat"><div class="num">${fmtWeight(workoutVolume(toSave))}</div><div class="lbl">Volume (${esc(unit())})</div></div>
      </div>
      ${saveSets ? '' : `<div class="finish-note warn"><span aria-hidden="true">!</span><div><b>No sets are ticked yet</b>, so there's nothing to save.</div></div>`}
      ${notes.join('')}
      ${w.planned && saveSets ? plannedVsActualHtml(toSave) : ''}
    </div>
    <div class="sheet-foot">
      ${saveSets ? '<button type="button" class="btn save-btn" data-action="save-workout">Save Workout</button>' : ''}
      ${c.pendingValues ? `<button type="button" class="btn ${saveSets ? 'secondary' : 'save-btn'}" data-action="save-workout" data-include="1">Tick ${plural(c.pendingValues, 'set')} with values &amp; Save</button>` : ''}
      <button type="button" class="btn secondary" data-action="close-sheet">Keep Training</button>
      ${!saveSets && !c.pendingValues ? '<button type="button" class="btn danger" data-action="discard">Discard Workout</button>' : ''}
    </div>`);
}

function saveActiveWorkout(markPending) {
  if (!state.active) { closeSheet(); render(); return; }
  const w = preparedWorkout(markPending);
  if (!w.entries.length) { toast('Tick at least one set first'); return; }
  w.end = new Date().toISOString();
  if (w.plan) claimSession(state, w); // this workout now completes its planned session
  if (!state.workouts.some((x) => x.id === w.id)) {
    state.workouts.unshift(w);
    state.workouts.sort((a, b) => new Date(b.start) - new Date(a.start));
  }
  state.active = null;
  ui.savedId = w.id;
  ui.wkScroll = 0;
  stopRest();
  save();
  closeSheet();
  guardTaps();
  render();
  window.scrollTo(0, 0);
  toast(`Workout saved · ${workoutSetCount(w)} sets 💪`);
}

function discardActiveWorkout() {
  const w = state.active;
  if (!w) return;
  const c = sessionCounts(w);
  const msg = c.done || c.pendingValues
    ? `Discard this workout? ${c.done ? `${plural(c.done, 'ticked set')} and ` : ''}everything you entered will be deleted. This can't be undone.`
    : 'Discard this workout? Nothing has been logged yet.';
  if (!confirm(msg)) return;
  state.active = null;
  ui.wkScroll = 0;
  stopRest();
  save();
  closeSheet();
  guardTaps();
  render();
  window.scrollTo(0, 0);
  toast('Workout discarded');
}

/* ---------- Rest timer ---------- */

let restInterval = null;

function startRest(seconds = state.settings.rest) {
  if (!seconds) return;
  ui.restEnd = Date.now() + seconds * 1000;
  clearInterval(restInterval);
  restInterval = setInterval(tickRest, 250);
  tickRest();
}

function tickRest() {
  if (!ui.restEnd) { stopRest(); return; }
  if (ui.restEnd - Date.now() <= 0) {
    stopRest();
    haptic();
    toast('Rest over. Next set! 🔔');
    return;
  }
  updateRestUI();
}

function stopRest() {
  clearInterval(restInterval);
  restInterval = null;
  ui.restEnd = null;
  updateRestUI();
}

const restLeftText = () => fmtDuration(Math.max(0, ui.restEnd - Date.now()) + 999);

/** Rest timer lives in the session bar (never floating over the sets); the live bar shows it on other tabs. */
function updateRestUI() {
  const box = $('#sb-rest');
  if (box) {
    box.classList.toggle('hidden', !ui.restEnd);
    $('#sb-progress')?.classList.toggle('hidden', !!ui.restEnd);
    if (ui.restEnd) $('#sb-rest-time').textContent = restLeftText();
  }
  updateLiveBar();
}

/* ---------- "Workout in progress" bar on other tabs ---------- */

function updateLiveBar() {
  const bar = $('#live-bar');
  if (!bar) return;
  const show = !!state.active && ui.tab !== 'workout' && ui.tab !== 'home'; // Home shows its own card
  bar.classList.toggle('hidden', !show);
  document.body.classList.toggle('has-live-bar', show);
  if (!show) return;
  $('#lb-name').textContent = state.active.name || 'Workout';
  $('#lb-time').textContent = fmtDuration(Date.now() - new Date(state.active.start)) + (ui.restEnd ? ` · Rest ${restLeftText()}` : '');
}

// Keep the workout clock ticking.
setInterval(() => {
  if (!state.active) return;
  const el = $('#elapsed') || $('#home-elapsed');
  if (el) el.textContent = fmtDuration(Date.now() - new Date(state.active.start));
  updateLiveBar();
}, 1000);

/* ---------- Events (called from the single click/input handlers in app.js) ---------- */

/** Actions that only make sense while a workout is in progress. */
const LIVE_ACTIONS = new Set(['finish', 'save-workout', 'discard', 'add-exercise', 'toggle-set', 'add-set', 'remove-set', 'entry-menu', 'move-entry', 'remove-entry', 'entry-note', 'entry-link', 'entry-unlink', 'rest-adjust', 'use-weight', 'swap-exercise']);

/** Handle a Workout-tab action. Returns true if it was one. */
function handleWorkoutAction(action, el, ei, si) {
  if (LIVE_ACTIONS.has(action) && !state.active) { closeSheet(); render(); return true; }
  switch (action) {
    case 'start-flow': openStartChooser(); break;
    case 'review': openReview(el.dataset.kind, el.dataset.id); break;
    case 'swap-exercise': ui.swapEntry = ei; openExercisePicker('swap'); setTimeout(() => $('#exercise-search')?.focus(), 300); break;
    case 'repeat': openReview('repeat', el.dataset.id); break;
    case 'begin': {
      const r = ui.review;
      if (r?.kind === 'planned') { startPlannedSession(r.id); break; }
      const src = r && (r.kind === 'template' ? state.templates.find((t) => t.id === r.id) : state.workouts.find((w) => w.id === r.id));
      if (src) startWorkout(src); else { closeSheet(); render(); }
      break;
    }
    case 'start-empty': startWorkout(); break;
    case 'continue-workout': showActiveWorkout(); break;
    case 'dismiss-saved': ui.savedId = null; render(); break;
    case 'finish': openFinishSheet(); break;
    case 'save-workout': saveActiveWorkout(el.dataset.include === '1'); break;
    case 'discard': discardActiveWorkout(); break;
    case 'add-exercise': openExercisePicker('pick'); setTimeout(() => $('#exercise-search')?.focus(), 300); break;
    case 'toggle-set': toggleSet(ei, si); break;
    case 'add-set': {
      const sets = state.active.entries[ei]?.sets;
      if (!sets) break;
      const prev = sets[sets.length - 1];
      sets.push({ weight: prev?.weight ?? '', reps: prev?.reps ?? '', ...(prev && setType(prev) === 'drop' ? { type: 'drop' } : {}), done: false });
      save(); render();
      break;
    }
    case 'remove-set': {
      const sets = state.active.entries[ei]?.sets;
      if (!sets || sets.length < 2 || !confirmRemoveSet(sets[sets.length - 1])) break;
      sets.pop(); save(); render();
      break;
    }
    case 'entry-menu': openEntryMenu(ei); break;
    case 'move-entry': {
      const entries = state.active.entries, to = ei + +el.dataset.dir;
      if (!entries[ei] || !entries[to]) break;
      [entries[ei], entries[to]] = [entries[to], entries[ei]];
      normalizeSupersets(entries);
      save(); closeSheet(); render();
      break;
    }
    case 'remove-entry': {
      const e = state.active.entries[ei];
      if (!e) break;
      if (e.sets.some(setMatters) && !confirm(`Remove ${exName(e.exerciseId)} and its logged sets from this workout?`)) break;
      state.active.entries.splice(ei, 1);
      normalizeSupersets(state.active.entries);
      save(); closeSheet(); render();
      break;
    }
    case 'entry-note':
      state.active.entries[ei].note = '';
      save(); closeSheet(); render();
      setTimeout(() => $(`.ex-note-input[data-note="active"][data-entry="${ei}"]`)?.focus(), 50);
      break;
    case 'entry-link': linkWithNext(state.active.entries, ei); save(); closeSheet(); render(); break;
    case 'entry-unlink': unlinkSuperset(state.active.entries, ei); save(); closeSheet(); render(); break;
    case 'rest-adjust': if (ui.restEnd) { ui.restEnd += +el.dataset.dir * 1000; tickRest(); } break;
    case 'rest-skip': stopRest(); break;
    case 'use-weight': {
      // Fill only empty weights of unticked working sets; never overwrite or tick anything.
      const e = state.active.entries[ei], kg = Number(el.dataset.kg);
      if (!e || !(kg > 0)) break;
      let n = 0;
      e.sets.forEach((s, j) => {
        if (setType(s) !== 'working' || s.done || (s.weight !== '' && s.weight != null)) return;
        s.weight = kg; n++;
        const input = document.querySelector(`#view [data-field="weight"][data-entry="${ei}"][data-set="${j}"]`);
        if (input) input.value = inputWeight(kg);
      });
      save();
      refreshProgression();
      toast(n ? `${loadText(kg)} filled in ${n} set${n === 1 ? '' : 's'}` : 'No empty working sets to fill');
      break;
    }
    default: return false;
  }
  return true;
}

/** Handle typing in the live workout. Returns true if the input belonged to it. */
function handleWorkoutInput(t) {
  if (!state.active) return false;
  if (t.dataset.field) {
    const set = state.active.entries[+t.dataset.entry]?.sets[+t.dataset.set];
    if (!set) return true;
    const value = t.value.replace(',', '.');
    if (t.dataset.field === 'weight') {
      // Typed in the selected unit, stored in kg.
      const v = num(value);
      set.weight = v == null || v < 0 ? '' : toStoredWeight(v);
    } else if (t.dataset.field === 'distance' || t.dataset.field === 'duration') {
      setCardioField(set, t.dataset.field, t.value, t.dataset.kind);
    } else {
      set[t.dataset.field] = value;
    }
    save();
    refreshProgression(); // trend/recommendation follow edits; the "Use" button follows empty weights
    return true;
  }
  if (t.id === 'workout-name') { state.active.name = t.value; save(); return true; }
  if (t.id === 'workout-notes') { state.active.notes = t.value; save(); return true; }
  return false;
}

// Typing in a set field: select its value so a new number replaces it, and keep the
// field clear of the sticky session bar and the on-screen keyboard.
document.addEventListener('focusin', (ev) => {
  const t = ev.target;
  if (!t.matches?.('#view .set-input')) return;
  // Only if nothing has been typed yet, so fast typing is never selected away.
  const before = t.value;
  setTimeout(() => { if (document.activeElement === t && t.value === before) { try { t.select(); } catch (e) { /* not selectable */ } } }, 0);
  setTimeout(() => keepFieldVisible(t), 350);
});

function keepFieldVisible(el) {
  if (document.activeElement !== el) return;
  const vv = window.visualViewport;
  const r = el.getBoundingClientRect();
  const bar = $('#session-bar');
  const visibleTop = Math.max(vv ? vv.offsetTop : 0, bar ? bar.getBoundingClientRect().bottom : 0);
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  if (r.top < visibleTop + 4) window.scrollBy(0, r.top - visibleTop - 12);
  else if (r.bottom > visibleBottom - 8) window.scrollBy(0, r.bottom - visibleBottom + 16);
}
