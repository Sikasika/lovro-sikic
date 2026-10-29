'use strict';

/* =========================================================
   Insights tab: what is changing, in plain language.
   Statistics stays the detailed exploration area.

   All numbers come from the shared rules in calc.js
   (completedWorkouts, periodReport, exerciseSessions,
   progressionMetric, recentVsEarlier, plateauCheck,
   repsAtWeights, recordEvents, ...). This file only chooses
   periods, compares them and words the result. Loaded after
   stats.js (uses STAT_TYPES, typeLabel and hbar from it).
   ========================================================= */

ui.ins = { view: 'overview', week: 1, ex: null, cardioEx: null };

/** Changes smaller than this (percent) are not reported as insight cards. */
const INSIGHT_MIN_PCT = 10;
/** Categories not logged for this many days are listed under Balance. */
const NOT_RECENT_DAYS = 14;
const BALANCE_WEEKS = 4;
const PLATEAU_WEEK_OPTIONS = [4, 6, 8, 12];

const plateauWeeks = () => (PLATEAU_WEEK_OPTIONS.includes(state.settings.plateauWeeks) ? state.settings.plateauWeeks : 6);
const fmtRange = (s, e) => {
  const last = sAddDays(e, -1);
  const opts = { day: 'numeric', month: 'short' };
  return `${s.toLocaleDateString(undefined, opts)} – ${last.toLocaleDateString(undefined, opts)}`;
};
const weekdayName = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });

/** "+2 · +40%", "−300 kg · −12%", "new", "–" — for a change between two recorded values. */
function changeText(cur, prev, fmt = fmtNum, { recorded = true } = {}) {
  if (!recorded) return '<span class="muted">not recorded</span>';
  if (!cur && !prev) return '<span class="muted">–</span>';
  const c = periodChange(cur || 0, prev || 0);
  if (c.abs === 0) return '<span class="muted">same</span>';
  if (c.pct == null) return '<span class="chg up">new</span>';
  const sign = c.abs > 0 ? '+' : '−';
  return `<span class="chg ${c.abs > 0 ? 'up' : 'down'}">${sign}${fmt(Math.abs(c.abs))}<span class="pct">${sign}${Math.round(Math.abs(c.pct))}%</span></span>`;
}

function renderInsights() {
  const { items, today } = completedWorkouts();
  if (!items.length) {
    return `<div class="empty"><div class="big">💡</div>Insights appear once you have finished workouts.<br>They compare complete Monday–Sunday weeks, so log workouts in at least two different weeks to see changes.</div>`;
  }
  const v = ui.ins.view;
  const views = [['overview', 'Week'], ['strength', 'Strength'], ['cardio', 'Cardio'], ['balance', 'Balance']];
  return `
    <div class="segmented stats-seg" role="tablist" aria-label="Insights sections" style="margin-top:12px">
      ${views.map(([id, label]) => `<button role="tab" data-iaction="view" data-v="${id}" class="${v === id ? 'on' : ''}" aria-selected="${v === id}">${label}</button>`).join('')}
    </div>
    ${v === 'overview' ? renderInsightCards(items, today) + renderWeekReport(items, today) : ''}
    ${v === 'strength' ? renderStrengthInsights(items, today) : ''}
    ${v === 'cardio' ? renderCardioInsights(items, today) : ''}
    ${v === 'balance' ? renderBalanceInsights(items, today) : ''}`;
}

/* ---------- Insight cards ---------- */

/** Strength exercises with their sessions and progression metric (archived exercises included: their history is real). */
function strengthExercises(items) {
  const ids = [...new Set(items.flatMap((it) => it.entries.filter((e) => entryType(e) === 'weights').map((e) => e.exerciseId)))];
  return ids.map((id) => {
    const sessions = exerciseSessions(items, id);
    return { id, sessions, metric: progressionMetric(sessions) };
  }).filter((x) => x.metric && x.sessions.length);
}

const metricName = (m) => ({ e1rm: 'estimated 1RM', weight: 'heaviest weight', reps: 'most reps in a set' }[m]);
const metricValue = (m, v) => (m === 'reps' ? `${fmtNum(v)} reps` : `${fmtWeight(v)} ${unit()}`);

