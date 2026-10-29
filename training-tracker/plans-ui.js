'use strict';

/*
  Plans tab: the program library, setting up and reviewing a program, the running
  program (status, this week, full schedule, conflicts), one sheet per session (start,
  skip, move, mark done, view workout), stopping and deleting, and past plans.

  All rules live in plans.js and programs.js; this file only shows them and calls them.
  Loaded after programs.js and before app.js; runs only when called.
*/

const STATUS_LABEL = { completed: 'Done', 'in-progress': 'In progress', skipped: 'Skipped', cancelled: 'Cancelled', missed: 'Missed', today: 'Today', upcoming: 'Upcoming' };
const statusChip = (s) => `<span class="pstatus ps-${s.status}">${STATUS_LABEL[s.status]}${s.manual ? ' (marked)' : ''}</span>`;
/** The setup answers stored with a plan (not the screen's own fields). */
const setupAnswers = (a) => ({ days: [...a.days].sort((x, y) => x - y), weeks: a.weeks, deload: a.deload });
const planIdAttr = (plan, s) => `${plan.id}|${s.key}`;
/** "Mon, 9 Nov – Fri, 1 Jan 2027": the year is added when the range crosses into another year. */
const planDatesText = (a, b) => (a.slice(0, 4) === b.slice(0, 4) ? `${sessionDayText(a)} – ${sessionDayText(b)}` : `${sessionDayText(a)} ${a.slice(0, 4)} – ${sessionDayText(b)} ${b.slice(0, 4)}`);

/* ---------- Tab ---------- */

function renderPlans() {
  const today = todayKey();
  const running = runningPlans(state, today);
  const past = plansOf(state).filter((p) => !running.includes(p));
  const conflicts = planConflicts(state, today);
  const hasStrength = running.some((p) => planGroup(p.kind) === 'strength');
  return `
    ${conflicts.length ? `<div class="card card-pad plan-warn" role="note" style="margin-top:12px">
      <b>Sessions from two plans on the same day</b>
      ${conflicts.slice(0, 4).map((c) => `<div>${esc(sessionDayText(c.date))}: ${esc(c.sessions.map((x) => `${x.title} (${x.planName})`).join(' + '))}</div>`).join('')}
      ${conflicts.length > 4 ? `<div>…and ${conflicts.length - 4} more days</div>` : ''}
      <div class="sub">Move one of them from its session screen if that is too much for one day.</div>
    </div>` : ''}
    ${running.map((p) => planCard(p, today)).join('')}
    <div class="section-title">${hasStrength ? 'Strength programs' : 'Start a strength program'}</div>
    ${hasStrength ? '<p class="tpl-hint" style="margin-top:0">One strength program at a time. Stop the current one to start another.</p>' : ''}
    <div class="card">
      ${STRENGTH_PROGRAMS.map((p) => `
        <button type="button" class="list-item prog-lib" data-action="plan-setup" data-id="${p.id}"${hasStrength ? ' disabled' : ''}>
          <span class="grow"><span class="prog-lib-name">${esc(p.name)}</span>
            <span class="sub">${esc(p.level)} · ${p.daysPerWeek} days a week · ${p.weekOptions[0]}–${p.weekOptions[p.weekOptions.length - 1]} weeks</span>
            <span class="prog-lib-sum">${esc(p.summary)}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </button>`).join('')}
    </div>
    <p class="tpl-hint">Running, swimming, cycling and triathlon plans are coming in later updates.</p>
    ${past.length ? `<div class="section-title">Past plans</div>
      <div class="card">${past.map((p) => {
        const pr = planProgress(p, state, today);
        return `<button type="button" class="list-item" data-action="plan-open" data-id="${esc(p.id)}">
          <span class="grow"><span class="truncate" style="display:block;font-weight:600">${esc(p.name)}</span>
            <span class="sub">${esc(planDatesText(p.startDate, p.stoppedOn && p.stoppedOn < p.endDate ? p.stoppedOn : p.endDate))} · ${planPhase(p, today) === 'stopped' ? 'Stopped' : 'Finished'} · ${pr.completed} of ${plural(pr.total, 'session')} done</span></span>
          <span class="chev">›</span></button>`;
      }).join('')}</div>` : ''}`;
}

