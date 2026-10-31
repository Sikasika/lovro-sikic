'use strict';

/*
  Home ("Today") and the Progress section switcher.

  Home answers "what should I train today?" with, in order: the workout in progress
  (or what to start), this week at a glance, the latest workout and up to two
  insights, and the body-weight trend when weigh-ins exist. Everything is read from
  existing data and shared calculations; nothing here is stored.

  Progress groups Overview (the former Progress tab), Insights, Statistics and Body
  weight. They keep their own render functions and tab ids, so existing behaviour is
  unchanged. The Plans tab itself is in plans-ui.js.

  Loaded before app.js; everything runs only when called.
*/

/** Tabs that live under Progress, with their labels in the section switcher. */
const PROGRESS_VIEWS = [['progress', 'Overview'], ['insights', 'Insights'], ['muscles', 'Muscles'], ['statistics', 'Stats'], ['body', 'Body']];
const isProgressView = (t) => PROGRESS_VIEWS.some(([id]) => id === t);

function progressSubnav(current) {
  return `<nav class="subnav" aria-label="Progress sections">
    ${PROGRESS_VIEWS.map(([id, label]) => `<button type="button" data-tab="${id}" class="${id === current ? 'on' : ''}" aria-current="${id === current ? 'page' : 'false'}">${label}</button>`).join('')}
  </nav>`;
}

function renderBodyView() {
  return `${renderWeightCard()}
    <p class="stats-note">Longer-term charts are under Stats; weight trends also appear in Insights.</p>`;
}

/* ---------- Home ---------- */

// Classic gear (cog): eight teeth around a ring with a centre hole.
const GEAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linejoin="round" d="M10.3 2.6h3.4l.5 2.6c.7.2 1.3.5 1.9.9l2.2-1.5 2.4 2.4-1.5 2.2c.4.6.7 1.2.9 1.9l2.6.5v3.4l-2.6.5c-.2.7-.5 1.3-.9 1.9l1.5 2.2-2.4 2.4-2.2-1.5c-.6.4-1.2.7-1.9.9l-.5 2.6h-3.4l-.5-2.6c-.7-.2-1.3-.5-1.9-.9l-2.2 1.5-2.4-2.4 1.5-2.2c-.4-.6-.7-1.2-.9-1.9l-2.6-.5v-3.4l2.6-.5c.2-.7.5-1.3.9-1.9L4.6 6.9l2.4-2.4 2.2 1.5c.6-.4 1.2-.7 1.9-.9z"/><circle cx="12" cy="12" r="3.2"/></svg>';