function insightCards(items, today) {
  const cards = [];
  const L = weekRange(today, 1), P = weekRange(today, 2);
  const last = periodReport(itemsBetween(items, L.s, L.e));
  const prev = periodReport(itemsBetween(items, P.s, P.e));
  const lr = fmtRange(L.s, L.e), pr = fmtRange(P.s, P.e);
  const twoWeeks = last.workouts > 0 || prev.workouts > 0;

  if (twoWeeks && last.workouts !== prev.workouts) {
    const up = last.workouts > prev.workouts;
    cards.push({ icon: up ? '📈' : '📉', title: `Training frequency ${up ? 'increased' : 'decreased'}`,
      text: `${last.workouts} workout${last.workouts === 1 ? '' : 's'} last week (${lr}) vs ${prev.workouts} the week before (${pr}).` });
  }
  if (last.volume != null && prev.volume != null) {
    const c = periodChange(last.volume, prev.volume);
    if (c.pct != null && Math.abs(c.pct) >= INSIGHT_MIN_PCT) {
      cards.push({ icon: c.abs > 0 ? '🏋️' : '↘️', title: `Strength volume ${c.abs > 0 ? 'up' : 'down'} ${Math.round(Math.abs(c.pct))}%`,
        text: `${fmtWeight(last.volume)} ${unit()} last week (${lr}) vs ${fmtWeight(prev.volume)} ${unit()} (${pr}). Weight × reps, warm-ups excluded.` });
    }
  }
  const plateaus = strengthExercises(items)
    .map((x) => ({ ...x, check: plateauCheck(x.sessions, x.metric, plateauWeeks(), today) }))
    .filter((x) => x.check.status === 'possible-plateau');
  if (plateaus.length) {
    const x = plateaus[0];
    cards.push({ icon: '⏸️', title: `Possible plateau: ${exName(x.id)}`,
      text: `No new best ${metricName(x.metric)} in the last ${plateauWeeks()} weeks (${x.check.recentCount} sessions): best ${metricValue(x.metric, x.check.bestRecent)} vs ${metricValue(x.metric, x.check.bestEarlier)} earlier. This only reflects what was logged.${plateaus.length > 1 ? ` ${plateaus.length - 1} more under Strength.` : ''}` });
  }
  let bestCardio = null;
  last.distances.forEach((d, id) => {
    const p = prev.distances.get(id);
    if (!p) return;
    const c = periodChange(d, p);
    if (Math.abs(c.pct) >= INSIGHT_MIN_PCT && (!bestCardio || Math.abs(c.pct) > Math.abs(bestCardio.c.pct))) bestCardio = { id, d, p, c };
  });
  if (bestCardio) {
    const k = cardioKindOf(bestCardio.id);
    cards.push({ icon: '🏃', title: `${exName(bestCardio.id)} distance ${bestCardio.c.abs > 0 ? 'up' : 'down'} ${Math.round(Math.abs(bestCardio.c.pct))}%`,
      text: `${fmtDistance(bestCardio.d, k)} last week (${lr}) vs ${fmtDistance(bestCardio.p, k)} (${pr}).` });
  }
  const recs = recordEvents(items).filter((ev) => { const d = sDay(new Date(ev.date)); return d >= L.s && d < L.e; });
  if (recs.length) {
    cards.push({ icon: '🏅', title: `${recs.length} new record${recs.length === 1 ? '' : 's'} last week`,
      text: `${recs.slice(0, 2).map((ev) => `${exName(ev.exerciseId)}: ${RECORD_LABELS[ev.metric].toLowerCase()} ${recordValueText(ev.metric, ev.value, ev.exerciseId)}`).join('; ')}${recs.length > 2 ? '; …' : ''} (${lr}).` });
  }
  const weight = weightInsightCard(L, P, lr, pr);
  if (weight) cards.push(weight);
  const stale = notRecentCategories(items, today);
  if (stale.length) {
    cards.push({ icon: '🗓️', title: `Not logged in the last ${NOT_RECENT_DAYS} days`,
      text: `${stale.slice(0, 3).map((x) => `${x.cat} (last ${fmtDate(x.last, { day: 'numeric', month: 'short' })})`).join(', ')}${stale.length > 3 ? ', …' : ''}.` });
  }
  return { cards: cards.slice(0, 4), twoWeeks };
}