/** Summary line: "Week 2 of 8 · 4 of 5 sessions so far done". */
function planStatusText(plan, pr, today = todayKey()) {
  const phase = planPhase(plan, today);
  if (phase === 'upcoming') return `Starts ${sessionDayText(plan.startDate)} · ${plan.weeks.length} weeks`;
  if (phase === 'finished') return `Finished · ${pr.completed} of ${plural(pr.total, 'session')} done`;
  if (phase === 'stopped') return `Stopped ${sessionDayText(plan.stoppedOn || plan.endDate)}`;
  return `Week ${pr.week} of ${pr.weeks}`;
}

function planCard(plan, today) {
  const pr = planProgress(plan, state, today);
  const list = sessionStatuses(plan, state, today);
  const wkNo = Math.max(1, Math.min(pr.week || 1, plan.weeks.length));
  const week = plan.weeks[wkNo - 1];
  const keys = new Set(week.sessions.map((s) => s.key));
  const thisWeek = list.filter((s) => keys.has(s.key)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const pct = pr.total ? Math.round((pr.completed / pr.total) * 100) : 0;
  return `
    <section class="card card-pad plan-card" style="margin-top:12px" aria-label="${esc(plan.name)}">
      <div class="plan-card-top">
        <div class="grow"><div class="plan-name">${esc(plan.name)}</div><div class="sub">${esc(planStatusText(plan, pr, today))}${week.deload ? ' · Lighter week' : ''}</div></div>
        <button type="button" class="link small" data-action="plan-open" data-id="${esc(plan.id)}">Schedule</button>
      </div>
      <div class="plan-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="plan-counts">
        <span><b>${pr.completed}</b> done</span><span><b>${pr.missed}</b> missed</span><span><b>${pr.skipped}</b> skipped</span><span><b>${pr.total - pr.due}</b> to go</span>
      </div>
      ${planUpdateAvailable(plan) ? '<div class="sub" style="margin-top:6px">A newer version of this program exists. Your schedule stays as it was when you started.</div>' : ''}
      <div class="plan-week-title">${planPhase(plan, today) === 'upcoming' ? 'First week' : `Week ${wkNo}`}</div>
      <div class="plan-sessions">${thisWeek.map((s) => sessionRow(plan, s)).join('')}</div>
    </section>`;
}

function sessionRow(plan, s) {
  return `<button type="button" class="list-item plan-sess${s.status === 'today' ? ' is-today' : ''}" data-action="plan-session" data-id="${esc(planIdAttr(plan, s))}">
    <span class="grow"><span class="plan-sess-title truncate">${esc(s.title)}</span>
      <span class="plan-day">${esc(sessionDayText(s.date))}${s.moved ? ` · moved from ${esc(sessionDayText(s.originalDate))}` : ''}</span></span>
    ${statusChip(s)}
  </button>`;
}

/* ---------- Full schedule (sheet) ---------- */

function openPlanSchedule(planId) {
  const plan = findPlan(state, planId);
  if (!plan) { closeSheet(); render(); return; }
  const today = todayKey();
  const list = sessionStatuses(plan, state, today);
  const pr = planProgress(plan, state, today);
  const phase = planPhase(plan, today);
  const byKey = new Map(list.map((s) => [s.key, s]));
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">Done</button>
      <h2 class="truncate" style="max-width:60%">${esc(plan.name)}</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body">
      <div class="sub" style="margin:4px 0 10px">${esc(planDatesText(plan.startDate, plan.endDate))} · ${esc(planStatusText(plan, pr, today))} · ${pr.completed} of ${plural(pr.total, 'session')} done</div>
      ${plan.weeks.map((w) => `
        <div class="section-title">Week ${esc(w.week)}${w.deload ? ' · Lighter week' : ''}</div>
        <div class="card">${w.sessions.map((s) => sessionRow(plan, byKey.get(s.key))).join('')}</div>`).join('')}
      <p class="tpl-hint">Missed sessions stay where they were; nothing is moved for you. Open a session to start, skip or move it.</p>
      <div class="btn-row">
        ${phase === 'active' || phase === 'upcoming' ? '<button type="button" class="btn danger" data-action="plan-stop" data-id="' + esc(plan.id) + '">Stop Program</button>' : ''}
        <button type="button" class="btn ${phase === 'active' || phase === 'upcoming' ? 'secondary' : 'danger'}" data-action="plan-delete" data-id="${esc(plan.id)}">Delete Plan</button>
      </div>
    </div>`);
}

/* ---------- One session (sheet) ---------- */

function openPlanSession(id) {
  const [planId, key] = String(id).split('|');
  const plan = findPlan(state, planId);
  const today = todayKey();
  const s = plan && sessionStatus(plan, key, state, today);
  if (!s) { closeSheet(); render(); return; }
  ui.planSession = id;
  const items = s.targets?.exercises || [];
  const open = ['today', 'upcoming', 'missed', 'skipped'].includes(s.status);
  const otherActive = state.active && !(state.active.plan?.planId === planId && state.active.plan?.sessionKey === key);
  const actions = [];
  if (s.status === 'in-progress') actions.push('<button type="button" class="btn" data-action="continue-workout">Continue Workout</button>');
  if (open || (s.status === 'completed' && s.manual)) {
    actions.push(otherActive
      ? '<div class="tpl-hint">Finish the workout in progress before starting this one.</div>'
      : `<button type="button" class="btn" data-action="review" data-kind="planned" data-id="${esc(id)}">Start Workout</button>`);
  }
  if (s.workoutId) actions.push(`<button type="button" class="btn secondary" data-action="open-workout" data-id="${esc(s.workoutId)}">View Workout</button>`);
  if (['today', 'upcoming', 'missed'].includes(s.status)) actions.push(`<button type="button" class="btn secondary" data-action="plan-skip" data-id="${esc(id)}">Skip Session</button>`);
  if (s.status === 'skipped') actions.push(`<button type="button" class="btn secondary" data-action="plan-clear" data-id="${esc(id)}">Undo Skip</button>`);
  if (['today', 'missed'].includes(s.status)) actions.push(`<button type="button" class="btn secondary" data-action="plan-done" data-id="${esc(id)}">Mark as Done (no workout logged)</button>`);
  if (s.manual) actions.push(`<button type="button" class="btn secondary" data-action="plan-clear" data-id="${esc(id)}">Undo “Done”</button>`);
  if (s.workoutId) actions.push(`<button type="button" class="btn secondary" data-action="plan-unlink" data-id="${esc(s.workoutId)}">Unlink Workout</button>`);
  const canMove = ['today', 'upcoming', 'missed', 'skipped'].includes(s.status) && today <= plan.endDate;
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="plan-open" data-id="${esc(planId)}">‹ Schedule</button>
      <h2 class="truncate" style="max-width:50%">${esc(s.title)}</h2>
      <button type="button" class="link" data-action="close-sheet">Done</button>
    </div>
    <div class="sheet-body plan-session-sheet">
      <div class="review-sub">${esc(plan.name)} · Week ${esc(s.week)} · ${esc(sessionDayText(s.date))}${s.moved ? ` (moved from ${esc(sessionDayText(s.originalDate))})` : ''}</div>
      <div style="margin:8px 0">${statusChip(s)}${s.targets?.deload ? ' <span class="plan-flag">Lighter week</span>' : ''}</div>
      ${s.objective ? `<p class="plan-objective">${esc(s.objective)}</p>` : ''}
      <div class="card review-list">
        ${items.map((x) => `<div class="rv-ex"><div class="rv-name">${esc(x.exerciseId ? exName(x.exerciseId) : x.name)}</div><div class="rv-chips"><span class="chip type-working">${x.sets} × ${x.min}–${x.max} reps</span></div></div>`).join('')}
      </div>
      <div class="btn-col">${actions.join('')}</div>
      ${canMove ? `
        <div class="section-title">Move to another day</div>
        <div class="card card-pad move-row">
          <input type="date" id="plan-move-date" value="${esc(s.date < today ? today : s.date)}" min="${esc(today > plan.startDate ? today : plan.startDate)}" max="${esc(plan.endDate)}" aria-label="New day for this session">
          <button type="button" class="btn secondary small" data-action="plan-move" data-id="${esc(id)}">Move</button>
        </div>
        <p class="tpl-hint">Only this session moves; the rest of the plan stays as it is.</p>` : ''}
    </div>`);
}