/** Mon–Sun of the current week: which days had completed workouts, by activity type. */
function weekStrip(items, today) {
  const start = startOfWeek(today);
  const days = Array.from({ length: 7 }, (_, i) => sAddDays(start, i));
  const byDay = new Map();
  for (const it of items) {
    if (it.day < start || it.day > days[6]) continue;
    const k = sKey(it.day);
    const types = byDay.get(k) || new Set();
    it.entries.forEach((e) => types.add(entryType(e)));
    byDay.set(k, types);
  }
  const planned = new Map(); // date → statuses of planned sessions that day
  for (const p of runningPlans(state, sKey(today)).concat(plansOf(state).filter((p) => planPhase(p, sKey(today)) === 'finished'))) {
    for (const s of sessionStatuses(p, state, sKey(today))) {
      if (s.date < sKey(start) || s.date > sKey(days[6])) continue;
      planned.set(s.date, [...(planned.get(s.date) || []), s.status]);
    }
  }
  const week = items.filter((it) => it.day >= start && it.day <= today);
  const sum = summarizeWorkouts(week);
  return `
    <div class="section-title">This week</div>
    <div class="card card-pad">
      <div class="week-strip" role="list">
        ${days.map((d) => {
          const types = byDay.get(sKey(d));
          const isToday = sKey(d) === sKey(today);
          const plan = planned.get(sKey(d)) || [];
          const missed = !types && plan.includes('missed');
          const due = !types && plan.some((st) => st === 'upcoming' || st === 'today');
          const label = `${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}: ${types ? 'trained' : missed ? 'planned session missed' : due ? 'session planned' : d > today ? 'coming up' : 'no workout'}`;
          return `<div class="wk-day${isToday ? ' today' : ''}${types ? ' done' : ''}${d > today ? ' future' : ''}${due ? ' planned' : ''}${missed ? ' missed' : ''}" role="listitem" aria-label="${esc(label)}">
            <span class="wk-name">${esc(d.toLocaleDateString(undefined, { weekday: 'narrow' }))}</span>
            <span class="wk-num">${d.getDate()}</span>
            <span class="wk-dots">${types ? [...types].map((t) => `<i class="act-${t}"></i>`).join('') : ''}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="wk-sum">${sum.count ? `${plural(sum.count, 'workout')}${sum.minutes != null ? ` · ${fmtHours(sum.minutes)}` : ''}${sum.volume != null ? ` · ${fmtWeight(sum.volume)} ${esc(unit())} volume` : ''}` : 'No workouts yet this week'}</div>
    </div>`;
}

function homeActiveCard() {
  const w = state.active;
  const c = sessionCounts(w);
  return `
    <div class="home-live">
      <div class="home-live-top"><span class="live-dot" aria-hidden="true"></span><span>Workout in progress</span><span class="home-live-time" id="home-elapsed">${fmtDuration(Date.now() - new Date(w.start))}</span></div>
      <div class="home-live-name">${esc(w.name || 'Workout')}</div>
      <div class="home-live-sub">${c.total ? `${c.done} of ${plural(c.total, 'set')} done` : 'No exercises yet'}</div>
      <button type="button" class="hero-btn" data-action="continue-workout">Continue Workout</button>
    </div>`;
}

/** Today's planned session from a running plan (start it from here), if any is still open. */
function homePlannedCard(x, more = [], strengthCount = 0) {
  const { plan, session: s } = x;
  // Strength sessions: "Start Today's Workout" (through the planned-session review); with more than
  // one strength session today, the button asks which one first.
  const startBtn = strengthCount > 1
    ? '<button type="button" class="hero-btn" data-action="home-choose-session">Start Today\'s Workout</button>'
    : `<button type="button" class="hero-btn" data-action="review" data-kind="planned" data-id="${esc(`${plan.id}|${s.key}`)}">${sessionSport(s) === 'strength' ? 'Start Today\'s Workout' : `Start ${esc(s.title)}`}</button>`;
  const pr = planProgress(plan);
  const n = s.targets?.exercises?.length || 0;
  return `
    <section class="start-hero home-today home-plan">
      <div class="home-plan-tag"><span class="plan-tag">Plan</span> ${sessionSport(s) !== 'strength' ? `${sportTag(s)} ` : ''}${esc(plan.name)} · Week ${esc(s.week)} of ${pr.weeks}</div>
      <h2 class="hero-title">Today: ${esc(s.title)}</h2>
      <p class="hero-sub">${s.targets?.run ? `${esc(runKmText(s.targets.run.km))} · about ${s.targets.run.estMin} min` : s.targets?.swim || s.targets?.ride ? esc(sportLengthText(s.targets)) : `${plural(n, 'exercise')} · ${plural((s.targets?.exercises || []).reduce((a, x) => a + x.sets, 0), 'set')}`}${s.targets?.deload ? ' · Lighter week' : ''}${pr.completed ? ` · ${pr.completed} of ${pr.total} sessions done` : ''}</p>
      ${startBtn}
      <div class="home-plan-links">
        <button type="button" class="link small" data-action="plan-session" data-id="${esc(`${plan.id}|${s.key}`)}">Skip or move</button>
        <button type="button" class="link small" data-action="start-flow">Other workout</button>
      </div>
      ${more.length ? `<div class="home-plan-more">Also today: ${more.map((m) => `<button type="button" class="link small" data-action="review" data-kind="planned" data-id="${esc(`${m.plan.id}|${m.session.key}`)}">${esc(m.session.title)}</button>`).join(', ')}</div>` : ''}
    </section>`;
}

function homeTodayCard(items, today) {
  const planned = todaysPlannedSessions(sKey(today));
  const strength = planned.filter((x) => sessionSport(x.session) === 'strength');
  if (strength.length) return homePlannedCard(strength[0], planned.filter((x) => x !== strength[0]), strength.length);
  if (planned.length) return homePlannedCard(planned[0], planned.slice(1));
  const doneToday = items.filter((it) => sKey(it.day) === sKey(today));
  return `
    <section class="start-hero home-today">
      <h2 class="hero-title">${doneToday.length ? 'Nice work today' : 'Ready to train?'}</h2>
      <p class="hero-sub">${doneToday.length
        ? esc(doneToday.map((it) => `${it.w.name} · ${plural(workoutSetCount(it.w), 'set')}`).join(' · '))
        : runningPlans(state).length ? 'Nothing planned for today. Start a workout if you feel like it.' : 'No plan scheduled for today. Start a workout, or set up a program in Plans.'}</p>
      <button type="button" class="hero-btn" data-action="start-flow">Start Workout</button>
    </section>`;
}

function homeBodyWeight() {
  const list = weighIns();
  if (!list.length) return '';
  const t = weightTrend(list);
  const u = esc(unit());
  return `
    <div class="section-row">
      <div class="section-title">Body weight</div>
      <button type="button" class="link small" data-tab="body">Log weight ›</button>
    </div>
    <button type="button" class="card card-pad home-bw" data-tab="body" aria-label="Body weight: latest ${esc(bwText(t.latest.kg))}, 7-day average ${esc(bwText(t.cur.avg))}">
      <span><b>${fmtWeight(t.latest.kg)}</b><small>Latest (${u}) · ${esc(bwDayText(t.latest.date))}</small></span>
      <span><b>${fmtWeight(t.cur.avg)}</b><small>7-day avg</small></span>
      <span><b>${t.change == null ? '–' : bwSigned(t.change)}</b><small>${t.change == null ? 'Not enough data' : 'vs 7 days before'}</small></span>
    </button>`;
}

function homeRecent(items, today) {
  if (!items.length) return '';
  const last = items[items.length - 1].w;
  const { cards } = insightCards(items, today);
  return `
    <div class="section-title">Recent training</div>
    <div class="card">
      <button type="button" class="list-item" data-action="open-workout" data-id="${esc(last.id)}">
        <span class="grow"><span class="truncate" style="display:block;font-weight:600">${esc(last.name)}</span>
          <span class="sub">${esc(fmtDate(last.start))} · ${workoutDurationText(last)} · ${plural(workoutSetCount(last), 'set')}</span></span>
        <span class="chev">›</span>
      </button>
    </div>
    ${cards.length ? `<div class="insight-cards">${cards.slice(0, 2).map((c) => `
      <div class="insight-card">
        <div class="insight-icon" aria-hidden="true">${c.icon}</div>
        <div><div class="insight-title">${esc(c.title)}</div><div class="insight-text">${esc(c.text)}</div></div>
      </div>`).join('')}</div>
      <button type="button" class="link small home-more" data-tab="insights">More in Insights ›</button>` : ''}`;
}

function renderHome(action) {
  action.innerHTML = `<button type="button" class="gear-btn" data-action="open-settings" aria-label="Settings">${GEAR_SVG}</button>`;
  const { items, today } = completedWorkouts();
  return `
    <div class="home-date">${esc(today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
    ${state.active ? homeActiveCard() : homeTodayCard(items, today)}
    ${homeBackupReminder()}
    ${weekStrip(items, today)}
    ${homeRecent(items, today)}
    ${homeBodyWeight()}
    ${!items.length && !weighIns().length ? '<p class="stats-note">Your week, recent training and body-weight trend appear here as you log them.</p>' : ''}`;
}

/** More than one strength session today: choose one; each goes to the usual planned-session review. */
function openTodaysSessionChooser() {
  const list = todaysPlannedSessions().filter((x) => sessionSport(x.session) === 'strength');
  if (list.length === 1) { openReview('planned', `${list[0].plan.id}|${list[0].session.key}`); return; }
  if (!list.length) { closeSheet(); render(); return; }
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">Cancel</button>
      <h2 class="truncate" style="max-width:60%">Today's workouts</h2>
      <span style="width:52px"></span>
    </div>
    <div class="sheet-body">
      <p class="tpl-hint" style="margin-top:0">${list.length} strength sessions are planned for today. Choose one to review before you begin.</p>
      <div class="card">${list.map(({ plan, session: s }) => `
        <button type="button" class="list-item" data-action="review" data-kind="planned" data-id="${esc(`${plan.id}|${s.key}`)}">
          <span class="grow"><span style="display:block;font-weight:600">${esc(s.title)}</span><span class="sub">${esc(plan.name)} · Week ${esc(s.week)} · ${plural((s.targets?.exercises || []).length, 'exercise')}${s.moved ? ` · moved from ${esc(sessionDayText(s.originalDate))}` : ''}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </button>`).join('')}</div>
    </div>`);
}