function renderInsightCards(items, today) {
  const { cards, twoWeeks } = insightCards(items, today);
  if (!twoWeeks) {
    return `<div class="card card-pad stats-empty" style="margin-top:12px">
      <div style="font-weight:600;color:var(--text)">Not enough complete weeks yet</div>
      Insights compare the last complete Monday–Sunday week with the one before it. Log workouts in those weeks to see changes here.
    </div>`;
  }
  if (!cards.length) {
    return `<div class="card card-pad stats-empty" style="margin-top:12px">No notable changes between the last two complete weeks. Small changes (under ${INSIGHT_MIN_PCT}%) are not highlighted.</div>`;
  }
  return `<div class="insight-cards">${cards.map((c) => `
    <div class="insight-card">
      <div class="insight-icon" aria-hidden="true">${c.icon}</div>
      <div><div class="insight-title">${esc(c.title)}</div><div class="insight-text">${esc(c.text)}</div></div>
    </div>`).join('')}</div>`;
}

/* ---------- Weekly report ---------- */

function renderWeekReport(items, today) {
  const firstWeek = startOfWeek(items[0].day);
  const maxOffset = Math.max(1, Math.round(sDaysBetween(firstWeek, startOfWeek(today)) / 7));
  const off = Math.min(Math.max(0, ui.ins.week), maxOffset);
  ui.ins.week = off;
  const W = weekRange(today, off), P = weekRange(today, off + 1);
  // The current week is compared with the same weekdays of the previous week, never as a full week.
  const partial = !W.complete;
  const curEnd = partial ? sAddDays(today, 1) : W.e;
  const prevEnd = partial ? sAddDays(P.s, W.days) : P.e;
  const cur = periodReport(itemsBetween(items, W.s, curEnd));
  const prev = periodReport(itemsBetween(items, P.s, prevEnd));
  const curLabel = partial ? `This week so far (${fmtRange(W.s, curEnd)})` : `Week of ${fmtRange(W.s, W.e)}`;
  const prevLabel = partial ? `Same days last week (${fmtRange(P.s, prevEnd)})` : `Week of ${fmtRange(P.s, P.e)}`;

  const row = (label, c, p, fmt, opts = {}) => `<tr><th>${label}</th><td>${opts.curText ?? (c == null ? '<span class="muted">–</span>' : fmt(c))}</td><td>${opts.prevText ?? (p == null ? '<span class="muted">–</span>' : fmt(p))}</td><td>${changeText(c, p, fmt, opts)}</td></tr>`;
  const count = (n) => String(n);
  const cardioTime = (r) => (r.cardioUntimed ? '<span class="muted">not recorded</span>' : r.cardioSec == null ? '<span class="muted">–</span>' : fmtClock(r.cardioSec));
  const activities = [...new Set([...cur.distances.keys(), ...prev.distances.keys()])];
  const cats = allCategories().filter((c) => cur.categories.has(c) || prev.categories.has(c));
  const anySports = cur.sports || prev.sports;

  return `
    <div class="section-title">Weekly report</div>
    <div class="card card-pad">
      <div class="heat-nav">
        <button class="heat-arrow" data-iaction="week" data-dir="1" aria-label="Previous week" ${off >= maxOffset ? 'disabled' : ''}>‹</button>
        <div class="heat-range" aria-live="polite">${partial ? 'This week' : off === 1 ? 'Last week' : `${off} weeks ago`}</div>
        <button class="heat-arrow" data-iaction="week" data-dir="-1" aria-label="Next week" ${off <= 0 ? 'disabled' : ''}>›</button>
      </div>
      <div class="heat-sub">${esc(curLabel)}<br>compared with ${esc(prevLabel)}</div>
      ${partial ? `<p class="stats-note" style="margin:0 0 8px">The week is still in progress (${W.days} of 7 days), so it is compared with the same ${W.days === 1 ? 'day' : `${W.days} days`} of last week.</p>` : ''}
      <table class="compare report">
        <thead><tr><th></th><th>${partial ? 'So far' : 'Week'}</th><th>Prev</th><th>Change</th></tr></thead>
        <tbody>
          ${row('Workouts', cur.workouts, prev.workouts, count)}
          ${row('Strength sessions', cur.strength, prev.strength, count)}
          ${row('Cardio sessions', cur.cardio, prev.cardio, count)}
          ${anySports ? row('Sports sessions', cur.sports, prev.sports, count) : ''}
          ${row('Cardio time', cur.cardioSec, prev.cardioSec, fmtClock, { curText: cardioTime(cur), prevText: cardioTime(prev), recorded: !cur.cardioUntimed && !prev.cardioUntimed })}
          ${row(`Strength volume (${esc(unit())})`, cur.volume, prev.volume, fmtWeight)}
          ${weightReportRow(W.s, curEnd, P.s, prevEnd)}
          ${activities.map((id) => {
            // Unit in the label keeps the number cells short on narrow screens.
            const k = cardioKindOf(id);
            const num2 = (m) => toDisplayDistance(m, k).toLocaleString(undefined, { minimumFractionDigits: distanceDecimals(k), maximumFractionDigits: distanceDecimals(k) });
            return row(`${esc(exName(id))} (${distanceUnit(k)})`, cur.distances.get(id) ?? null, prev.distances.get(id) ?? null, num2);
          }).join('')}
        </tbody>
      </table>
      ${cats.length ? `
        <div class="stats-chart-title" style="margin-top:12px">Workouts that included each category</div>
        <table class="compare report">
          <tbody>${cats.map((c) => row(esc(c), cur.categories.get(c) || 0, prev.categories.get(c) || 0, count)).join('')}</tbody>
        </table>` : ''}
      <p class="stats-note" style="margin:8px 0 0">Mixed workouts count once for each type they include. Volume leaves out warm-up sets. Cardio time and distance are only what was logged on cardio sets; distances are not added across activities.${weighIns().length ? ' Body weight is the average of the weigh-ins in each period.' : ''}</p>
    </div>`;
}