/* ---------- Setup and review ---------- */

function openProgramSetup(programId, keep) {
  const p = findProgram(programId);
  if (!p) return;
  if (!keep || ui.planSetup?.id !== p.id) ui.planSetup = { id: p.id, start: todayKey(), ...programDefaults(p) };
  const a = ui.planSetup;
  const problems = programSetupProblems(p, a, a.start).filter((m) => !m.startsWith('Choose exactly') || a.days.length > p.daysPerWeek);
  const warnings = a.days.length === p.daysPerWeek ? programDayWarnings(p, a.days) : [];
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">Cancel</button>
      <h2>Set Up Program</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body plan-setup">
      <div class="review-name">${esc(p.name)}</div>
      <div class="review-sub">${esc(p.level)} · ${p.daysPerWeek} days a week</div>
      <p class="plan-objective">${esc(p.summary)}</p>

      <label class="ps-field"><span class="ps-label">Start date</span><input type="date" id="ps-start" value="${esc(a.start)}" min="${esc(todayKey())}"></label>
      <div class="ps-field"><span class="ps-label">Training days (choose ${p.daysPerWeek})</span>
        <div class="day-picker" role="group" aria-label="Training days">
          ${WEEKDAYS.map((d, i) => `<button type="button" data-action="ps-day" data-d="${i}" class="${a.days.includes(i) ? 'on' : ''}" aria-pressed="${a.days.includes(i)}">${d}</button>`).join('')}
        </div>
        <div class="sub">${a.days.length} of ${p.daysPerWeek} chosen</div>
      </div>
      <label class="ps-field"><span class="ps-label">Length</span>
        <select id="ps-weeks">${p.weekOptions.map((n) => `<option value="${n}"${n === a.weeks ? ' selected' : ''}>${n} weeks</option>`).join('')}</select>
      </label>
      <div class="ps-field"><span class="ps-label">Lighter week</span>
        <div class="segmented" role="group" aria-label="Lighter week">
          ${DELOAD_OPTIONS.map(([v, l]) => `<button type="button" data-action="ps-deload" data-v="${v}" class="${a.deload === v ? 'on' : ''}" aria-pressed="${a.deload === v}">${l}</button>`).join('')}
        </div>
        <div class="sub">A lighter week has about a third fewer sets and less weight, to recover.</div>
      </div>
      ${[...problems.map((m) => `<div class="finish-note warn"><span aria-hidden="true">!</span><div>${esc(m)}</div></div>`), ...warnings.map((m) => `<div class="finish-note"><span aria-hidden="true">i</span><div>${esc(m)}</div></div>`)].join('')}
      <div class="section-title">Workouts</div>
      <div class="card review-list">
        ${p.rotation.map((wid) => `<div class="rv-ex"><div class="rv-name">${esc(p.workouts[wid].title)}</div>
          <div class="rv-chips">${p.workouts[wid].exercises.map((x) => `<span class="chip type-working">${esc(x.name)} ${x.sets}×${x.min}–${x.max}</span>`).join('')}</div></div>`).join('')}
      </div>
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn" data-action="ps-review"${programSetupProblems(p, a, a.start).length ? ' disabled' : ''}>Review Schedule</button>
    </div>`);
}

function openProgramReview() {
  const a = ui.planSetup;
  const p = a && findProgram(a.id);
  if (!p) return;
  const pv = previewProgram(p, setupAnswers(a), a.start);
  if (!pv.ok) { openProgramSetup(p.id, true); return; }
  const have = new Set(state.exercises.map((e) => String(e.name).trim().toLowerCase()));
  const toAdd = [...new Set(Object.values(p.workouts).flatMap((w) => w.exercises.map((x) => x.name)))].filter((n) => !have.has(n.toLowerCase()));
  const sessions = pv.plan.weeks.reduce((n, w) => n + w.sessions.length, 0);
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="ps-back">Back</button>
      <h2>Review Schedule</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body plan-review">
      <div class="review-name">${esc(p.name)}</div>
      <div class="review-sub">${esc(planDatesText(pv.plan.startDate, pv.plan.endDate))} · ${plural(pv.plan.weeks.length, 'week')} · ${plural(sessions, 'session')} · ${esc(a.days.slice().sort((x, y) => x - y).map((d) => WEEKDAYS[d]).join(', '))}</div>
      ${pv.warnings.map((m) => `<div class="finish-note"><span aria-hidden="true">i</span><div>${esc(m)}</div></div>`).join('')}
      ${pv.conflicts.length ? `<div class="finish-note warn"><span aria-hidden="true">!</span><div><b>Same day as your other plan:</b> ${esc(pv.conflicts.map((c) => sessionDayText(c.date)).join(', '))}. You can move sessions later.</div></div>` : ''}
      ${toAdd.length ? `<div class="finish-note"><span aria-hidden="true">i</span><div>Added to your exercise library when you start: ${esc(toAdd.join(', '))}.</div></div>` : ''}
      ${pv.plan.weeks.map((w) => `
        <div class="section-title">Week ${w.week}${w.deload ? ' · Lighter week' : ''}</div>
        <div class="card">${w.sessions.map((s) => `<div class="list-item plan-sess static"><span class="grow"><span class="plan-sess-title truncate">${esc(s.title)}</span><span class="plan-day">${esc(sessionDayText(s.date))}</span></span><span class="plan-meta">${s.targets.exercises.length} exercises · ${s.targets.exercises.reduce((n, x) => n + x.sets, 0)} sets</span></div>`).join('')}</div>`).join('')}
      <p class="tpl-hint">The schedule is saved as it is now when you start, so app updates never change it. Missed sessions are not moved automatically.</p>
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn begin-btn" data-action="ps-start">Start Program</button>
    </div>`);
}

