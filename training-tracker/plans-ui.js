'use strict';

/*
  Plans tab: the program library, setting up and reviewing a program, the running
  program (status, this week, full schedule, conflicts), one sheet per session (start,
  skip, move, mark done, view workout), stopping and deleting, and past plans.

  All rules live in plans.js and programs.js; this file only shows them and calls them.
  Loaded after programs.js and before app.js; runs only when called.
*/

/** Which sport a session belongs to, its tag, its details and its length text. */
const sessionSport = (s) => (s?.targets?.run ? 'run' : s?.targets?.swim ? 'swim' : s?.targets?.ride ? 'ride' : 'strength');
const SPORT_LABEL = { run: 'Run', swim: 'Swim', ride: 'Ride', strength: 'Strength' };
const sportTag = (s) => `<span class="sport-tag sport-${sessionSport(s)}">${SPORT_LABEL[sessionSport(s)]}</span>`;
function sportDetailsHtml(t) {
  return t?.run ? runDetailsHtml(t.run) : t?.swim ? swimDetailsHtml(t.swim) : t?.ride ? rideDetailsHtml(t.ride) : '';
}
function sportLengthText(t) {
  if (t?.run) return runKmText(t.run.km);
  if (t?.swim) return `${t.swim.total.toLocaleString()} ${t.swim.pool.unit} · about ${t.swim.estMin} min`;
  if (t?.ride) return t.ride.eventKm ? `${Math.round(t.ride.eventKm * (isImperial() ? 1 / 1.609344 : 1))} ${isImperial() ? 'mi' : 'km'}` : rideTime(t.ride.min);
  return null;
}

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
  const hasSport = running.some((p) => planGroup(p.kind) === 'sport');
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
    <div class="section-title">${hasSport ? 'Running, swimming and cycling plans' : 'Start a running, swimming or cycling plan'}</div>
    ${hasSport ? '<p class="tpl-hint" style="margin-top:0">One running, swimming or cycling plan at a time (alongside one strength program). Stop the current one to start another.</p>' : ''}
    <div class="card">
      ${Object.entries(RUN_GOALS).map(([id, g]) => `
        <button type="button" class="list-item prog-lib" data-action="run-setup" data-id="${id}"${hasSport ? ' disabled' : ''}>
          <span class="grow"><span class="prog-lib-name"><span class="sport-tag sport-run">Run</span> ${g.label} plan</span>
            <span class="sub">For a race or a time goal · 6–16 weeks</span>
            <span class="prog-lib-sum">Built from your current running: easy runs, a long run and (with some experience) one or two harder sessions. Paces from a recent result, or by effort.</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </button>`).join('')}
      <button type="button" class="list-item prog-lib" data-action="swim-setup"${hasSport ? ' disabled' : ''}>
        <span class="grow"><span class="prog-lib-name"><span class="sport-tag sport-swim">Swim</span> Swim plan</span>
          <span class="sub">Fitness, a distance or an event · 6–16 weeks</span>
          <span class="prog-lib-sum">Built around how far you can swim without stopping: technique, endurance and (for stronger swimmers) threshold sets, with rest at the wall.</span></span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      <button type="button" class="list-item prog-lib" data-action="ride-setup"${hasSport ? ' disabled' : ''}>
        <span class="grow"><span class="prog-lib-name"><span class="sport-tag sport-ride">Ride</span> Cycling plan</span>
          <span class="sub">Fitness, a distance or an event · 6–16 weeks · indoor or outdoor</span>
          <span class="prog-lib-sum">Endurance, long and easy rides by time and effort; structured intervals for riders with enough base. Power and heart-rate ranges only from your own numbers.</span></span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
    </div>
    <p class="tpl-hint">Triathlon plans are coming in a later update.</p>
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
      <div class="plan-week-title">${planPhase(plan, today) === 'upcoming' ? 'First week' : `Week ${wkNo}`}${plan.kind !== 'strength' ? ` · ${esc(week.label || '')} · ${esc(weekDoneText(plan, week, thisWeek))}` : ''}</div>
      <div class="plan-sessions">${thisWeek.map((s) => sessionRow(plan, s)).join('')}</div>
    </section>`;
}

function sessionRow(plan, s) {
  return `<button type="button" class="list-item plan-sess${s.status === 'today' ? ' is-today' : ''}" data-action="plan-session" data-id="${esc(planIdAttr(plan, s))}">
    <span class="grow"><span class="plan-sess-title truncate">${sportTag(s)} ${esc(s.title)}</span>
      <span class="plan-day">${esc(sessionDayText(s.date))}${sportLengthText(s.targets) ? ` · ${esc(sportLengthText(s.targets))}` : ''}${s.moved ? ` · moved from ${esc(sessionDayText(s.originalDate))}` : ''}</span></span>
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
      ${plan.kind === 'run' && plan.summary ? runAssessmentHtml(plan.summary, plan.summary.goal) : ''}
      ${(plan.kind === 'swim' || plan.kind === 'bike') && plan.summary ? sportAssessmentHtml(plan.summary) : ''}
      ${plan.weeks.map((w) => `
        <div class="section-title">Week ${esc(w.week)}${plan.kind !== 'strength' ? ` · ${esc(w.label || '')} · ${esc(weekVolumeText(plan, w))}` : w.deload ? ' · Lighter week' : ''}</div>
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
      ${sessionSport(s) !== 'strength' ? sportDetailsHtml(s.targets) : `<div class="card review-list">
        ${items.map((x) => `<div class="rv-ex"><div class="rv-name">${esc(x.exerciseId ? exName(x.exerciseId) : x.name)}</div><div class="rv-chips"><span class="chip type-working">${x.sets} × ${x.min}–${x.max} reps</span></div></div>`).join('')}
      </div>`}
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
  if (handleRunSetupAction(action, el) || handleSportSetupAction(action, el)) return true;
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

/* ---------- Running plans: setup, review, start ---------- */

const RUN_RECENT_DISTANCES = [[1609, '1 mile'], [3000, '3 km'], [5000, '5 km'], [10000, '10 km'], [21097, 'Half marathon']];
const RUN_AGO = [['month', 'Within the last month'], ['quarter', '1–3 months ago'], ['half', '3–6 months ago'], ['older', 'More than 6 months ago']];
const RUN_EXPERIENCE = [['new', 'New', 'Not running yet, or under 6 months'], ['some', 'Some', '6 months to 2 years of regular running'], ['experienced', 'Experienced', '2+ years of regular running']];
const RUN_LIMITS = [['none', 'None'], ['niggle', 'A niggle'], ['injury', 'Current injury']];
const distFactor = () => (isImperial() ? M_PER_MI / 1000 : 1);
const optNum = (v) => { const n = num(String(v ?? '').replace(',', '.')); return n == null ? null : n; };

/** The answers a running plan is built from, from the setup form (distances typed in the selected unit). */
function runAnswers(u) {
  const km = (v) => { const n = optNum(v); return n == null ? null : Math.round(n * distFactor() * 10) / 10; };
  const t = String(u.target || '').trim();
  return {
    distance: u.distance,
    targetSec: t ? (parseClock(t) || -1) : null,
    eventDate: u.hasEvent ? (u.eventDate || '') : null,
    weeks: u.hasEvent ? null : +u.weeks,
    recent: u.recentDist ? { distanceM: +u.recentDist, timeSec: parseClock(u.recentTime) || null, ago: u.recentAgo } : null,
    weeklyKm: km(u.weekly),
    runsPerWeek: u.runs === '' || u.runs == null ? null : +u.runs,
    longestKm: km(u.longest),
    days: [...u.days].sort((a, b) => a - b),
    longDay: u.longDay === '' || u.longDay == null ? null : +u.longDay,
    experience: u.experience || null,
    limitation: u.limitation || 'none',
    ...(u.note && u.note.trim() ? { limitationNote: u.note.trim().slice(0, 300) } : {}),
    maxHr: optNum(u.maxHr) == null ? null : Math.round(optNum(u.maxHr))
  };
}

function openRunSetup(distance, keep) {
  if (!keep || !ui.runSetup) {
    ui.runSetup = { distance, start: todayKey(), hasEvent: false, eventDate: '', weeks: 8, target: '', recentDist: '', recentTime: '', recentAgo: 'month',
      weekly: '', runs: '', longest: '', days: [1, 3, 5, 6], longDay: '6', experience: '', limitation: 'none', note: '', maxHr: '' };
  }
  const u = ui.runSetup;
  const du = isImperial() ? 'mi' : 'km';
  const seg = (key, opts) => `<div class="segmented" role="group">${opts.map(([v, l]) => `<button type="button" data-action="rs-set" data-k="${key}" data-v="${v}" class="${String(u[key]) === String(v) ? 'on' : ''}" aria-pressed="${String(u[key]) === String(v)}">${l}</button>`).join('')}</div>`;
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">Cancel</button>
      <h2>Running Plan</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body plan-setup run-setup">
      <p class="plan-objective">A few questions about your running now. Leave out what you don't know: the plan says what it assumed, and paces are only given when a recent result supports them.</p>
      <div class="ps-field"><span class="ps-label">Goal</span>${seg('distance', [['5k', '5K'], ['10k', '10K']])}</div>
      <div class="ps-field"><span class="ps-label">Race</span>${seg('hasEvent', [['true', 'I have a race date'], ['false', 'No race']])}</div>
      ${u.hasEvent
        ? `<label class="ps-field"><span class="ps-label">Race date</span><input type="date" data-rs="eventDate" value="${esc(u.eventDate)}" min="${esc(todayKey())}"></label>`
        : `<label class="ps-field"><span class="ps-label">Plan length</span><select data-rs="weeks">${RUN_WEEK_OPTIONS.map((n) => `<option value="${n}"${+u.weeks === n ? ' selected' : ''}>${n} weeks</option>`).join('')}</select></label>`}
      <label class="ps-field"><span class="ps-label">Start date</span><input type="date" data-rs="start" value="${esc(u.start)}" min="${esc(todayKey())}"></label>
      <label class="ps-field"><span class="ps-label">Target time (optional)</span><input type="text" inputmode="numeric" data-rs="target" value="${esc(u.target)}" placeholder="e.g. 27:30"></label>

      <div class="section-title">Recent race or time trial</div>
      <label class="ps-field"><span class="ps-label">Distance</span><select data-rs="recentDist" data-rerender="1"><option value="">None / not sure</option>${RUN_RECENT_DISTANCES.map(([m, l]) => `<option value="${m}"${String(u.recentDist) === String(m) ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${u.recentDist ? `
        <label class="ps-field"><span class="ps-label">Time</span><input type="text" inputmode="numeric" data-rs="recentTime" value="${esc(u.recentTime)}" placeholder="mm:ss or h:mm:ss"></label>
        <label class="ps-field"><span class="ps-label">When</span><select data-rs="recentAgo">${RUN_AGO.map(([v, l]) => `<option value="${v}"${u.recentAgo === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : '<p class="tpl-hint" style="margin-top:6px">Without a result the plan is effort-based (no pace numbers).</p>'}

      <div class="section-title">Your running now</div>
      <label class="ps-field"><span class="ps-label">Distance per week (${du}, average)</span><input type="text" inputmode="decimal" data-rs="weekly" value="${esc(u.weekly)}" placeholder="e.g. 15"></label>
      <label class="ps-field"><span class="ps-label">Runs per week</span><select data-rs="runs"><option value="">Not sure</option>${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}"${String(u.runs) === String(n) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="ps-field"><span class="ps-label">Longest run, last month (${du})</span><input type="text" inputmode="decimal" data-rs="longest" value="${esc(u.longest)}" placeholder="e.g. 7"></label>
      <div class="ps-field"><span class="ps-label">Experience</span>${seg('experience', RUN_EXPERIENCE.map(([v, l]) => [v, l]))}
        <div class="sub">${esc((RUN_EXPERIENCE.find(([v]) => v === u.experience) || [, , 'Choose the closest'])[2])}</div></div>

      <div class="section-title">When you can run</div>
      <div class="ps-field"><span class="ps-label">Running days (the others are rest days)</span>
        <div class="day-picker" role="group" aria-label="Running days">
          ${WEEKDAYS.map((d, i) => `<button type="button" data-action="rs-day" data-d="${i}" class="${u.days.includes(i) ? 'on' : ''}" aria-pressed="${u.days.includes(i)}">${d}</button>`).join('')}
        </div>
        <div class="sub">${u.days.length} days · the plan uses up to ${u.experience === 'experienced' ? (u.distance === '10k' ? 6 : 5) : u.experience === 'some' ? 4 : 3} of them</div></div>
      <label class="ps-field"><span class="ps-label">Long run on</span><select data-rs="longDay"><option value="">Any day</option>${u.days.slice().sort((a, b) => a - b).map((d) => `<option value="${d}"${String(u.longDay) === String(d) ? ' selected' : ''}>${WEEKDAYS[d]}</option>`).join('')}</select></label>

      <div class="section-title">Health</div>
      <div class="ps-field"><span class="ps-label">Injuries or limitations</span>${seg('limitation', RUN_LIMITS)}</div>
      ${u.limitation !== 'none' ? `<label class="ps-field"><span class="ps-label">Details (optional)</span><input type="text" data-rs="note" value="${esc(u.note)}" placeholder="e.g. sore left calf"></label>` : ''}
      <label class="ps-field"><span class="ps-label">Maximum heart rate (optional, only if measured)</span><input type="text" inputmode="numeric" data-rs="maxHr" value="${esc(u.maxHr)}" placeholder="e.g. 188"></label>
      <p class="tpl-hint">Heart-rate guidance is shown only with a measured maximum (age formulas are too unreliable).</p>
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn" data-action="rs-review">Review Plan</button>
    </div>`);
}

function runAssessmentHtml(sum, distance) {
  const f = sum.fitness;
  const g = sum.goalCheck || { status: 'none' };
  const label = RUN_GOALS[distance]?.label || '';
  const paceRows = f.paces ? [['Easy runs', 'easy'], ['Long run', 'long'], ['Tempo', 'tempo'], [distance === '10k' ? '10K-pace intervals' : '5K-pace intervals', distance === '10k' ? 'i10k' : 'i5k']] : [];
  const conf = { good: 'good', fair: 'fair: treat as a guide' }[f.confidence];
  return `
    <div class="section-title">Your current fitness</div>
    <div class="card card-pad run-fit">
      ${f.est ? `<div><b>Estimated now:</b> 5K ${fmtClock(f.est['5k'])} · 10K ${fmtClock(f.est['10k'])}</div>
        <div class="sub">From your recent result · confidence ${esc(conf)}</div>
        <div class="pace-table">${paceRows.map(([l, k]) => `<div><span>${esc(l)}</span><b>${esc(paceRangeText(f.paces[k]))}</b></div>`).join('')}</div>`
        : `<div><b>Effort-based plan</b></div><div class="sub">No recent race or time-trial result, so there are no pace numbers. Every run says how it should feel.</div>`}
      ${f.hr ? `<div class="pace-table">${[['Easy', 'easy'], ['Tempo', 'tempo'], ['Intervals', distance === '10k' ? 'i10k' : 'i5k']].map(([l, k]) => `<div><span>${l} heart rate</span><b>${f.hr[k][0]}–${f.hr[k][1]} bpm</b></div>`).join('')}</div>` : ''}
    </div>
    ${g.status !== 'none' ? `<div class="card card-pad goal-check goal-${g.status}" style="margin-top:10px"><b>Target ${label}: ${{ realistic: 'realistic', ambitious: 'ambitious', unlikely: 'unlikely in this time', reached: 'already within reach', unknown: 'can\'t be checked' }[g.status]}</b><div>${esc(g.text)}</div></div>` : ''}
    ${(sum.assumptions || []).length ? `<div class="card card-pad run-assumed" style="margin-top:10px"><b>Assumed (not from your answers)</b>${sum.assumptions.map((m) => `<div>• ${esc(m)}</div>`).join('')}</div>` : ''}
    ${(sum.warnings || []).map((m) => `<div class="finish-note warn"><span aria-hidden="true">!</span><div>${esc(m)}</div></div>`).join('')}
    ${(sum.notes || []).map((m) => `<div class="finish-note"><span aria-hidden="true">i</span><div>${esc(m)}</div></div>`).join('')}`;
}

/** Weeks overview: week, kind, distance, long run. */
function runWeeksTable(weeks) {
  return `<div class="card run-weeks">${weeks.map((w) => {
    const long = w.sessions.find((s) => s.type === 'long' || s.type === 'race');
    return `<div class="run-week-row"><span>Week ${w.week}</span><span class="grow">${esc(w.label || '')}</span><span>${esc(runKmText(w.km))}</span><span class="sub">${long ? (long.type === 'race' ? 'Race' : `Long ${esc(runKmText(long.targets.run.km))}`) : ''}</span></div>`;
  }).join('')}</div>`;
}

function openRunReview() {
  const u = ui.runSetup;
  if (!u) return;
  const a = runAnswers(u);
  const as = assessRun(a, u.start);
  const head = `<div class="sheet-head">
      <button type="button" class="link" data-action="rs-back">Back</button>
      <h2>Review Plan</h2>
      <span style="width:52px"></span>
    </div>`;
  if (!as.ok) {
    openSheet(`${head}<div class="sheet-body">
      <div class="review-name">${esc(RUN_GOALS[u.distance].label)} plan</div>
      <div class="finish-note warn" role="alert"><span aria-hidden="true">!</span><div><b>Some answers need a look before a plan can be built:</b>${as.problems.map((m) => `<div>• ${esc(m)}</div>`).join('')}</div></div>
      <div class="btn-row"><button type="button" class="btn secondary" data-action="rs-back">Back to Questions</button></div>
    </div>`);
    return;
  }
  const def = PLAN_LIBRARY.get(`run-${u.distance}`);
  const created = createPlan(def, a, as.schedule.start, { name: runPlanName(a) });
  const can = canStartPlan(state, 'run');
  const trial = created.ok ? { ...state, plans: [...plansOf(state), created.plan] } : state;
  const conflicts = created.ok ? planConflicts(trial).filter((c) => c.sessions.some((x) => x.planId === created.plan.id)) : [];
  const p = created.ok ? created.plan : null;
  const sessions = p ? p.weeks.reduce((n, w) => n + w.sessions.length, 0) : 0;
  openSheet(`${head}
    <div class="sheet-body plan-review">
      <div class="review-name">${esc(p ? p.name : runPlanName(a))}</div>
      ${p ? `<div class="review-sub">${esc(planDatesText(p.startDate, p.endDate))} · ${plural(p.weeks.length, 'week')} · ${plural(sessions, 'run')} · up to ${as.plan.runs} a week</div>` : ''}
      ${!can.ok ? `<div class="finish-note warn"><span aria-hidden="true">!</span><div>${esc(can.error)}</div></div>` : ''}
      ${!created.ok ? `<div class="finish-note warn"><span aria-hidden="true">!</span><div>${esc(created.errors.join(' '))}</div></div>` : ''}
      ${p ? runAssessmentHtml(p.summary, a.distance) : ''}
      ${conflicts.length ? `<div class="finish-note warn"><span aria-hidden="true">!</span><div><b>Same day as your strength program:</b> ${esc(conflicts.map((c) => sessionDayText(c.date)).join(', '))}. Doing both is possible (strength after the run, or on easy days); you can move sessions later.</div></div>` : ''}
      ${p ? `<div class="section-title">Weeks</div>${runWeeksTable(p.weeks)}
        ${p.weeks.map((w) => `
          <div class="section-title">Week ${w.week} · ${esc(w.label)} · ${esc(runKmText(w.km))}</div>
          <div class="card">${w.sessions.map((s) => `<div class="list-item plan-sess static"><span class="grow"><span class="plan-sess-title truncate">${esc(s.title)}</span><span class="plan-day">${esc(sessionDayText(s.date))}</span></span><span class="plan-meta">${esc(runKmText(s.targets.run.km))}</span></div>`).join('')}</div>`).join('')}` : ''}
      <p class="tpl-hint">General guidance, not medical advice. The schedule is saved as it is now when you start; missed runs are never moved for you. Stop and get advice if something hurts.</p>
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn begin-btn" data-action="rs-start"${p && can.ok ? '' : ' disabled'}>Start Plan</button>
    </div>`);
}

const runPlanName = (a) => `${RUN_GOALS[a.distance].label} plan${a.eventDate ? ` · race ${sessionDayText(a.eventDate)}` : ''}`;

/** Start the running plan from the setup answers. Returns { ok, plan?, error? }. */
function startRunPlan(a, start, st = state, today = todayKey()) {
  const as = assessRun(a, start, today);
  if (!as.ok) return { ok: false, error: as.problems.join(' ') };
  const created = createPlan(PLAN_LIBRARY.get(`run-${a.distance}`), a, as.schedule.start, { name: runPlanName(a) });
  if (!created.ok) return { ok: false, error: created.errors.join(' ') };
  resolveProgramExercises(created.plan, st);
  const r = addPlan(st, created.plan, today);
  return r.ok ? { ok: true, plan: created.plan, conflicts: r.conflicts } : r;
}

function handleRunSetupAction(action, el) {
  const u = ui.runSetup;
  switch (action) {
    case 'run-setup': openRunSetup(el.dataset.id); break;
    case 'rs-set': {
      const v = el.dataset.v;
      u[el.dataset.k] = v === 'true' ? true : v === 'false' ? false : v;
      openRunSetup(u.distance, true);
      break;
    }
    case 'rs-day': {
      const d = +el.dataset.d;
      u.days = u.days.includes(d) ? u.days.filter((x) => x !== d) : [...u.days, d];
      if (u.longDay !== '' && !u.days.includes(+u.longDay)) u.longDay = '';
      openRunSetup(u.distance, true);
      break;
    }
    case 'rs-review': openRunReview(); break;
    case 'rs-back': openRunSetup(u.distance, true); break;
    case 'rs-start': {
      const r = startRunPlan(runAnswers(u), u.start);
      if (!r.ok) { alert(r.error); break; }
      save();
      ui.runSetup = null;
      closeSheet();
      ui.tab = 'plans';
      render();
      window.scrollTo(0, 0);
      toast(`${r.plan.name} started`);
      break;
    }
    default: return false;
  }
  return true;
}

// Typing in the running setup: keep the answers without redrawing (the keyboard stays open).
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (!ui.runSetup || !t.dataset?.rs) return;
  ui.runSetup[t.dataset.rs] = t.value;
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!ui.runSetup || !t.dataset?.rs) return;
  ui.runSetup[t.dataset.rs] = t.value;
  if (t.dataset.rerender) openRunSetup(ui.runSetup.distance, true);
});

/** Distance run this week in sessions done with a linked workout (km). */
function runWeekDoneKm(sessions) {
  let m = 0;
  for (const s of sessions) {
    const w = s.workoutId && state.workouts.find((x) => x.id === s.workoutId);
    if (w) w.entries.forEach((e) => completedSets(e).forEach((x) => { m += num(x.distance) || 0; }));
  }
  return m / 1000;
}

/** A week's planned volume in the sport's unit. */
function weekVolumeText(plan, w) {
  if (plan.kind === 'run') return runKmText(w.km || 0);
  if (plan.kind === 'swim') return swimText(w.m || 0, plan.summary?.pool);
  if (plan.kind === 'bike') return rideTime(w.min || 0);
  return '';
}
/** Done vs planned this week: run km, swim distance, ride time (from the linked workouts). */
function weekDoneText(plan, week, sessions) {
  let m = 0, sec = 0;
  for (const s of sessions) {
    const w = s.workoutId && state.workouts.find((x) => x.id === s.workoutId);
    if (w) w.entries.forEach((e) => completedSets(e).forEach((x) => { m += num(x.distance) || 0; sec += num(x.duration) || 0; }));
  }
  if (plan.kind === 'run') return `${runKmText(m / 1000)} of ${runKmText(week.km || 0)}`;
  if (plan.kind === 'swim') return `${swimText(m, plan.summary?.pool)} of ${swimText(week.m || 0, plan.summary?.pool)}`;
  if (plan.kind === 'bike') return `${rideTime(sec / 60)} of ${rideTime(week.min || 0)}`;
  return '';
}

/** Assessment card for swim and cycling plans (level, paces/zones, readiness, assumptions, warnings, notes). */
function sportAssessmentHtml(sum) {
  const swim = sum.sport === 'swim';
  const rows = [];
  if (swim) {
    rows.push(['Level', { starter: 'Starter: short swims with rest', developing: 'Developing', intermediate: 'Intermediate', advanced: 'Advanced' }[sum.level]]);
    if (sum.base?.cont) rows.push(['Longest swim now', swimText(sum.base.cont, sum.pool)]);
    if (sum.paces) ['easy', 'steady', 'threshold'].forEach((k) => rows.push([`${k[0].toUpperCase()}${k.slice(1)} pace`, swimPaceText(sum.paces[k], sum.pool.unit)]));
  } else {
    rows.push(['Riding now', `${rideTime(sum.base.weeklyMin)} a week, longest ${rideTime(sum.base.longestMin)}`]);
    if (sum.ftp) rows.push(['FTP (measured)', `${sum.ftp} W`]);
    if (sum.maxHr) rows.push(['Max heart rate', `${sum.maxHr} bpm`]);
    if (sum.speed) rows.push(['Usual average speed', `${Math.round(sum.speed * (isImperial() ? 1 / 1.609344 : 1))} ${isImperial() ? 'mph' : 'km/h'}`]);
    rows.push(['Where', { indoor: 'Indoor trainer', outdoor: 'Outdoors', both: 'Indoor and outdoor' }[sum.setting]]);
  }
  return `
    <div class="section-title">Your starting point</div>
    <div class="card card-pad run-fit">
      ${(swim ? sum.paces : sum.ftp || sum.maxHr) ? '' : `<div><b>${swim ? 'Effort-based plan' : 'Time and effort plan'}</b></div>`}
      <div class="pace-table">${rows.map(([l, v]) => `<div><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    </div>
    ${(sum.assumptions || []).length ? `<div class="card card-pad run-assumed" style="margin-top:10px"><b>Assumed (not from your answers)</b>${sum.assumptions.map((m) => `<div>• ${esc(m)}</div>`).join('')}</div>` : ''}
    ${(sum.warnings || []).map((m) => `<div class="finish-note warn"><span aria-hidden="true">!</span><div>${esc(m)}</div></div>`).join('')}
    ${(sum.notes || []).map((m) => `<div class="finish-note"><span aria-hidden="true">i</span><div>${esc(m)}</div></div>`).join('')}`;
}

/* ---------- Swimming and cycling plans: setup, review, start ---------- */

const SPORT_GOALS = { swim: [['fitness', 'Fitness'], ['distance', 'A distance'], ['event', 'An event']], bike: [['fitness', 'Fitness'], ['distance', 'A distance'], ['event', 'An event']] };
const SWIM_POOLS = [['25m', '25 m'], ['50m', '50 m'], ['25yd', '25 yd']];
const SPORT_EXPERIENCE = {
  swim: [['new', 'New', 'New to swimming laps, or back after a long break'], ['some', 'Some', 'Swimming laps regularly for under 2 years'], ['experienced', 'Experienced', '2+ years of regular lap swimming']],
  bike: [['new', 'New', 'New to regular riding'], ['some', 'Some', 'Riding regularly for under 2 years'], ['experienced', 'Experienced', '2+ years of regular riding']]
};
const optInt = (v) => { const n = optNum(v); return n == null ? null : Math.round(n); };

/** Swim answers from the form (distances typed in the pool's unit). */
function swimAnswers(u) {
  const [len, unit] = u.pool === '50m' ? [50, 'm'] : u.pool === '25yd' ? [25, 'yd'] : [25, 'm'];
  const p = String(u.pace || '').trim();
  return {
    goal: u.goal, targetDist: u.goal === 'fitness' ? null : optNum(u.target), eventDate: u.goal === 'event' ? (u.eventDate || '') : null,
    weeks: u.goal === 'event' ? null : +u.weeks, poolLen: len, poolUnit: unit,
    contDist: optNum(u.cont), pace100: p ? (parseClock(p) || -1) : null,
    sessionsPerWeek: u.sessions === '' || u.sessions == null ? null : +u.sessions, weeklyDist: optNum(u.weekly),
    days: [...u.days].sort((a, b) => a - b), experience: u.experience || null, limitation: u.limitation || 'none',
    ...(u.note && u.note.trim() ? { limitationNote: u.note.trim().slice(0, 300) } : {})
  };
}

/** Ride answers from the form (hours and the selected distance unit → minutes and km). */
function rideAnswers(u) {
  const km = (v) => { const n = optNum(v); return n == null ? null : Math.round(n * distFactor() * 10) / 10; };
  // Hours: "3", "2.5" or h:mm ("2:30" = 2 h 30 min) → minutes.
  const mins = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (s.includes(':')) { const [h, m] = s.split(':'); const hh = Number(h), mm = Number(m); return Number.isFinite(hh) && Number.isFinite(mm) && mm >= 0 && mm < 60 ? Math.round(hh * 60 + mm) : null; }
    const n = optNum(s);
    return n == null ? null : Math.round(n * 60);
  };
  return {
    goal: u.goal, targetKm: u.goal === 'fitness' ? null : km(u.target), eventDate: u.goal === 'event' ? (u.eventDate || '') : null,
    weeks: u.goal === 'event' ? null : +u.weeks,
    weeklyMin: mins(u.weekly), ridesPerWeek: u.rides === '' || u.rides == null ? null : +u.rides, longestMin: mins(u.longest),
    speedKmh: optNum(u.speed) == null ? null : Math.round(optNum(u.speed) * distFactor() * 10) / 10,
    ftp: optInt(u.ftp), maxHr: optInt(u.maxHr), setting: u.setting,
    days: [...u.days].sort((a, b) => a - b), longDay: u.longDay === '' || u.longDay == null ? null : +u.longDay,
    experience: u.experience || null, limitation: u.limitation || 'none',
    ...(u.note && u.note.trim() ? { limitationNote: u.note.trim().slice(0, 300) } : {})
  };
}

function openSportSetup(sport, keep) {
  if (!keep || !ui.sportSetup || ui.sportSetup.sport !== sport) {
    ui.sportSetup = sport === 'swim'
      ? { sport, goal: 'fitness', target: '', eventDate: '', weeks: 8, start: todayKey(), pool: '25m', cont: '', pace: '', sessions: '', weekly: '', days: [1, 3, 5], experience: '', limitation: 'none', note: '' }
      : { sport, goal: 'fitness', target: '', eventDate: '', weeks: 8, start: todayKey(), setting: 'outdoor', weekly: '', rides: '', longest: '', speed: '', ftp: '', maxHr: '', days: [1, 3, 6], longDay: '6', experience: '', limitation: 'none', note: '' };
  }
  const u = ui.sportSetup;
  const swim = sport === 'swim';
  const pu = swim ? (u.pool === '25yd' ? 'yd' : 'm') : (isImperial() ? 'mi' : 'km');
  const seg = (key, opts) => `<div class="segmented" role="group">${opts.map(([v, l]) => `<button type="button" data-action="ss-set" data-k="${key}" data-v="${v}" class="${String(u[key]) === String(v) ? 'on' : ''}" aria-pressed="${String(u[key]) === String(v)}">${l}</button>`).join('')}</div>`;
  const field = (label, html) => `<label class="ps-field"><span class="ps-label">${label}</span>${html}</label>`;
  const input = (k, ph, mode = 'decimal') => `<input type="text" inputmode="${mode}" data-ss="${k}" value="${esc(u[k])}" placeholder="${esc(ph)}">`;
  const exps = SPORT_EXPERIENCE[sport];
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">Cancel</button>
      <h2>${swim ? 'Swim Plan' : 'Cycling Plan'}</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body plan-setup run-setup">
      <p class="plan-objective">${swim ? 'A few questions about your swimming now. The plan is built around how far you can swim without stopping; leave out what you don\'t know.' : 'A few questions about your riding now. Rides are planned by time and effort; power, heart rate and distance only appear if you give the numbers they need.'}</p>
      <div class="ps-field"><span class="ps-label">Goal</span>${seg('goal', SPORT_GOALS[sport])}</div>
      ${u.goal !== 'fitness' ? field(`${u.goal === 'event' ? 'Event' : 'Target'} distance (${pu})`, input('target', swim ? 'e.g. 1500' : 'e.g. 100')) : ''}
      ${u.goal === 'event'
        ? field('Event date', `<input type="date" data-ss="eventDate" value="${esc(u.eventDate)}" min="${esc(todayKey())}">`)
        : field('Plan length', `<select data-ss="weeks">${(swim ? SWIM_WEEK_OPTIONS : RIDE_WEEK_OPTIONS).map((n) => `<option value="${n}"${+u.weeks === n ? ' selected' : ''}>${n} weeks</option>`).join('')}</select>`)}
      ${field('Start date', `<input type="date" data-ss="start" value="${esc(u.start)}" min="${esc(todayKey())}">`)}
      ${swim ? `
        <div class="section-title">Your swimming now</div>
        <div class="ps-field"><span class="ps-label">Pool</span>${seg('pool', SWIM_POOLS)}</div>
        ${field(`Longest swim without stopping (${pu})`, input('cont', `e.g. ${u.pool === '50m' ? 100 : 50}`))}
        <p class="tpl-hint" style="margin-top:4px">If you can't swim one length yet, a learn-to-swim class is the right start.</p>
        ${field('Pace per 100 for that swim (optional)', input('pace', 'mm:ss, e.g. 2:10', 'numeric'))}
        ${field('Swims per week', `<select data-ss="sessions"><option value="">Not sure</option>${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}"${String(u.sessions) === String(n) ? ' selected' : ''}>${n}</option>`).join('')}</select>`)}
        ${field(`Distance per week (${pu}, optional)`, input('weekly', 'e.g. 2000'))}` : `
        <div class="section-title">Your riding now</div>
        <div class="ps-field"><span class="ps-label">Where you ride</span>${seg('setting', [['outdoor', 'Outdoors'], ['indoor', 'Indoor trainer'], ['both', 'Both']])}</div>
        ${field('Riding time per week (hours)', input('weekly', 'e.g. 3 or 2:30'))}
        ${field('Rides per week', `<select data-ss="rides"><option value="">Not sure</option>${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}"${String(u.rides) === String(n) ? ' selected' : ''}>${n}</option>`).join('')}</select>`)}
        ${field('Longest ride, last month (hours)', input('longest', 'e.g. 1.5'))}
        <div class="section-title">Measurements (optional)</div>
        ${field(`Usual average speed outdoors (${isImperial() ? 'mph' : 'km/h'})`, input('speed', 'e.g. 25'))}
        ${field('FTP, if measured (watts)', input('ftp', 'e.g. 220', 'numeric'))}
        ${field('Maximum heart rate, if measured', input('maxHr', 'e.g. 185', 'numeric'))}
        <p class="tpl-hint" style="margin-top:4px">Leave these empty if you don't know them: the plan won't guess power or heart-rate zones.</p>`}
      <div class="ps-field"><span class="ps-label">Experience</span>${seg('experience', exps.map(([v, l]) => [v, l]))}
        <div class="sub">${esc((exps.find(([v]) => v === u.experience) || [, , 'Choose the closest'])[2])}</div></div>
      <div class="section-title">When you can ${swim ? 'swim' : 'ride'}</div>
      <div class="ps-field"><span class="ps-label">Days (the others are rest days)</span>
        <div class="day-picker" role="group" aria-label="${swim ? 'Swimming' : 'Riding'} days">
          ${WEEKDAYS.map((d, i) => `<button type="button" data-action="ss-day" data-d="${i}" class="${u.days.includes(i) ? 'on' : ''}" aria-pressed="${u.days.includes(i)}">${d}</button>`).join('')}
        </div><div class="sub">${u.days.length} days</div></div>
      ${swim ? '' : field('Long ride on', `<select data-ss="longDay"><option value="">Any day</option>${u.days.slice().sort((a, b) => a - b).map((d) => `<option value="${d}"${String(u.longDay) === String(d) ? ' selected' : ''}>${WEEKDAYS[d]}</option>`).join('')}</select>`)}
      <div class="section-title">Health</div>
      <div class="ps-field"><span class="ps-label">Injuries or limitations</span>${seg('limitation', RUN_LIMITS)}</div>
      ${u.limitation !== 'none' ? field('Details (optional)', `<input type="text" data-ss="note" value="${esc(u.note)}" placeholder="${swim ? 'e.g. sore shoulder' : 'e.g. sore knee'}">`) : ''}
    </div>
    <div class="sheet-foot"><button type="button" class="btn" data-action="ss-review">Review Plan</button></div>`);
}

const sportPlanName = (sport, a) => {
  const swim = sport === 'swim';
  const d = swim ? (a.targetDist ? ` · ${a.targetDist} ${a.poolUnit}` : '') : (a.targetKm ? ` · ${Math.round(a.targetKm * (isImperial() ? 1 / 1.609344 : 1))} ${isImperial() ? 'mi' : 'km'}` : '');
  return `${swim ? 'Swim plan' : 'Cycling plan'}${a.goal === 'event' ? `${d} · event ${sessionDayText(a.eventDate)}` : d}`;
};

function openSportReview() {
  const u = ui.sportSetup;
  if (!u) return;
  const swim = u.sport === 'swim';
  const a = swim ? swimAnswers(u) : rideAnswers(u);
  const as = swim ? assessSwim(a, u.start) : assessRide(a, u.start);
  const head = `<div class="sheet-head"><button type="button" class="link" data-action="ss-back">Back</button><h2>Review Plan</h2><span style="width:52px"></span></div>`;
  if (!as.ok) {
    openSheet(`${head}<div class="sheet-body">
      <div class="review-name">${swim ? 'Swim plan' : 'Cycling plan'}</div>
      <div class="finish-note warn" role="alert"><span aria-hidden="true">!</span><div><b>Some answers need a look before a plan can be built:</b>${as.problems.map((m) => `<div>• ${esc(m)}</div>`).join('')}</div></div>
      <div class="btn-row"><button type="button" class="btn secondary" data-action="ss-back">Back to Questions</button></div>
    </div>`);
    return;
  }
  const created = createPlan(PLAN_LIBRARY.get(swim ? 'swim' : 'bike'), a, as.schedule.start, { name: sportPlanName(u.sport, a) });
  const kind = swim ? 'swim' : 'bike';
  const can = canStartPlan(state, kind);
  const p = created.ok ? created.plan : null;
  const conflicts = p ? planConflicts({ ...state, plans: [...plansOf(state), p] }).filter((c) => c.sessions.some((x) => x.planId === p.id)) : [];
  const sessions = p ? p.weeks.reduce((n, w) => n + w.sessions.length, 0) : 0;
  openSheet(`${head}
    <div class="sheet-body plan-review">
      <div class="review-name">${esc(p ? p.name : sportPlanName(u.sport, a))}</div>
      ${p ? `<div class="review-sub">${esc(planDatesText(p.startDate, p.endDate))} · ${plural(p.weeks.length, 'week')} · ${plural(sessions, swim ? 'swim' : 'ride')}</div>` : ''}
      ${!can.ok ? `<div class="finish-note warn"><span aria-hidden="true">!</span><div>${esc(can.error)}</div></div>` : ''}
      ${!created.ok ? `<div class="finish-note warn"><span aria-hidden="true">!</span><div>${esc(created.errors.join(' '))}</div></div>` : ''}
      ${p ? sportAssessmentHtml(p.summary) : ''}
      ${conflicts.length ? `<div class="finish-note warn"><span aria-hidden="true">!</span><div><b>Same day as your strength program:</b> ${esc(conflicts.map((c) => sessionDayText(c.date)).join(', '))}. You can move sessions later.</div></div>` : ''}
      ${p ? `<div class="section-title">Weeks</div>
        <div class="card run-weeks">${p.weeks.map((w) => `<div class="run-week-row"><span>Week ${w.week}</span><span class="grow">${esc(w.label)}</span><span>${esc(weekVolumeText(p, w))}</span><span class="sub">${w.sessions.length} ${swim ? 'swims' : 'rides'}</span></div>`).join('')}</div>
        ${p.weeks.map((w) => `
          <div class="section-title">Week ${w.week} · ${esc(w.label)} · ${esc(weekVolumeText(p, w))}</div>
          <div class="card">${w.sessions.map((s) => `<div class="list-item plan-sess static"><span class="grow"><span class="plan-sess-title truncate">${sportTag(s)} ${esc(s.title)}</span><span class="plan-day">${esc(sessionDayText(s.date))}</span></span><span class="plan-meta">${esc(sportLengthText(s.targets))}</span></div>`).join('')}</div>`).join('')}` : ''}
      <p class="tpl-hint">General guidance, not medical advice. The schedule is saved as it is now when you start; missed sessions are never moved for you.</p>
    </div>
    <div class="sheet-foot"><button type="button" class="btn begin-btn" data-action="ss-start"${p && can.ok ? '' : ' disabled'}>Start Plan</button></div>`);
}

/** Start a swim or cycling plan from answers. Returns { ok, plan?, error? }. */
function startSportPlan(sport, a, start, st = state, today = todayKey()) {
  const swim = sport === 'swim';
  const as = swim ? assessSwim(a, start, today) : assessRide(a, start, today);
  if (!as.ok) return { ok: false, error: as.problems.join(' ') };
  const created = createPlan(PLAN_LIBRARY.get(swim ? 'swim' : 'bike'), a, as.schedule.start, { name: sportPlanName(sport, a) });
  if (!created.ok) return { ok: false, error: created.errors.join(' ') };
  resolveProgramExercises(created.plan, st);
  const r = addPlan(st, created.plan, today);
  return r.ok ? { ok: true, plan: created.plan, conflicts: r.conflicts } : r;
}

function handleSportSetupAction(action, el) {
  const u = ui.sportSetup;
  switch (action) {
    case 'swim-setup': openSportSetup('swim'); break;
    case 'ride-setup': openSportSetup('bike'); break;
    case 'ss-set': u[el.dataset.k] = el.dataset.v; openSportSetup(u.sport, true); break;
    case 'ss-day': {
      const d = +el.dataset.d;
      u.days = u.days.includes(d) ? u.days.filter((x) => x !== d) : [...u.days, d];
      if (u.longDay !== '' && u.longDay != null && !u.days.includes(+u.longDay)) u.longDay = '';
      openSportSetup(u.sport, true);
      break;
    }
    case 'ss-review': openSportReview(); break;
    case 'ss-back': openSportSetup(u.sport, true); break;
    case 'ss-start': {
      const r = startSportPlan(u.sport, u.sport === 'swim' ? swimAnswers(u) : rideAnswers(u), u.start);
      if (!r.ok) { alert(r.error); break; }
      save();
      ui.sportSetup = null;
      closeSheet();
      ui.tab = 'plans';
      render();
      window.scrollTo(0, 0);
      toast(`${r.plan.name} started`);
      break;
    }
    default: return false;
  }
  return true;
}

document.addEventListener('input', (ev) => { const t = ev.target; if (ui.sportSetup && t.dataset?.ss) ui.sportSetup[t.dataset.ss] = t.value; });
document.addEventListener('change', (ev) => { const t = ev.target; if (ui.sportSetup && t.dataset?.ss) ui.sportSetup[t.dataset.ss] = t.value; });
