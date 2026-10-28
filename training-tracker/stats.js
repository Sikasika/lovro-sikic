'use strict';

/* =========================================================
   Statistics tab: activity heatmap, summary, frequency,
   performance progress and training breakdown.
   Loaded after app.js and reuses its state, helpers
   (exById, fmtDate, startOfWeek, lineChart, summarizeSets,
   openSheet, ...) and render(). Data rules and shared
   calculations (completed workouts, valid sets, streaks,
   e1RM, sessions, units) come from calc.js.
   ========================================================= */

const STAT_TYPES = [
  { id: 'weights', label: 'Weights' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'sports', label: 'Sports' },
  { id: 'other', label: 'Other' }
];
const typeLabel = (id) => STAT_TYPES.find((t) => t.id === id)?.label ?? id;

const STAT_PERIODS = [
  { id: '7d', short: '7D', label: 'Last 7 days', days: 7 },
  { id: '30d', short: '30D', label: 'Last 30 days', days: 30 },
  { id: '90d', short: '90D', label: 'Last 90 days', days: 90 },
  { id: '12m', short: '12M', label: 'Last 12 months' },
  { id: 'all', short: 'All', label: 'All time' }
];

ui.stats = {
  filter: 'all',
  period: '30d',
  heatEnd: null, // null = ends today
  heatScroll: null,
  freqMode: 'week',
  freqCount: 12,
  perfEx: null,
  perfMetric: null,
  perfRange: 'all'
};

/* ---------- Local-date helpers (others are in calc.js) ---------- */

function sAddMonths(d, n) {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
}
const fmtHours = (min) => `${(Math.round((min / 60) * 10) / 10).toLocaleString()} h`;
const fmtMin = (min) => (min == null ? 'Unknown duration' : fmtDuration(min * 60000));

/* ---------- Data ---------- */

/** Activity type of one exercise entry, from the exercise's category. */
function entryType(entry) {
  const ex = exById(entry.exerciseId);
  if (!ex) return 'other';
  const cat = String(ex.category || '').trim().toLowerCase();
  if (cat === 'cardio') return 'cardio';
  if (cat === 'sports' || cat === 'sport') return 'sports';
  if (cat === 'other' || cat === '') return 'other';
  return 'weights';
}

/**
 * Completed workouts (shared rules in calc.js) plus the activity types each
 * contains and its primary type (most completed sets).
 */
function statsIndex() {
  const { items: base, skipped, today } = completedWorkouts();
  const items = base.map((it) => {
    const setsByType = {};
    it.entries.forEach((e) => { const t = entryType(e); setsByType[t] = (setsByType[t] || 0) + completedSets(e).length; });
    const types = STAT_TYPES.map((t) => t.id).filter((t) => setsByType[t]);
    const primary = types.reduce((a, b) => (setsByType[b] > setsByType[a] ? b : a));
    return { ...it, types, primary };
  });
  return { items, skipped, today };
}

const matchesFilter = (it, f) => f === 'all' || it.types.includes(f);

function periodRange(periodId, today, items) {
  const p = STAT_PERIODS.find((x) => x.id === periodId);
  let from;
  if (p.id === '12m') from = sAddDays(sAddMonths(today, -12), 1);
  else if (p.id === 'all') from = items.length ? items[0].day : today;
  else from = sAddDays(today, -(p.days - 1));
  return { from, to: today, days: sDaysBetween(from, today) + 1 };
}

/* ---------- Rendering ---------- */

function renderStatistics() {
  try {
    const idx = statsIndex();
    requestAnimationFrame(statsAfterRender);
    const f = ui.stats.filter;
    return `
      <div class="segmented stats-seg" role="group" aria-label="Activity filter" style="margin-top:12px">
        ${[{ id: 'all', label: 'All' }, ...STAT_TYPES].map((t) => `
          <button data-saction="filter" data-v="${t.id}" class="${f === t.id ? 'on' : ''}" aria-pressed="${f === t.id}">${t.label}</button>`).join('')}
      </div>
      ${idx.items.length ? '' : `
        <div class="card card-pad stats-empty" style="margin-top:12px">
          <div style="font-weight:600">No completed workouts yet</div>
          Finish a workout and your statistics will appear here.
        </div>`}
      ${renderHeatmap(idx)}
      ${renderSummary(idx)}
      ${renderCardioSummary(idx)}
      ${renderFrequency(idx)}
      ${renderPerformance(idx)}
      ${renderBreakdown(idx)}
      ${idx.skipped ? `<p class="stats-note">${idx.skipped} workout${idx.skipped === 1 ? ' was' : 's were'} left out because ${idx.skipped === 1 ? 'it has' : 'they have'} no completed sets or an invalid date.</p>` : ''}
    `;
  } catch (e) {
    console.error(e);
    return `
      <div class="card card-pad stats-empty" role="alert" style="margin-top:12px">
        <div style="font-weight:600">Couldn't calculate statistics</div>
        Some saved data may be in an unexpected format. Your workouts are not affected.
        <div class="btn-row"><button class="btn secondary" data-saction="retry">Try Again</button></div>
      </div>`;
  }
}