/* ---------- Actions ---------- */

function planResult(r, okText) {
  if (!r.ok) { alert(r.error); return false; }
  save();
  if (okText) toast(okText);
  return true;
}

/** Plans actions. Returns true if handled. */
function handlePlanAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case 'plan-setup': openProgramSetup(id); break;
    case 'ps-day': {
      const d = +el.dataset.d, a = ui.planSetup;
      a.days = a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d];
      openProgramSetup(a.id, true);
      break;
    }
    case 'ps-deload': ui.planSetup.deload = +el.dataset.v; openProgramSetup(ui.planSetup.id, true); break;
    case 'ps-review': openProgramReview(); break;
    case 'ps-back': openProgramSetup(ui.planSetup.id, true); break;
    case 'ps-start': {
      const a = ui.planSetup, p = findProgram(a.id);
      const r = startProgram(p, setupAnswers(a), a.start);
      if (!r.ok) { alert(r.error); break; }
      save();
      ui.planSetup = null;
      closeSheet();
      ui.tab = 'plans';
      render();
      window.scrollTo(0, 0);
      toast(`${p.name} started${r.added.length ? ` · ${plural(r.added.length, 'exercise')} added to your library` : ''}`);
      break;
    }
    case 'plan-open': openPlanSchedule(id); break;
    case 'plan-session': openPlanSession(id); break;
    case 'plan-skip': { const [p, k] = id.split('|'); if (planResult(skipSession(state, p, k), 'Session skipped')) { render(); openPlanSession(id); } break; }
    case 'plan-done': { const [p, k] = id.split('|'); if (planResult(markSessionDone(state, p, k), 'Marked as done')) { render(); openPlanSession(id); } break; }
    case 'plan-clear': { const [p, k] = id.split('|'); if (planResult(clearSessionStatus(state, p, k))) { render(); openPlanSession(id); } break; }
    case 'plan-move': {
      const [p, k] = id.split('|');
      const r = moveSession(state, p, k, $('#plan-move-date')?.value);
      if (!planResult(r)) break;
      render(); openPlanSession(id);
      toast(r.warnings.length ? `Moved · ${r.warnings[0]}` : 'Session moved');
      break;
    }
    case 'plan-unlink': {
      if (!confirm('Unlink this workout from the plan? The workout stays in History; the session counts as not done.')) break;
      const back = ui.planSession;
      if (planResult(unlinkWorkout(state, id), 'Workout unlinked')) { render(); if (back) openPlanSession(back); }
      break;
    }
    case 'plan-stop': {
      const plan = findPlan(state, id);
      if (!plan || !confirm(`Stop “${plan.name}”? Sessions from today on are cancelled; what you have done stays in History.`)) break;
      if (planResult(stopPlan(state, id), 'Program stopped')) { closeSheet(); render(); }
      break;
    }
    case 'plan-delete': {
      const plan = findPlan(state, id);
      if (!plan || !confirm(`Delete “${plan.name}”? Its schedule is removed. Workouts you logged for it stay in History.`)) break;
      if (planResult(deletePlan(state, id), 'Plan deleted')) { closeSheet(); render(); }
      break;
    }
    default: return false;
  }
  return true;
}

/** Setup fields that change without a tap (date, length). */
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!ui.planSetup) return;
  if (t.id === 'ps-start') { ui.planSetup.start = t.value; openProgramSetup(ui.planSetup.id, true); }
  if (t.id === 'ps-weeks') { ui.planSetup.weeks = +t.value; openProgramSetup(ui.planSetup.id, true); }
});

/* ---------- For Home and the Train chooser ---------- */

/** Today's sessions that can still be started: [{ plan, session }]. */
function todaysPlannedSessions(today = todayKey()) {
  return sessionsOn(state, today, today).filter((x) => x.session.status === 'today');
}