/* ---------- Strength progression ---------- */

function renderStrengthInsights(items, today) {
  const list = strengthExercises(items).sort((a, b) => b.sessions.length - a.sessions.length || exName(a.id).localeCompare(exName(b.id)));
  if (!list.length) return '<div class="card card-pad stats-empty" style="margin-top:12px">No strength exercises with completed sets yet.</div>';
  const x = list.find((e) => e.id === ui.ins.ex) || list[0];
  ui.ins.ex = x.id;
  const weeks = plateauWeeks();
  const m = x.metric;
  const points = x.sessions.filter((s) => s.v[m] != null).map((s) => ({ date: s.date, value: m === 'reps' ? s.v.reps : toDisplayWeight(s.v[m]) }));
  const heaviest = bestSession(x.sessions, 'weight');
  const best1rm = bestSession(x.sessions, 'e1rm');
  const rve = recentVsEarlier(x.sessions, m);
  const reps = m === 'reps' ? [] : repsAtWeights(x.sessions);
  const check = plateauCheck(x.sessions, m, weeks, today);
  const others = list.map((e) => ({ ...e, check: plateauCheck(e.sessions, e.metric, weeks, today) })).filter((e) => e.check.status === 'possible-plateau');
  const dd = (d) => fmtDate(d, { day: 'numeric', month: 'short' });

  let plateauText;
  if (check.status === 'insufficient') {
    plateauText = `Not enough data to judge the last ${weeks} weeks: it needs at least ${PLATEAU_MIN_SESSIONS} sessions over ${PLATEAU_MIN_SPAN_DAYS}+ days in the period (logged: ${check.recentCount}) and ${PLATEAU_MIN_EARLIER} earlier sessions (logged: ${check.earlierCount}).`;
  } else if (check.status === 'improving') {
    plateauText = `Recorded progress in the last ${weeks} weeks: best ${metricName(m)} ${metricValue(m, check.bestRecent)} vs ${metricValue(m, check.bestEarlier)} before ${dd(check.from)}.`;
  } else {
    plateauText = `<b>Possible plateau.</b> No new best ${metricName(m)} in the last ${weeks} weeks (${check.recentCount} sessions since ${dd(check.from)}): best ${metricValue(m, check.bestRecent)} vs ${metricValue(m, check.bestEarlier)} earlier. This describes logged sessions only; a changed variation, technique, rep range or a deload can explain it.`;
  }

  return `
    <div class="card" style="margin-top:12px">
      <label class="field"><span>Exercise</span>
        <select id="ins-ex" aria-label="Exercise">
          ${list.map((e) => `<option value="${e.id}" ${e.id === x.id ? 'selected' : ''}>${esc(exName(e.id))}${exById(e.id)?.archived ? ' (archived)' : ''}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="card card-pad" style="margin-top:12px">
      <div class="stats-chart-title">${m === 'reps' ? 'Most reps in a set per session (bodyweight, no weight logged)' : m === 'e1rm' ? `Estimated 1RM per session (${esc(unit())})` : `Heaviest working weight per session (${esc(unit())})`}</div>
      ${lineChart(points)}
      ${m === 'e1rm' ? `<p class="stats-note" style="margin:6px 0 0">Epley formula, from working sets of 1–${E1RM_MAX_REPS} reps; warm-ups excluded.</p>` : ''}
    </div>
    <div class="stats-grid">
      ${heaviest ? `<div class="stat"><div class="num pr-num">${fmtWeight(heaviest.v.weight)} ${esc(unit())}</div><div class="lbl">Best working weight</div><div class="stat-hint">${dd(heaviest.date)}</div></div>` : ''}
      ${best1rm ? `<div class="stat"><div class="num pr-num">${fmtWeight(best1rm.v.e1rm)} ${esc(unit())}</div><div class="lbl">Best est. 1RM</div><div class="stat-hint">${dd(best1rm.date)}</div></div>` : ''}
      <div class="stat"><div class="num pr-num">${x.sessions.length}</div><div class="lbl">Sessions</div><div class="stat-hint">${dd(x.sessions[0].date)} – ${dd(x.sessions[x.sessions.length - 1].date)}</div></div>
    </div>

    <div class="section-title">Recent vs earlier sessions</div>
    <div class="card card-pad">
      ${rve ? `<div>Best ${metricName(m)} in the last ${rve.k} sessions (${dd(rve.recentFrom)} – ${dd(rve.recentTo)}): <b>${metricValue(m, rve.recent)}</b></div>
        <div>The ${rve.k} sessions before (${dd(rve.earlierFrom)} – ${dd(rve.earlierTo)}): <b>${metricValue(m, rve.earlier)}</b></div>
        <div style="margin-top:4px">${changeText(rve.recent, rve.earlier, (v) => (m === 'reps' ? fmtNum(v) : `${fmtWeight(v)} ${unit()}`))}</div>`
        : `<div class="stats-empty">Needs at least 4 sessions with ${metricName(m)} to compare (logged: ${x.sessions.filter((s) => s.v[m] != null).length}).</div>`}
    </div>

    ${m !== 'reps' ? `
    <div class="section-title">Reps at the same weight</div>
    <div class="card">
      ${reps.length ? reps.map((r) => `
        <div class="list-item"><div class="grow"><div>${fmtWeight(r.weight)} ${esc(unit())}</div><div class="sub">${r.sessions} sessions · ${dd(r.first.date)} → ${dd(r.last.date)}</div></div>
          <div class="reps-change">${r.first.reps} → <b>${r.last.reps}</b> reps</div></div>`).join('')
        : '<div class="card-pad stats-empty">No weight has been used in two or more sessions yet.</div>'}
    </div>` : ''}

    <div class="section-title">Plateau check</div>
    <div class="card card-pad">
      <div class="field" style="padding:0 0 8px">
        <span>Period</span>
        <select id="ins-plateau-weeks" class="stats-select" aria-label="Plateau check period">
          ${PLATEAU_WEEK_OPTIONS.map((w) => `<option value="${w}" ${w === weeks ? 'selected' : ''}>Last ${w} weeks</option>`).join('')}
        </select>
      </div>
      <div class="${check.status === 'possible-plateau' ? 'plateau-flag' : ''}">${plateauText}</div>
      ${others.length ? `<div class="stats-note" style="margin:8px 0 0">Possible plateaus in this period: ${others.map((e) => esc(exName(e.id))).join(', ')}.</div>` : ''}
    </div>`;
}

/* ---------- Cardio trends ---------- */

/** Small weekly bar chart. The current, unfinished week is drawn lighter and labelled as such. */
function weeklyBars(values, labels, fmt, partialLast) {
  const W = 320, H = 130, padB = 20, padT = 14;
  const max = Math.max(...values, 0);
  if (!max) return '<div class="stats-empty" style="padding:16px 0">Nothing recorded in these weeks.</div>';
  const slot = W / values.length, bw = slot * 0.62;
  const bars = values.map((v, i) => {
    const h = (v / max) * (H - padB - padT);
    const x = i * slot + (slot - bw) / 2;
    const cls = partialLast && i === values.length - 1 ? 'bar-partial' : 'bar-solid';
    return `<g><title>${esc(labels[i])}: ${esc(v ? fmt(v) : 'none')}${partialLast && i === values.length - 1 ? ' (week in progress)' : ''}</title>
      <rect class="${cls}" x="${x.toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" rx="3"/></g>
      ${(values.length - 1 - i) % 2 === 0 ? `<text class="lbl" x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${esc(labels[i])}</text>` : ''}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(values.map((v, i) => `${labels[i]}: ${v ? fmt(v) : 'none'}`).join(', '))}">
    <line class="axis" x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}"/>
    <text class="lbl" x="0" y="${padT - 3}">max ${esc(fmt(max))}</text>${bars}</svg>`;
}

function renderCardioInsights(items, today) {
  const weeks = Array.from({ length: 8 }, (_, i) => weekRange(today, 7 - i));
  const weekLabel = (w) => `${w.s.getDate()}/${w.s.getMonth() + 1}`;
  const reports = weeks.map((w) => periodReport(itemsBetween(items, w.s, w.complete ? w.e : sAddDays(today, 1))));
  const acts = [...new Set(items.flatMap((it) => it.entries.filter((e) => cardioKindOf(e.exerciseId)).map((e) => e.exerciseId)))]
    .map((id) => ({ id, sessions: exerciseSessions(items, id) })).filter((a) => a.sessions.length)
    .sort((a, b) => b.sessions.length - a.sessions.length);
  const untimed = reports.some((r) => r.cardioUntimed);
  let activity = '';
  if (acts.length) {
    const a = acts.find((x) => x.id === ui.ins.cardioEx) || acts[0];
    ui.ins.cardioEx = a.id;
    const k = cardioKindOf(a.id);
    const dist = a.sessions.filter((s) => s.v.distance != null).map((s) => ({ date: s.date, value: toDisplayDistance(s.v.distance, k) }));
    const hasPace = !!paceUnit(k);
    const speedMetric = hasPace ? 'pace' : (CARDIO_KINDS[k].speed ? 'speed' : null);
    const sp = speedMetric ? a.sessions.filter((s) => s.v[speedMetric] != null).map((s) => ({ date: s.date, value: speedMetric === 'pace' ? paceSeconds(s.v.pace, 1, k) / 60 : speedValue(s.v.speed, 1) })) : [];
    const weeklyDist = weeks.map((w, i) => (reports[i].distances.get(a.id) || 0));
    const rveDist = recentVsEarlier(a.sessions, 'distance', { average: true });
    const rveSp = speedMetric ? recentVsEarlier(a.sessions, speedMetric, { average: true }) : null;
    const dd = (d) => fmtDate(d, { day: 'numeric', month: 'short' });
    const spText = (v) => (speedMetric === 'pace' ? `${fmtClock(paceSeconds(v, 1, k))} ${paceUnit(k)}` : `${fmtNum(speedValue(v, 1))} ${speedUnit()}`);
    activity = `
      <div class="section-title">By activity</div>
      <div class="card">
        <label class="field"><span>Activity</span>
          <select id="ins-cardio" aria-label="Activity">${acts.map((x) => `<option value="${x.id}" ${x.id === a.id ? 'selected' : ''}>${esc(exName(x.id))}${exById(x.id)?.archived ? ' (archived)' : ''}</option>`).join('')}</select>
        </label>
      </div>
      <div class="card card-pad" style="margin-top:12px">
        <div class="stats-chart-title">${esc(exName(a.id))} distance per week (${distanceUnit(k)})</div>
        ${weeklyBars(weeklyDist, weeks.map(weekLabel), (m) => fmtDistance(m, k), true)}
        <div class="stats-chart-title" style="margin-top:10px">Distance per session (${distanceUnit(k)})</div>
        ${dist.length ? lineChart(dist) : `<div class="stats-empty">No distance logged for ${esc(exName(a.id))}.</div>`}
        ${speedMetric ? `
          <div class="stats-chart-title" style="margin-top:10px">${speedMetric === 'pace' ? `Pace per session (min ${paceUnit(k)}, lower is faster)` : `Speed per session (${speedUnit()})`}</div>
          ${sp.length ? lineChart(sp, speedMetric === 'pace' ? (v) => fmtClock(v * 60) : fmtNum) : '<div class="stats-empty">Needs sets with both distance and time logged.</div>'}` : ''}
      </div>
      <div class="section-title">Recent vs earlier sessions</div>
      <div class="card card-pad">
        ${rveDist ? `<div>Average distance, last ${rveDist.k} sessions: <b>${fmtDistance(rveDist.recent, k)}</b> vs <b>${fmtDistance(rveDist.earlier, k)}</b> in the ${rveDist.k} before (${dd(rveDist.earlierFrom)} – ${dd(rveDist.earlierTo)}).</div>` : '<div class="stats-empty">Distance comparison needs at least 4 sessions with distance.</div>'}
        ${speedMetric ? (rveSp ? `<div style="margin-top:6px">Average ${speedMetric}, last ${rveSp.k} sessions: <b>${spText(rveSp.recent)}</b> vs <b>${spText(rveSp.earlier)}</b> before.</div>` : `<div class="stats-empty" style="margin-top:6px">${speedMetric === 'pace' ? 'Pace' : 'Speed'} comparison needs at least 4 sessions with both distance and time.</div>`) : ''}
        <p class="stats-note" style="margin:8px 0 0">Effort, terrain, weather and route aren't recorded, so a change in pace or speed doesn't by itself show a change in fitness.</p>
      </div>`;
  }
  return `
    <div class="section-title">Cardio time per week</div>
    <div class="card card-pad">
      ${weeklyBars(reports.map((r) => r.cardioSec || 0), weeks.map(weekLabel), fmtClock, true)}
      <p class="stats-note" style="margin:6px 0 0">Time logged on cardio sets, Monday–Sunday weeks; the last bar is this week so far. A workout's total duration is never used as cardio time.${untimed ? ' Some cardio in these weeks has no time logged.' : ''}</p>
    </div>
    ${acts.length ? activity : '<div class="card card-pad stats-empty" style="margin-top:12px">No cardio logged yet. Cardio exercises record distance and time.</div>'}`;
}

/* ---------- Training balance ---------- */

/** Categories trained before but not in the last NOT_RECENT_DAYS days. */
function notRecentCategories(items, today) {
  const last = new Map();
  items.forEach((it) => it.entries.forEach((e) => {
    const c = catOf(exById(e.exerciseId));
    if (!last.has(c) || it.day > last.get(c)) last.set(c, it.day);
  }));
  const cutoff = sAddDays(today, -(NOT_RECENT_DAYS - 1));
  return [...last].filter(([, d]) => d < cutoff).map(([cat, d]) => ({ cat, last: d })).sort((a, b) => a.last - b.last);
}

function renderBalanceInsights(items, today) {
  const from = weekRange(today, BALANCE_WEEKS).s, to = weekRange(today, 0).s;
  const inWin = itemsBetween(items, from, to);
  const range = fmtRange(from, to);
  if (!inWin.length) {
    return `<div class="card card-pad stats-empty" style="margin-top:12px">No workouts in the last ${BALANCE_WEEKS} complete weeks (${range}).</div>`;
  }
  const rep = periodReport(inWin);
  const typeCounts = STAT_TYPES.map((t) => ({ t, n: inWin.filter((it) => it.entries.some((e) => entryType(e) === t.id)).length }));
  const lastByCat = new Map();
  items.forEach((it) => it.entries.forEach((e) => { const c = catOf(exById(e.exerciseId)); if (!lastByCat.has(c) || it.day > lastByCat.get(c)) lastByCat.set(c, it.day); }));
  const cats = allCategories().filter((c) => lastByCat.has(c)).map((c) => ({ c, n: rep.categories.get(c) || 0, last: lastByCat.get(c) }))
    .sort((a, b) => b.n - a.n || b.last - a.last);
  const maxN = Math.max(1, ...cats.map((x) => x.n));
  const stale = notRecentCategories(items, today);
  return `
    <div class="section-title">Activity types · last ${BALANCE_WEEKS} complete weeks</div>
    <div class="card card-pad">
      <div class="heat-sub" style="text-align:left;margin-top:0">${range} · ${inWin.length} workout${inWin.length === 1 ? '' : 's'}</div>
      ${typeCounts.map(({ t, n }) => hbar(`<i class="sw" style="background:var(--heat-${t.id})"></i>${t.label}`, `${n} of ${inWin.length}`, (n / inWin.length) * 100, '', `var(--heat-${t.id})`)).join('')}
      <p class="stats-note" style="margin:4px 0 0">Workouts that included each type; a mixed workout counts for each type it includes.</p>
    </div>

    <div class="section-title">Categories</div>
    <div class="card card-pad">
      ${cats.map((x) => hbar(esc(x.c), `${x.n} workout${x.n === 1 ? '' : 's'}`, (x.n / maxN) * 100, `Last logged ${fmtDate(x.last, { day: 'numeric', month: 'short', year: 'numeric' })}`)).join('')}
    </div>

    <div class="section-title">Not logged recently</div>
    <div class="card card-pad">
      ${stale.length ? stale.map((x) => `<div>${esc(x.cat)} <span class="muted">· last ${fmtDate(x.last, { day: 'numeric', month: 'short' })} (${sDaysBetween(x.last, today)} days ago)</span></div>`).join('')
        : `<div class="stats-empty">Every category you've trained before was logged in the last ${NOT_RECENT_DAYS} days.</div>`}
    </div>
    <p class="stats-note">Categories and logged workouts are only rough proxies for training balance. They don't measure recovery, injury risk, muscle stimulus or workout quality, and there is no single ideal number of sessions for every muscle group.</p>`;
}

/* ---------- Events ---------- */

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-iaction]');
  if (!el || ui.tab !== 'insights') return;
  if (el.dataset.iaction === 'view') { ui.ins.view = el.dataset.v; render(); window.scrollTo(0, 0); }
  if (el.dataset.iaction === 'week') { ui.ins.week = Math.max(0, ui.ins.week + Number(el.dataset.dir)); render(); }
});

document.addEventListener('change', (ev) => {
  if (ui.tab !== 'insights') return;
  const id = ev.target.id;
  if (id === 'ins-ex') ui.ins.ex = ev.target.value;
  else if (id === 'ins-cardio') ui.ins.cardioEx = ev.target.value;
  else if (id === 'ins-plateau-weeks') { state.settings.plateauWeeks = Number(ev.target.value); save(); }
  else return;
  render();
});