/** Re-render the tab, keeping the heatmap's horizontal scroll position. */
function statsRerender(keepScroll = true) {
  const el = $('#heat-scroll');
  ui.stats.heatScroll = keepScroll && el ? el.scrollLeft : null;
  render();
}

function statsAfterRender() {
  const el = $('#heat-scroll');
  if (!el) return;
  el.scrollLeft = ui.stats.heatScroll ?? el.scrollWidth;
  ui.stats.heatScroll = null;
}

/* ----- 1. Heatmap ----- */

const HEAT_PCT = [0, 40, 62, 82, 100];
const heatColor = (t, level) => `color-mix(in srgb, var(--heat-${t}) ${HEAT_PCT[level]}%, var(--heat-base))`;

/** Intensity from total known minutes that day: <30, 30–59, 60–89, 90+. */
function heatLevel(min) {
  if (min < 30) return 1;
  if (min < 60) return 2;
  if (min < 90) return 3;
  return 4;
}

function heatBackground(types, level) {
  if (types.length === 1) return heatColor(types[0], level);
  const step = 100 / types.length;
  return `linear-gradient(135deg, ${types.map((t, i) => `${heatColor(t, level)} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

function dayAggregates(items, f) {
  const map = new Map();
  for (const it of items) {
    if (!matchesFilter(it, f)) continue;
    const d = map.get(it.key) || { items: [], types: new Set(), min: 0, unknown: 0 };
    d.items.push(it);
    (f === 'all' ? it.types : [f]).forEach((t) => d.types.add(t));
    if (it.min == null) d.unknown++; else d.min += it.min;
    map.set(it.key, d);
  }
  return map;
}

function renderHeatmap(idx) {
  const { today } = idx;
  const f = ui.stats.filter;
  const end = ui.stats.heatEnd && ui.stats.heatEnd < today ? ui.stats.heatEnd : today;
  const start = sAddDays(sAddMonths(end, -12), 1);
  const gridStart = startOfWeek(start);
  const weeks = Math.ceil((sDaysBetween(gridStart, end) + 1) / 7);
  const days = dayAggregates(idx.items, f);
  const focusKey = sKey(end);

  let cells = '';
  const months = [];
  for (let c = 0; c < weeks; c++) {
    for (let r = 0; r < 7; r++) {
      const d = sAddDays(gridStart, c * 7 + r);
      const pos = `grid-column:${c + 1};grid-row:${r + 1}`;
      if (d < start || d > end) { cells += `<span class="heat-cell out" style="${pos}"></span>`; continue; }
      if (d.getDate() === 1 || (c === 0 && r === 0) || sKey(d) === sKey(start)) {
        if (!months.length || months[months.length - 1].c !== c) months.push({ c, label: d.toLocaleDateString(undefined, { month: 'short' }) });
      }
      const key = sKey(d);
      const agg = days.get(key);
      const isToday = key === sKey(today);
      const dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      let style = pos, label = `${dateLabel}: no workouts`;
      if (agg) {
        const types = STAT_TYPES.map((t) => t.id).filter((t) => agg.types.has(t));
        style += `;background:${heatBackground(types, heatLevel(agg.min))}`;
        label = `${dateLabel}: ${agg.items.length} workout${agg.items.length === 1 ? '' : 's'} (${types.map(typeLabel).join(', ')}), ${fmtHours(agg.min)}${agg.unknown ? `, ${agg.unknown} without duration` : ''}`;
      }
      cells += `<button class="heat-cell${agg ? '' : ' empty'}${isToday ? ' today' : ''}" style="${style}" data-saction="day" data-day="${key}"
        tabindex="${key === focusKey ? 0 : -1}" aria-label="${esc(label)}${isToday ? ' (today)' : ''}"></button>`;
    }
  }
  // Drop a month label that would collide with the next one.
  const monthLabels = months.filter((m, i) => !months[i + 1] || months[i + 1].c - m.c >= 3);

  const atToday = sKey(end) === sKey(today);
  const fmtMY = (d) => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const inRange = idx.items.filter((it) => matchesFilter(it, f) && it.day >= start && it.day <= end);
  const activeDays = new Set(inRange.map((it) => it.key)).size;

  return `
    <div class="section-title">Activity</div>
    <div class="card card-pad">
      <div class="heat-nav">
        <button class="heat-arrow" data-saction="heat-prev" aria-label="Previous 12 months">‹</button>
        <div class="heat-range" aria-live="polite">${fmtMY(start)} – ${fmtMY(end)}</div>
        <button class="heat-arrow" data-saction="heat-next" aria-label="Next 12 months" ${atToday ? 'disabled' : ''}>›</button>
      </div>
      <div class="heat-sub">
        ${inRange.length} workout${inRange.length === 1 ? '' : 's'} on ${activeDays} day${activeDays === 1 ? '' : 's'}
        ${atToday ? '' : `· <button class="link heat-today-btn" data-saction="heat-today">Jump to today</button>`}
      </div>
      <div class="heat-wrap">
        <div class="heat-days" aria-hidden="true"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
        <div class="heat-scroll" id="heat-scroll">
          <div class="heat-months" aria-hidden="true" style="grid-template-columns:repeat(${weeks}, var(--cell))">
            ${monthLabels.map((m) => `<span style="grid-column:${m.c + 1} / span 3">${esc(m.label)}</span>`).join('')}
          </div>
          <div class="heat-grid" role="group" aria-label="Workout calendar, one square per day. Use arrow keys to move between days."
            style="grid-template-columns:repeat(${weeks}, var(--cell))">${cells}</div>
        </div>
      </div>
      <div class="heat-legend">
        <div class="legend-types">
          ${STAT_TYPES.map((t) => `<span><i class="sw" style="background:var(--heat-${t.id})"></i>${t.label}</span>`).join('')}
          <span><i class="sw" style="background:linear-gradient(135deg, var(--heat-weights) 50%, var(--heat-cardio) 50%)"></i>Mixed day</span>
          <span><i class="sw today-sw"></i>Today</span>
        </div>
        <div class="legend-scale">
          <span>Shorter</span>
          ${[1, 2, 3, 4].map((l) => `<i class="sw" style="background:${heatColor(f === 'all' ? 'weights' : f, l)}" title="${['Under 30 min', '30–59 min', '60–89 min', '90+ min'][l - 1]}"></i>`).join('')}
          <span>Longer</span>
          <span class="legend-hint">&lt;30 · 30–59 · 60–89 · 90+ min per day</span>
        </div>
      </div>
    </div>`;
}

function openDaySheet(key) {
  const idx = statsIndex();
  const items = idx.items.filter((it) => it.key === key);
  const d = sFromKey(key);
  const time = (dt) => dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  openSheet(`
    <div class="sheet-head">
      <span style="width:52px"></span>
      <h2>${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      <button class="link" data-action="close-sheet">Done</button>
    </div>
    <div class="sheet-body">
      ${items.length ? items.map((it) => `
        <div class="card" style="margin-bottom:12px;padding:12px 0 6px">
          <div class="day-head">
            <div class="day-name">${esc(it.w.name || 'Workout')}</div>
            <div class="day-chips">${it.types.map((t) => `<span class="type-chip"><i class="sw" style="background:var(--heat-${t})"></i>${typeLabel(t)}</span>`).join('')}</div>
            <div class="day-meta">
              ${time(it.start)}${it.min != null ? ` – ${time(new Date(it.w.end))}` : ''} · ${fmtMin(it.min)} · ${workoutSetCount(it.w)} set${workoutSetCount(it.w) === 1 ? '' : 's'}
              ${workoutVolume(it.w) ? ` · ${fmtWeight(workoutVolume(it.w))} ${esc(unit())} volume` : ''}
            </div>
            ${it.w.location ? `<div class="day-meta">📍 ${esc(it.w.location)}</div>` : ''}
          </div>
          ${it.entries.map((e) => `
            <div class="detail-set"><span>${esc(exName(e.exerciseId))} ${catTag(e.exerciseId)}</span><span class="muted">${esc(summarizeSets(completedSets(e), cardioKindOf(e.exerciseId)))}</span></div>`).join('')}
          ${it.w.notes ? `<div class="day-notes">${esc(it.w.notes)}</div>` : ''}
        </div>`).join('') : `<div class="empty" style="padding:32px 16px">No workouts on this day.</div>`}
    </div>`);
}

/* ----- 2. Summary ----- */

function renderSummary(idx) {
  const { today } = idx;
  const f = ui.stats.filter;
  const all = idx.items.filter((it) => matchesFilter(it, f));
  const range = periodRange(ui.stats.period, today, all);
  const inPeriod = all.filter((it) => it.day >= range.from && it.day <= range.to);

  const known = inPeriod.filter((it) => it.min != null);
  const minutes = known.reduce((s, it) => s + it.min, 0);
  const weekStart = startOfWeek(today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const thisWeek = all.filter((it) => it.day >= weekStart).length;
  const thisMonth = all.filter((it) => it.day >= monthStart).length;

  // Day streaks: calendar days with at least one workout (see calc.js).
  const current = dayStreak(all, today);
  const longest = longestDayStreak(inPeriod);
  const weeks = Math.max(1, range.days / 7);
  const avg = inPeriod.length / weeks;
  const p = STAT_PERIODS.find((x) => x.id === ui.stats.period);

  const card = (value, label, hint) => `<div class="stat"><div class="num">${value}</div><div class="lbl">${label}</div>${hint ? `<div class="stat-hint">${hint}</div>` : ''}</div>`;
  return `
    <div class="section-title">Summary</div>
    <div class="segmented stats-seg" role="group" aria-label="Summary period">
      ${STAT_PERIODS.map((x) => `<button data-saction="period" data-v="${x.id}" class="${x.id === p.id ? 'on' : ''}" aria-pressed="${x.id === p.id}" aria-label="${x.label}">${x.short}</button>`).join('')}
    </div>
    <div class="stats-grid">
      ${card(inPeriod.length, 'Workouts', p.label)}
      ${card(known.length ? fmtHours(minutes) : '–', 'Training time', inPeriod.length - known.length ? `${inPeriod.length - known.length} without duration` : p.label)}
      ${card(fmtNum(avg), 'Avg / week', p.label)}
      ${card(thisWeek, 'This week', 'Since Monday')}
      ${card(thisMonth, 'This month', today.toLocaleDateString(undefined, { month: 'long' }))}
      ${card(`${current}<small> d</small>`, 'Day streak', 'Days in a row')}
      ${card(`${longest}<small> d</small>`, 'Longest day streak', p.label)}
    </div>
    ${f !== 'all' ? `<p class="stats-note">Showing workouts that include ${typeLabel(f).toLowerCase()}.</p>` : ''}`;
}

/* ----- 2b. Cardio summary ----- */

/**
 * Cardio activities in the summary period, counted per exercise even inside workouts
 * that also contain strength exercises. Distances are never added up across activities;
 * time is (it means the same thing for every activity).
 */
function renderCardioSummary(idx) {
  const f = ui.stats.filter;
  if (f !== 'all' && f !== 'cardio') return '';
  const range = periodRange(ui.stats.period, idx.today, idx.items);
  const period = STAT_PERIODS.find((x) => x.id === ui.stats.period);
  const acts = new Map();
  const workouts = new Set();
  let totalSec = 0;
  for (const it of idx.items) {
    if (it.day < range.from || it.day > range.to) continue;
    for (const e of it.entries) {
      const kind = cardioKindOf(e.exerciseId);
      if (!kind) continue;
      workouts.add(it.w.id);
      const a = acts.get(e.exerciseId) || { kind, sessions: new Set(), d: 0, t: 0, bd: 0, bt: 0 };
      a.sessions.add(it.w.id);
      completedSets(e).forEach((st) => {
        const d = num(st.distance) || 0, t = num(st.duration) || 0;
        a.d += d; a.t += t; totalSec += t;
        if (d > 0 && t > 0) { a.bd += d; a.bt += t; }
      });
      acts.set(e.exerciseId, a);
    }
  }
  if (!acts.size) {
    return `
      <div class="section-title">Cardio · ${period.label}</div>
      <div class="card card-pad stats-empty">No cardio in this period.</div>`;
  }
  const rows = [...acts].sort((x, y) => y[1].sessions.size - x[1].sessions.size).map(([id, a]) => {
    const parts = [`${a.sessions.size} session${a.sessions.size === 1 ? '' : 's'}`];
    if (a.d) parts.push(fmtDistance(a.d, a.kind));
    if (a.t) parts.push(fmtClock(a.t));
    if (a.bd && a.bt) {
      if (paceUnit(a.kind)) parts.push(`avg ${fmtClock(paceSeconds(a.bt, a.bd, a.kind))} ${paceUnit(a.kind)}`);
      else if (CARDIO_KINDS[a.kind].speed) parts.push(`avg ${fmtNum(speedValue(a.bd, a.bt))} ${speedUnit()}`);
    }
    if (!a.d && !a.t) parts.push('no distance or time logged');
    return `<div class="list-item"><div class="grow"><div>${esc(exName(id))}</div><div class="sub">${esc(parts.join(' · '))}</div></div></div>`;
  }).join('');
  return `
    <div class="section-title">Cardio · ${period.label}</div>
    <div class="stats-grid" style="margin-top:0">
      <div class="stat"><div class="num">${workouts.size}</div><div class="lbl">Workouts with cardio</div></div>
      <div class="stat"><div class="num">${totalSec ? fmtClock(totalSec) : '–'}</div><div class="lbl">Cardio time logged</div></div>
      <div class="stat"><div class="num">${acts.size}</div><div class="lbl">Activit${acts.size === 1 ? 'y' : 'ies'}</div></div>
    </div>
    <div class="card" style="margin-top:10px">${rows}</div>
    <p class="stats-note">Includes cardio done in mixed workouts. Averages use sets with both distance and time.</p>`;
}

/* ----- 3. Training frequency ----- */

const FREQ_RANGES = { week: [12, 26, 52], month: [6, 12, 24] };

function renderFrequency(idx) {
  const { today } = idx;
  const { freqMode: mode, filter: f } = ui.stats;
  const n = FREQ_RANGES[mode].includes(ui.stats.freqCount) ? ui.stats.freqCount : FREQ_RANGES[mode][0];
  const firstStart = mode === 'week'
    ? sAddDays(startOfWeek(today), -(n - 1) * 7)
    : new Date(today.getFullYear(), today.getMonth() - (n - 1), 1);
  const buckets = Array.from({ length: n }, (_, i) => {
    const s = mode === 'week' ? sAddDays(firstStart, i * 7) : new Date(firstStart.getFullYear(), firstStart.getMonth() + i, 1);
    const e = mode === 'week' ? sAddDays(s, 7) : new Date(s.getFullYear(), s.getMonth() + 1, 1);
    return { s, e, counts: {}, total: 0 };
  });
  for (const it of idx.items) {
    if (!matchesFilter(it, f) || it.day < firstStart) continue;
    const b = buckets.find((x) => it.day >= x.s && it.day < x.e);
    if (!b) continue;
    const t = f === 'all' ? it.primary : f;
    b.counts[t] = (b.counts[t] || 0) + 1;
    b.total++;
  }
  const total = buckets.reduce((s, b) => s + b.total, 0);
  const avg = total / n;
  const unitWord = mode === 'week' ? 'week' : 'month';
  const bucketLabel = (b) => (mode === 'week'
    ? `Week of ${b.s.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    : b.s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

  let chart;
  if (!total) {
    chart = `<div class="empty" style="padding:28px 12px">No workouts in this range.</div>`;
  } else {
    const W = 320, H = 170, padL = 22, padB = 22, padT = 10;
    const max = Math.max(1, ...buckets.map((b) => b.total));
    const plotH = H - padB - padT, slot = (W - padL) / n, bw = Math.max(2, slot * 0.68);
    const y = (v) => H - padB - (v / max) * plotH;
    const every = Math.ceil(n / 6);
    const bars = buckets.map((b, i) => {
      const x = padL + i * slot + (slot - bw) / 2;
      let acc = 0;
      const segs = STAT_TYPES.filter((t) => b.counts[t.id]).map((t) => {
        const v = b.counts[t.id];
        const rect = `<rect x="${x.toFixed(1)}" y="${y(acc + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(acc) - y(acc + v)).toFixed(1)}" style="fill:var(--heat-${t.id})"/>`;
        acc += v;
        return rect;
      }).join('');
      const detail = STAT_TYPES.filter((t) => b.counts[t.id]).map((t) => `${b.counts[t.id]} ${t.label.toLowerCase()}`).join(', ');
      const lbl = i % every === (n - 1) % every
        ? `<text class="lbl" x="${(i === n - 1 ? W : x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="${i === n - 1 ? 'end' : 'middle'}">${mode === 'week'
          ? `${b.s.getDate()}/${b.s.getMonth() + 1}`
          : b.s.toLocaleDateString(undefined, { month: 'short' })}</text>` : '';
      return `<g><title>${esc(bucketLabel(b))}: ${b.total} workout${b.total === 1 ? '' : 's'}${detail ? ` (${detail})` : ''}</title>${segs}</g>${lbl}`;
    }).join('');
    chart = `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="${esc(`Workouts per ${unitWord}, last ${n} ${unitWord}s: ${total} in total, average ${fmtNum(avg)} per ${unitWord}, most ${max} in one ${unitWord}.`)}">
        <line class="axis" x1="${padL}" y1="${H - padB}" x2="${W}" y2="${H - padB}"/>
        <text class="lbl" x="0" y="${y(max) + 3}">${max}</text>
        <text class="lbl" x="0" y="${H - padB + 3}">0</text>
        ${bars}
        <line class="avg-line" x1="${padL}" x2="${W}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}"/>
        <text class="lbl avg-lbl" x="${padL + 2}" y="${(y(avg) - 4).toFixed(1)}">avg ${fmtNum(avg)}</text>
      </svg>`;
  }
  const cur = buckets[n - 1].total, prev = n > 1 ? buckets[n - 2].total : 0;
  const shown = f === 'all' ? STAT_TYPES : STAT_TYPES.filter((t) => t.id === f);

  return `
    <div class="section-title">Training frequency</div>
    <div class="card card-pad">
      <div class="freq-controls">
        <div class="segmented" role="group" aria-label="Group by">
          <button data-saction="freq-mode" data-v="week" class="${mode === 'week' ? 'on' : ''}" aria-pressed="${mode === 'week'}">Weekly</button>
          <button data-saction="freq-mode" data-v="month" class="${mode === 'month' ? 'on' : ''}" aria-pressed="${mode === 'month'}">Monthly</button>
        </div>
        <select id="stats-freq-range" class="stats-select" aria-label="Date range">
          ${FREQ_RANGES[mode].map((c) => `<option value="${c}" ${c === n ? 'selected' : ''}>Last ${c} ${unitWord}s</option>`).join('')}
        </select>
      </div>
      ${chart}
      ${total ? `
        <div class="legend-types" style="margin-top:6px">
          ${shown.map((t) => `<span><i class="sw" style="background:var(--heat-${t.id})"></i>${t.label}</span>`).join('')}
          <span><i class="avg-sw"></i>Average</span>
        </div>
        <p class="stats-note" style="margin:8px 0 0">This ${unitWord}: <b>${cur}</b> · Last ${unitWord}: <b>${prev}</b> · Average: <b>${fmtNum(avg)}</b> per ${unitWord}
        ${f === 'all' ? '<br>Mixed workouts are counted under their main activity (most sets).' : ''}</p>` : ''}
    </div>`;
}

/* ----- 4. Performance progress ----- */

const PERF_RANGES = [['3m', 'Last 3 months', 3], ['6m', 'Last 6 months', 6], ['12m', 'Last 12 months', 12], ['all', 'All time']];

/*
  Metrics per session (values from exerciseSessions in calc.js). `value` converts to the
  display unit for charts, `text` formats a value for records, `chart` formats axis labels.
  Durations and paces chart in minutes and are labelled as clock times.
*/
const PERF_METRICS = {
  weight: { label: 'Heaviest weight', unit: () => unit(), value: (v) => toDisplayWeight(v), text: (v) => `${fmtWeight(v)} ${unit()}` },
  e1rm: { label: 'Estimated 1-rep max', unit: () => unit(), value: (v) => toDisplayWeight(v), text: (v) => `${fmtWeight(v)} ${unit()}` },
  volume: { label: 'Volume (weight × reps)', unit: () => unit(), value: (v) => toDisplayWeight(v), text: (v) => `${fmtWeight(v)} ${unit()}` },
  reps: { label: 'Most reps in a set', unit: () => 'reps', value: (v) => v, text: (v) => fmtNum(v) },
  totalreps: { label: 'Total reps', unit: () => 'reps', value: (v) => v, text: (v) => fmtNum(v) },
  distance: { label: 'Distance', unit: (k) => distanceUnit(k), value: (v, k) => toDisplayDistance(v, k), text: (v, k) => fmtDistance(v, k) },
  duration: { label: 'Duration', unit: () => 'h:mm:ss', value: (v) => v, text: (v) => fmtClock(v * 60), chart: (v) => fmtClock(v * 60) },
  pace: { label: 'Pace', unit: (k) => paceUnit(k), value: (v, k) => paceSeconds(v, 1, k) / 60, text: (v, k) => `${fmtClock(paceSeconds(v, 1, k))} ${paceUnit(k)}`, chart: (v) => fmtClock(v * 60), best: 'Fastest pace' },
  speed: { label: 'Speed', unit: () => speedUnit(), value: (v) => speedValue(v, 1), text: (v) => `${fmtNum(speedValue(v, 1))} ${speedUnit()}`, best: 'Top speed' }
};

function metricsFor(type, sessions, kind) {
  const has = (m) => sessions.some((s) => s.v[m] != null);
  let order;
  if (kind) {
    order = ['distance', 'duration'];
    if (paceUnit(kind)) order.push('pace');
    if (CARDIO_KINDS[kind].speed) order.push('speed');
    order.push('reps', 'totalreps');
  } else if (type === 'weights') order = ['weight', 'e1rm', 'volume', 'reps', 'totalreps', 'duration'];
  else order = ['duration', 'reps', 'totalreps'];
  return order.filter(has);
}

function renderPerformance(idx) {
  const f = ui.stats.filter;
  // Exercises that have at least one completed set, limited by the activity filter.
  const byEx = new Map();
  for (const it of idx.items) {
    for (const e of it.entries) {
      const t = entryType(e);
      if (f !== 'all' && t !== f) continue;
      const rec = byEx.get(e.exerciseId) || { id: e.exerciseId, type: t, count: 0 };
      rec.count++;
      byEx.set(e.exerciseId, rec);
    }
  }
  const list = [...byEx.values()].sort((a, b) => b.count - a.count || exName(a.id).localeCompare(exName(b.id)));

  const bodyWeight = `
    <div class="card card-pad stats-empty" style="margin-top:12px">
      <div style="font-weight:600">Body weight</div>
      Body weight isn't recorded in the app, so there's nothing to chart yet.
    </div>`;

  if (!list.length) {
    return `
      <div class="section-title">Performance</div>
      <div class="card card-pad stats-empty">No exercises with completed sets${f === 'all' ? '' : ` for ${typeLabel(f).toLowerCase()}`} yet.</div>
      ${bodyWeight}`;
  }

  const ex = list.find((x) => x.id === ui.stats.perfEx) || list[0];
  ui.stats.perfEx = ex.id;
  const allSessions = exerciseSessions(idx.items, ex.id);
  // Distance/time logged before an exercise was moved out of Cardio still chart as cardio.
  const kind = cardioKindOf(ex.id) || (allSessions.some((x) => x.v.distance != null) && !allSessions.some((x) => x.v.weight != null) ? 'other' : null);
  const metrics = metricsFor(ex.type, allSessions, kind);
  const metric = metrics.includes(ui.stats.perfMetric) ? ui.stats.perfMetric : metrics[0];
  ui.stats.perfMetric = metric || null;

  const range = PERF_RANGES.find((r) => r[0] === ui.stats.perfRange) || PERF_RANGES[3];
  const from = range[2] ? sAddMonths(idx.today, -range[2]) : null;
  const sessions = allSessions.filter((s) => !from || s.it.day >= from);
  const points = metric ? sessions.filter((s) => s.v[metric] != null).map((s) => ({ date: s.date, value: PERF_METRICS[metric].value(s.v[metric], kind) })) : [];

  // All-time personal records for this exercise.
  const prs = metrics.map((m) => {
    const s = bestSession(allSessions, m);
    let extra = '';
    if (m === 'weight') {
      const top = s.best.filter((x) => x.w === s.v.weight).reduce((a, x) => (x.r > a ? x.r : a), 0);
      if (top) extra = ` × ${top}`;
    }
    const val = esc(PERF_METRICS[m].text(s.v[m], kind)) + extra;
    return `<div class="stat"><div class="num pr-num">${val}</div><div class="lbl">${PERF_METRICS[m].best || PERF_METRICS[m].label}</div><div class="stat-hint">${fmtDate(s.date, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>`;
  }).join('');

  // Grouped by exercise category (archived exercises stay listed: their history is real).
  const groups = allCategories().map((c) => ({ label: c, exs: list.filter((x) => catOf(exById(x.id)) === c) })).filter((g) => g.exs.length);
  const metricUnit = metric ? PERF_METRICS[metric].unit(kind) : '';
  const hasDist = allSessions.some((x) => x.v.distance != null), hasPace = allSessions.some((x) => x.v.pace != null);

  return `
    <div class="section-title">Performance</div>
    <div class="card">
      <label class="field"><span>Exercise</span>
        <select id="stats-perf-ex" aria-label="Exercise">
          ${groups.map((g) => `<optgroup label="${esc(g.label)}">${g.exs.map((x) => `<option value="${x.id}" ${x.id === ex.id ? 'selected' : ''}>${esc(exName(x.id))}${exById(x.id)?.archived ? ' (archived)' : ''}</option>`).join('')}</optgroup>`).join('')}
        </select>
      </label>
      <label class="field"><span>Metric</span>
        <select id="stats-perf-metric" aria-label="Metric" ${metrics.length ? '' : 'disabled'}>
          ${metrics.length ? metrics.map((m) => `<option value="${m}" ${m === metric ? 'selected' : ''}>${PERF_METRICS[m].label}</option>`).join('') : '<option>No measurable data</option>'}
        </select>
      </label>
      <label class="field"><span>Range</span>
        <select id="stats-perf-range" aria-label="Date range">
          ${PERF_RANGES.map((r) => `<option value="${r[0]}" ${r[0] === range[0] ? 'selected' : ''}>${r[1]}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="card card-pad" style="margin-top:12px">
      ${metric ? `
        <div class="stats-chart-title">${PERF_METRICS[metric].label} per session (${esc(metricUnit)})</div>
        ${points.length ? lineChart(points, PERF_METRICS[metric].chart || fmtNum) : '<div class="empty" style="padding:24px">No sessions in this range.</div>'}
        ${metric === 'e1rm' ? `<p class="stats-note" style="margin:6px 0 0">Estimated with the Epley formula from sets of 1–${E1RM_MAX_REPS} reps.</p>` : ''}
        ${metric === 'duration' ? '<p class="stats-note" style="margin:6px 0 0">Time logged for this exercise. For older entries without a logged time, the workout\'s time is used only if it contained just this exercise.</p>' : ''}
        ${metric === 'pace' || metric === 'speed' ? '<p class="stats-note" style="margin:6px 0 0">From sets with both distance and time logged.</p>' : ''}`
        : `<div class="stats-empty">There's no measurable data for ${esc(exName(ex.id))} yet.${kind ? ' Log distance or time when you do it.' : ''}</div>`}
    </div>
    ${metrics.length ? `<div class="section-title">Personal records · ${esc(exName(ex.id))}</div><div class="stats-grid">${prs}</div>` : ''}
    ${kind && !hasDist ? `<p class="stats-note">No distance logged for ${esc(exName(ex.id))} yet, so there's no distance${paceUnit(kind) || CARDIO_KINDS[kind].speed ? ', pace or speed' : ''} to show.</p>` : ''}
    ${kind && hasDist && !hasPace && (paceUnit(kind) || CARDIO_KINDS[kind].speed) ? `<p class="stats-note">Log distance and time in the same set to see ${paceUnit(kind) ? 'pace' : 'speed'}.</p>` : ''}
    ${bodyWeight}`;
}

/* ----- 5. Training breakdown ----- */

function hbar(label, value, pct, extra = '', color = 'var(--accent)') {
  return `
    <div class="hbar">
      <div class="hbar-top"><span>${label}</span> <span class="hbar-val">${value}</span></div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(pct, pct > 0 ? 2 : 0).toFixed(1)}%;background:${color}"></div></div>
      ${extra ? `<div class="hbar-extra">${extra}</div>` : ''}
    </div>`;
}

function renderBreakdown(idx) {
  const { today } = idx;
  const f = ui.stats.filter;
  const range = periodRange(ui.stats.period, today, idx.items);
  const period = STAT_PERIODS.find((x) => x.id === ui.stats.period);
  const inPeriod = idx.items.filter((it) => it.day >= range.from && it.day <= range.to);
  if (!inPeriod.length) {
    return `
      <div class="section-title">Breakdown · ${period.label}</div>
      <div class="card card-pad stats-empty">No workouts in this period.</div>`;
  }

  // By activity type (main activity of each workout, so percentages add up to 100%).
  const types = STAT_TYPES.map((t) => {
    const ws = inPeriod.filter((it) => it.primary === t.id);
    const known = ws.filter((it) => it.min != null);
    return { t, count: ws.length, min: known.reduce((s, it) => s + it.min, 0), unknown: ws.length - known.length };
  });
  const typeRows = types.map(({ t, count, min, unknown }) => hbar(
    `<i class="sw" style="background:var(--heat-${t.id})"></i>${t.label}`,
    `${count} · ${Math.round((count / inPeriod.length) * 100)}%`,
    (count / inPeriod.length) * 100,
    count ? `${fmtHours(min)}${unknown ? ` (+${unknown} without duration)` : ''}` : '',
    `var(--heat-${t.id})`
  )).join('');

  // By day of the week (Monday first, like the rest of the app).
  const filtered = inPeriod.filter((it) => matchesFilter(it, f));
  const dow = Array(7).fill(0);
  filtered.forEach((it) => { dow[(it.day.getDay() + 6) % 7]++; });
  const dowMax = Math.max(1, ...dow);
  const dayNames = Array.from({ length: 7 }, (_, i) => sAddDays(startOfWeek(today), i).toLocaleDateString(undefined, { weekday: 'short' }));

  // Muscle groups: completed sets per exercise category for strength exercises.
  const muscles = new Map();
  if (f === 'all' || f === 'weights') {
    inPeriod.forEach((it) => it.entries.forEach((e) => {
      if (entryType(e) !== 'weights') return;
      const cat = exById(e.exerciseId)?.category || 'Other';
      muscles.set(cat, (muscles.get(cat) || 0) + completedSets(e).length);
    }));
  }
  const muscleTotal = [...muscles.values()].reduce((a, b) => a + b, 0);

  return `
    <div class="section-title">Breakdown · ${period.label}</div>
    <div class="card card-pad">
      <div class="stats-chart-title">By activity type</div>
      ${typeRows}
      <p class="stats-note" style="margin:4px 0 0">${inPeriod.length} workouts, counted by main activity. Ignores the activity filter.</p>
    </div>

    <div class="card card-pad" style="margin-top:12px">
      <div class="stats-chart-title">By day of the week${f === 'all' ? '' : ` · ${typeLabel(f)}`}</div>
      ${filtered.length ? `<div class="dow">
        ${dow.map((c, i) => `
          <div class="dow-col" role="img" aria-label="${esc(dayNames[i])}: ${c} workout${c === 1 ? '' : 's'}">
            <span class="dow-val">${c || ''}</span>
            <div class="dow-bar" style="height:${Math.round((c / dowMax) * 90)}px"></div>
            <span class="dow-lbl">${esc(dayNames[i])}</span>
          </div>`).join('')}
      </div>` : '<div class="stats-empty">No matching workouts in this period.</div>'}
    </div>

    <div class="card card-pad" style="margin-top:12px">
      <div class="stats-chart-title">Strength sets by muscle group</div>
      ${f !== 'all' && f !== 'weights'
        ? '<div class="stats-empty">Only available for weights.</div>'
        : muscleTotal
          ? [...muscles].sort((a, b) => b[1] - a[1]).map(([cat, n]) => hbar(esc(cat), `${n} sets · ${Math.round((n / muscleTotal) * 100)}%`, (n / muscleTotal) * 100)).join('')
          : '<div class="stats-empty">No strength sets in this period.</div>'}
    </div>`;
}

/* ---------- Events ---------- */

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-saction]');
  if (!el || ui.tab !== 'statistics') return;
  const s = ui.stats;
  const today = sDay(new Date());
  switch (el.dataset.saction) {
    case 'filter': s.filter = el.dataset.v; s.perfEx = null; statsRerender(); break;
    case 'period': s.period = el.dataset.v; statsRerender(); break;
    case 'heat-prev': s.heatEnd = sAddMonths(s.heatEnd || today, -12); statsRerender(false); break;
    case 'heat-next': {
      const next = sAddMonths(s.heatEnd || today, 12);
      s.heatEnd = next >= today ? null : next;
      statsRerender(false);
      break;
    }
    case 'heat-today': s.heatEnd = null; statsRerender(false); break;
    case 'day': openDaySheet(el.dataset.day); break;
    case 'freq-mode': s.freqMode = el.dataset.v; s.freqCount = FREQ_RANGES[s.freqMode][0]; statsRerender(); break;
    case 'retry': statsRerender(false); break;
  }
});

document.addEventListener('change', (ev) => {
  if (ui.tab !== 'statistics') return;
  const s = ui.stats;
  const id = ev.target.id;
  if (id === 'stats-freq-range') s.freqCount = +ev.target.value;
  else if (id === 'stats-perf-ex') { s.perfEx = ev.target.value; s.perfMetric = null; }
  else if (id === 'stats-perf-metric') s.perfMetric = ev.target.value;
  else if (id === 'stats-perf-range') s.perfRange = ev.target.value;
  else return;
  statsRerender();
});

// Arrow-key navigation between heatmap days (one tab stop for the whole grid).
document.addEventListener('keydown', (ev) => {
  const cell = ev.target.closest?.('.heat-cell[data-day]');
  if (!cell) return;
  const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[ev.key];
  if (!step) return;
  const target = document.querySelector(`.heat-cell[data-day="${sKey(sAddDays(sFromKey(cell.dataset.day), step))}"]`);
  if (!target) return;
  ev.preventDefault();
  cell.tabIndex = -1;
  target.tabIndex = 0;
  target.focus();
});
