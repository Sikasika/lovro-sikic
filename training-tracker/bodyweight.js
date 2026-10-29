'use strict';

/*
  Body weight: weigh-ins, 7-day average, target and trend chart.

  Data (all optional, so older data and backups keep working):
    state.bodyweights          [{ id, date: 'YYYY-MM-DD', kg, note? }]   one per day
    state.settings.weightGoal  { targetKg, startKg, startDate }            or absent
  Weights are stored in kg and shown/typed in the selected unit.
  Calculation rules (7-day average, change, target progress) are in calc.js.

  Shown on the Progress tab (entry, summary, target, 30-day chart, list/editor),
  in Statistics (chart with ranges) and in Insights (Body weight overview with a
  30-day chart and observations, and one weekly report row).
  Loaded before app.js; everything here runs only when called.
*/

const BW_RANGES = [['1m', '1M', 1], ['3m', '3M', 3], ['6m', '6M', 6], ['1y', '1Y', 12], ['all', 'All', null]];

const bwText = (kg) => `${fmtWeight(kg)} ${unit()}`;
const bwSigned = (kg) => `${kg > 0 ? '+' : kg < 0 ? '−' : '±'}${fmtWeight(Math.abs(kg))}`;
const todayKey = () => sKey(sDay(new Date()));
function bwDayText(key, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const d = sFromKey(key), today = sDay(new Date());
  const diff = sDaysBetween(d, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, d.getFullYear() === today.getFullYear() ? opts : { ...opts, year: 'numeric' });
}

/** "today", "yesterday" or "on Tue 27 Oct", for sentences. */
function bwDayPhrase(key) {
  const t = bwDayText(key);
  return t === 'Today' || t === 'Yesterday' ? t.toLowerCase() : `on ${t}`;
}

/** Typed weight (selected unit, comma or dot) → { kg } or { error }. */
function parseWeightInput(str) {
  const v = num(String(str ?? '').trim().replace(',', '.'));
  if (v == null) return { error: 'Enter a weight.' };
  const kg = toStoredWeight(v);
  if (!validWeightKg(kg)) return { error: `Enter a weight between ${fmtWeight(WEIGHT_MIN_KG)} and ${fmtWeight(WEIGHT_MAX_KG)} ${unit()}.` };
  return { kg };
}

/* ---------- Saving ---------- */

/**
 * Add or update a weigh-in. One per day: if another weigh-in has the same date,
 * asks before replacing it. Returns true when saved.
 */
function upsertWeighIn({ id, date, kg, note }) {
  if (!Array.isArray(state.bodyweights)) state.bodyweights = [];
  const list = state.bodyweights;
  const clash = list.find((w) => w.date === date && w.id !== id);
  if (clash && !confirm(`You already logged ${bwText(clash.kg)} ${bwDayPhrase(date)}. Replace it with ${bwText(kg)}?`)) return false;
  if (clash) list.splice(list.indexOf(clash), 1);
  const rec = { id: id || uid(), date, kg };
  const n = typeof note === 'string' ? note.trim() : '';
  if (n) rec.note = n;
  const i = id ? list.findIndex((w) => w.id === id) : -1;
  if (i >= 0) list[i] = rec; else list.push(rec);
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  save();
  return true;
}

function deleteWeighIn(id) {
  state.bodyweights = (state.bodyweights || []).filter((w) => w.id !== id);
  save();
}

/* ---------- Chart ---------- */

/**
 * Weigh-ins (dots) and their 7-day average (line) on a time axis, with the target as a
 * dashed line when it is near the data. Labels show only real values.
 * minLine: weigh-ins needed in the period for the average line. With fewer, `sparse` draws the
 * readings as dots only (no trend line); without it a short message is shown instead.
 */
function weightChart(list, { from = null, to = null, target = null, height = 170, minLine = 2, sparse = false } = {}) {
  const pts = list.filter((w) => (!from || w.day >= from) && (!to || w.day <= to));
  const withLine = pts.length >= minLine;
  if (!pts.length || (!withLine && !sparse)) {
    return `<div class="empty" style="padding:20px">${pts.length ? 'Only one weigh-in in this period. ' : 'No weigh-ins in this period. '}Log at least two to see a trend.</div>`;
  }
  const W = 320, H = height, padL = 40, padR = 10, padT = 12, padB = 20;
  const d = (kg) => toDisplayWeight(kg);
  const avg = pts.map((w) => ({ day: w.day, kg: weightAverage(list, w.day).avg }));
  const vals = [...pts.map((w) => w.kg), ...avg.map((a) => a.kg)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 1);
  const showTarget = validWeightKg(target) && target >= lo - span && target <= hi + span;
  if (showTarget) { lo = Math.min(lo, target); hi = Math.max(hi, target); }
  if (hi - lo < 1) { const m = (hi + lo) / 2; lo = m - 0.5; hi = m + 0.5; }
  const t0 = pts[0].day.getTime(), t1 = Math.max(pts[pts.length - 1].day.getTime(), t0 + 864e5);
  const x = (day) => (pts.length === 1 ? (padL + W - padR) / 2 : padL + ((day.getTime() - t0) / (t1 - t0)) * (W - padL - padR));
  const y = (kg) => padT + (1 - (kg - lo) / (hi - lo)) * (H - padT - padB);
  const line = avg.map((a, i) => `${i ? 'L' : 'M'}${x(a.day).toFixed(1)},${y(a.kg).toFixed(1)}`).join(' ');
  const minW = pts.reduce((a, w) => (w.kg < a.kg ? w : a)), maxW = pts.reduce((a, w) => (w.kg > a.kg ? w : a));
  const first = pts[0].day, last = pts[pts.length - 1].day;
  const withYear = first.getFullYear() !== last.getFullYear() || last.getFullYear() !== new Date().getFullYear();
  const dOpts = withYear ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
  const range = pts.length === 1 ? first.toLocaleDateString(undefined, dOpts) : `${first.toLocaleDateString(undefined, dOpts)} – ${last.toLocaleDateString(undefined, dOpts)}`;
  return `<svg class="chart bw-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Body weight, ${pts.length} weigh-in${pts.length === 1 ? '' : 's'}, ${esc(range)}. Lowest ${esc(bwText(minW.kg))}, highest ${esc(bwText(maxW.kg))}${withLine ? `, latest 7-day average ${esc(bwText(avg[avg.length - 1].kg))}` : ', too few for a trend line'}.">
    <line class="axis" x1="${padL}" y1="${H - padB}" x2="${W}" y2="${H - padB}"/>
    ${showTarget ? `<line class="target" x1="${padL}" y1="${y(target).toFixed(1)}" x2="${W - padR}" y2="${y(target).toFixed(1)}"/><text class="lbl target-lbl" x="${W - padR}" y="${(y(target) - 4).toFixed(1)}" text-anchor="end">Target ${fmtWeight(target)}</text>` : ''}
    <text class="lbl" x="0" y="${y(maxW.kg) + 3}">${fmtWeight(maxW.kg)}</text>
    ${minW.kg !== maxW.kg ? `<text class="lbl" x="0" y="${y(minW.kg) + 3}">${fmtWeight(minW.kg)}</text>` : ''}
    ${pts.map((w) => `<circle class="wdot" cx="${x(w.day).toFixed(1)}" cy="${y(w.kg).toFixed(1)}" r="2.6"/>`).join('')}
    ${withLine ? `<path class="line" d="${line}"/>` : ''}
    ${pts.length > 1 ? `<text class="lbl" x="${padL}" y="${H - 4}">${first.toLocaleDateString(undefined, dOpts)}</text>
    <text class="lbl" x="${W - padR}" y="${H - 4}" text-anchor="end">${last.toLocaleDateString(undefined, dOpts)}</text>` : `<text class="lbl" x="${x(first).toFixed(1)}" y="${H - 4}" text-anchor="middle">${first.toLocaleDateString(undefined, dOpts)}</text>`}
  </svg>
  <div class="chart-caption">${pts.length} weigh-in${pts.length === 1 ? '' : 's'} · ${esc(range)}<br>${withLine ? 'Dots: weigh-ins · line: 7-day average' : `Dots: weigh-ins · too few for a trend line (needs ${minLine})`}${validWeightKg(target) && !showTarget ? ` · target ${target < lo ? 'below' : 'above'} the chart` : ''}</div>`;
}

/* ---------- Progress tab ---------- */

function goalSummary(goal, t) {
  if (!goal || !validWeightKg(goal.targetKg)) {
    return `<button type="button" class="list-item" data-action="bw-goal"><span class="grow"><span>Set a target weight</span><span class="sub" style="display:block">See your progress toward a goal</span></span><span class="chev">›</span></button>`;
  }
  const p = t ? weightGoalProgress(goal, t.cur.avg) : null;
  return `
    <button type="button" class="list-item bw-goal" data-action="bw-goal" aria-label="Target ${esc(bwText(goal.targetKg))}${p ? `, ${p.reached ? 'reached' : `${fmtWeight(p.toGo)} ${unit()} to go, ${Math.round(p.pct)} percent`}` : ''}. Change target">
      <span class="grow">
        <span class="bw-goal-top"><span>Target <b>${esc(bwText(goal.targetKg))}</b></span><span class="${p?.reached ? 'bw-reached' : ''}">${p ? (p.reached ? '✓ Reached' : `${esc(bwText(p.toGo))} to go`) : 'Log a weigh-in'}</span></span>
        <span class="bw-bar" aria-hidden="true"><span style="width:${p ? Math.round(p.pct) : 0}%"></span></span>
        <span class="sub" style="display:block">${p ? `${Math.round(p.pct)}% · ` : ''}from ${esc(bwText(goal.startKg))}${goal.startDate && isDateKey(goal.startDate) ? ` on ${esc(bwDayText(goal.startDate, { day: 'numeric', month: 'short' }))}` : ''}</span>
      </span>
      <span class="chev">›</span>
    </button>`;
}

/** The Body weight block at the top of the Progress tab. */
function renderWeightCard() {
  const list = weighIns();
  const t = weightTrend(list);
  const today = todayKey();
  const loggedToday = list.find((w) => w.date === today);
  const u = esc(unit());
  return `
    <div class="section-row">
      <div class="section-title">Body weight</div>
      ${list.length ? `<button type="button" class="link small" data-action="bw-list">All weigh-ins ›</button>` : ''}
    </div>
    <div class="card bw-entry-card">
      <div class="bw-entry">
        <div class="bw-input-wrap">
          <input id="bw-quick" class="bw-input" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="${t ? esc(inputWeight(t.latest.kg)) : '0.0'}" aria-label="Today's weight in ${u}">
          <span class="bw-unit" aria-hidden="true">${u}</span>
        </div>
        <button type="button" class="btn bw-log" data-action="bw-log-today">${loggedToday ? 'Update today' : 'Log today'}</button>
      </div>
      <div class="bw-entry-sub">
        <span>${loggedToday ? `Today: <b>${esc(bwText(loggedToday.kg))}</b>` : 'Not logged today'}</span>
        <button type="button" class="link small" data-action="bw-add">Other date</button>
      </div>
    </div>
    ${t ? `
    <div class="stats" style="margin-top:10px">
      <div class="stat"><div class="num">${fmtWeight(t.latest.kg)}</div><div class="lbl">Latest (${u})</div><div class="stat-hint">${esc(bwDayText(t.latest.date))}</div></div>
      <div class="stat"><div class="num">${fmtWeight(t.cur.avg)}</div><div class="lbl">7-day avg (${u})</div><div class="stat-hint">${t.cur.n} weigh-in${t.cur.n === 1 ? '' : 's'}</div></div>
      <div class="stat"><div class="num">${t.change == null ? '–' : bwSigned(t.change)}</div><div class="lbl">Change (${u})</div><div class="stat-hint">${t.change == null ? `Needs ${WEIGHT_COMPARE_MIN}+ weigh-ins a week` : 'vs 7 days before'}</div></div>
    </div>
    <div class="card" style="margin-top:10px">${goalSummary(state.settings.weightGoal, t)}</div>
    <div class="card card-pad" style="margin-top:10px">
      <div class="stats-chart-title">Last 30 days (${u})</div>
      ${weightChart(list, { from: sAddDays(sDay(new Date()), -29), target: state.settings.weightGoal?.targetKg, height: 140 })}
    </div>` : `
    <div class="card" style="margin-top:10px">${goalSummary(state.settings.weightGoal, null)}</div>
    <p class="stats-note">Weigh yourself at a similar time each day. The 7-day average smooths out day-to-day changes from water, food and salt.</p>`}
  `;
}

/* ---------- Weigh-in list and editor (sheets) ---------- */

function openWeighInList() {
  ui.bw.back = 'list';
  const list = weighIns().reverse();
  const groups = new Map();
  for (const w of list) {
    const k = w.day.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  const all = weighIns();
  openSheet(`
    <div class="sheet-head">
      <span style="width:52px"></span>
      <h2>Weigh-ins</h2>
      <button type="button" class="link" data-action="close-sheet">Done</button>
    </div>
    <div class="sheet-body">
      <button type="button" class="btn secondary" data-action="bw-add" data-from="list">＋ Add Weigh-in</button>
      ${list.length ? [...groups].map(([month, ws]) => `
        <div class="section-title">${esc(month)}</div>
        <div class="card">
          ${ws.map((w) => `
            <button type="button" class="list-item" data-action="bw-edit" data-id="${esc(w.id)}">
              <span class="grow"><span>${esc(bwDayText(w.date))}</span>${w.note ? `<span class="sub truncate" style="display:block">${esc(w.note)}</span>` : ''}</span>
              <span class="bw-row-val"><b>${esc(bwText(w.kg))}</b><span class="sub">avg ${fmtWeight(weightAverage(all, w.day).avg)}</span></span>
              <span class="chev">›</span>
            </button>`).join('')}
        </div>`).join('') : '<div class="card card-pad stats-empty" style="margin-top:12px">No weigh-ins yet.</div>'}
      <p class="tpl-hint">“avg” is the 7-day average up to that day.</p>
    </div>`);
}

/** Add (id null) or edit a weigh-in. ui.bw.back says where Cancel/Save return to. */
function openWeighInEditor(id) {
  const w = id ? (state.bodyweights || []).find((x) => x.id === id) : null;
  if (id && !w) { openWeighInList(); return; }
  ui.bw.editId = w ? w.id : null;
  const u = esc(unit());
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="bw-cancel">Cancel</button>
      <h2>${w ? 'Edit Weigh-in' : 'Add Weigh-in'}</h2>
      <button type="button" class="link" data-action="bw-save" style="font-weight:600">Save</button>
    </div>
    <div class="sheet-body">
      <div class="card">
        <label class="field"><span>Date</span><input type="date" id="bw-date" value="${esc(w ? w.date : todayKey())}" max="${todayKey()}"></label>
        <label class="field"><span>Weight (${u})</span><input id="bw-kg" inputmode="decimal" autocomplete="off" value="${w ? esc(inputWeight(w.kg)) : ''}" placeholder="0.0"></label>
        <label class="field"><span>Note</span><input id="bw-note" autocomplete="off" value="${esc(w?.note || '')}" placeholder="Optional"></label>
      </div>
      <p class="tpl-hint">One weigh-in per day. Saving on a day that already has one asks before replacing it.</p>
      ${w ? `<div class="btn-row"><button type="button" class="btn danger" data-action="bw-delete">Delete Weigh-in</button></div>` : ''}
    </div>`);
  if (!w) setTimeout(() => $('#bw-kg')?.focus(), 300);
}

function closeWeighInEditor() {
  ui.bw.editId = null;
  if (ui.bw.back === 'list') openWeighInList(); else closeSheet();
  render();
}

function saveWeighInEditor() {
  const date = $('#bw-date')?.value || '';
  if (!isDateKey(date)) { alert('Choose a date.'); return; }
  if (date > todayKey()) { alert('The date can\'t be in the future.'); return; }
  const p = parseWeightInput($('#bw-kg')?.value);
  if (p.error) { alert(p.error); return; }
  if (!upsertWeighIn({ id: ui.bw.editId, date, kg: p.kg, note: $('#bw-note')?.value })) return;
  toast(`Saved ${bwText(p.kg)} · ${bwDayText(date)}`);
  closeWeighInEditor();
}

function openGoalEditor() {
  const g = state.settings.weightGoal;
  const t = weightTrend(weighIns());
  const start = g && validWeightKg(g.startKg) ? g.startKg : t ? t.cur.avg : null;
  const u = esc(unit());
  openSheet(`
    <div class="sheet-head">
      <button type="button" class="link" data-action="close-sheet">Cancel</button>
      <h2>Target Weight</h2>
      <button type="button" class="link" data-action="bw-goal-save" style="font-weight:600">Save</button>
    </div>
    <div class="sheet-body">
      <div class="card">
        <label class="field"><span>Target (${u})</span><input id="bw-target" inputmode="decimal" autocomplete="off" value="${g && validWeightKg(g.targetKg) ? esc(inputWeight(g.targetKg)) : ''}" placeholder="0.0"></label>
        <label class="field"><span>Starting weight (${u})</span><input id="bw-start" inputmode="decimal" autocomplete="off" value="${start != null ? esc(inputWeight(Math.round(start * 10) / 10)) : ''}" placeholder="0.0"></label>
      </div>
      <p class="tpl-hint">Progress is measured from the starting weight to the target, using your 7-day average, so one heavy or light day doesn't swing it.${t ? ` Your current 7-day average is ${esc(bwText(t.cur.avg))}.` : ''}</p>
      ${g ? '<div class="btn-row"><button type="button" class="btn danger" data-action="bw-goal-remove">Remove Target</button></div>' : ''}
    </div>`);
}

function saveGoalEditor() {
  const tg = parseWeightInput($('#bw-target')?.value);
  if (tg.error) { alert(`Target: ${tg.error}`); return; }
  const st = parseWeightInput($('#bw-start')?.value);
  if (st.error) { alert(`Starting weight: ${st.error}`); return; }
  if (Math.abs(tg.kg - st.kg) < 0.05) { alert('The target and the starting weight are the same.'); return; }
  const old = state.settings.weightGoal;
  const keepDate = old && isDateKey(old.startDate) && Math.abs(old.startKg - st.kg) < 1e-9;
  state.settings.weightGoal = { targetKg: tg.kg, startKg: st.kg, startDate: keepDate ? old.startDate : todayKey() };
  save();
  closeSheet();
  render();
  toast('Target saved');
}

/* ---------- Statistics ---------- */

function renderWeightStats() {
  const list = weighIns();
  if (!list.length) {
    return `
      <div class="section-title">Body weight</div>
      <div class="card card-pad stats-empty">No weigh-ins yet. Log your weight at the top of the Progress tab.</div>`;
  }
  const r = BW_RANGES.find((x) => x[0] === ui.bw.range) || BW_RANGES[1];
  const today = sDay(new Date());
  const from = r[2] ? sAddDays(sAddMonths(today, -r[2]), 1) : null;
  const inRange = list.filter((w) => !from || w.day >= from);
  const lo = inRange.length ? inRange.reduce((a, w) => (w.kg < a.kg ? w : a)) : null;
  const hi = inRange.length ? inRange.reduce((a, w) => (w.kg > a.kg ? w : a)) : null;
  const change = inRange.length >= 2 ? weightAverage(list, inRange[inRange.length - 1].day).avg - weightAverage(list, inRange[0].day).avg : null;
  const u = esc(unit());
  const dd = (w) => esc(bwDayText(w.date, { day: 'numeric', month: 'short' }));
  return `
    <div class="section-title">Body weight</div>
    <div class="segmented stats-seg" role="group" aria-label="Body weight range">
      ${BW_RANGES.map(([id, label]) => `<button type="button" data-action="bw-range" data-v="${id}" class="${id === r[0] ? 'on' : ''}" aria-pressed="${id === r[0]}">${label}</button>`).join('')}
    </div>
    <div class="card card-pad" style="margin-top:10px">
      <div class="stats-chart-title">Body weight (${u})</div>
      ${weightChart(list, { from, target: state.settings.weightGoal?.targetKg })}
    </div>
    ${inRange.length ? `<div class="stats-grid">
      <div class="stat"><div class="num">${change == null ? '–' : bwSigned(change)}</div><div class="lbl">Change (${u})</div><div class="stat-hint">${change == null ? 'Needs 2 weigh-ins' : '7-day avg, first to last'}</div></div>
      <div class="stat"><div class="num">${fmtWeight(lo.kg)}</div><div class="lbl">Lowest (${u})</div><div class="stat-hint">${dd(lo)}</div></div>
      <div class="stat"><div class="num">${fmtWeight(hi.kg)}</div><div class="lbl">Highest (${u})</div><div class="stat-hint">${dd(hi)}</div></div>
      <div class="stat"><div class="num">${inRange.length}</div><div class="lbl">Weigh-ins</div><div class="stat-hint">in this period</div></div>
    </div>` : ''}`;
}

/* ---------- Insights ---------- */

const bwShort = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const bwSpan = (a, b) => (sKey(a) === sKey(b) ? bwShort(a) : `${bwShort(a)}–${bwShort(b)}`);
/** Changes that round to 0.0 in the display unit count as "about the same". */
const bwSame = (kg) => Math.abs(toDisplayWeight(kg)) < 0.05;

/**
 * At most one observation linking the weight trend with one strength exercise over the same
 * 30 days (rules in calc.js). Numbers side by side only; no conclusions about why.
 */
function weightStrengthObservation(list, items) {
  if (!items?.length) return null;
  const best = strengthExercises(items)
    .map((x) => ({ x, h: weightStrengthHalves(list, x.sessions, x.metric) }))
    .filter((c) => c.h)
    .sort((a, b) => (b.h.early.sessions + b.h.late.sessions) - (a.h.early.sessions + a.h.late.sessions))[0];
  if (!best) return null;
  const { early, late } = best.h, m = best.x.metric;
  const dw = late.weight.avg - early.weight.avg;
  if (Math.abs(dw) < WEIGHT_LINK_MIN_KG) return null;
  const rel = (late.best - early.best) / early.best;
  const word = Math.abs(rel) <= 0.01 ? 'stayed about the same' : rel > 0 ? 'went up' : 'went down';
  return `${bwSpan(early.from, early.to)} vs ${bwSpan(late.from, late.to)}: average weight ${bwText(early.weight.avg)} → ${bwText(late.weight.avg)} `
    + `(${early.weight.n} and ${late.weight.n} weigh-ins), while your best ${metricName(m)} on ${exName(best.x.id)} ${word}: `
    + `${metricValue(m, early.best)} → ${metricValue(m, late.best)} (${early.sessions} and ${late.sessions} sessions). `
    + 'These are logged numbers side by side; they don\'t show why either changed.';
}

/** Short sentences about the weight trend; [] when there is too little data (the tiles explain). */
function weightObservations(list, items, wk, mo) {
  const out = [];
  if (mo.change != null) {
    const r = weightAverageRange(list);
    if (r && r.max - r.min <= WEIGHT_STABLE_RANGE_KG) {
      out.push(`Relatively stable over about 30 days: your 7-day average stayed between ${fmtWeight(r.min)} and ${bwText(r.max)} (${bwSpan(r.from, r.to)}).`);
    } else {
      out.push(bwSame(mo.change)
        ? `Over about 30 days your 7-day average ended where it started (${bwText(mo.cur.avg)}), with changes in between.`
        : `Over about 30 days your 7-day average changed by ${bwSigned(mo.change)} ${unit()}: ${bwText(mo.prev.avg)} (${bwSpan(mo.prev.from, mo.prev.to)}) → ${bwText(mo.cur.avg)} (${bwSpan(mo.cur.from, mo.cur.to)}).`);
    }
  } else if (wk.change != null) {
    out.push(bwSame(wk.change)
      ? `Your 7-day average (${bwText(wk.cur.avg)}) is about the same as in the 7 days before (${bwSpan(wk.prev.from, wk.prev.to)}).`
      : `Your 7-day average is ${fmtWeight(Math.abs(wk.change))} ${unit()} ${wk.change < 0 ? 'lower' : 'higher'} than in the 7 days before: ${bwText(wk.prev.avg)} (${bwSpan(wk.prev.from, wk.prev.to)}) → ${bwText(wk.cur.avg)} (${bwSpan(wk.cur.from, wk.cur.to)}).`);
  }
  const link = weightStrengthObservation(list, items);
  if (link) out.push(link);
  return out;
}

/** Body weight overview for Insights: summary, target, 30-day chart, observations. '' without weigh-ins. */
function renderWeightInsights(items = []) {
  const list = weighIns();
  if (!list.length) return '';
  const u = esc(unit());
  const wk = weightTrend(list, 7), mo = weightTrend(list, WEIGHT_LONG_DAYS);
  const latest = wk.latest;
  const today = sDay(new Date());
  const ago = sDaysBetween(latest.day, today);
  const goal = state.settings.weightGoal;
  const prog = goal && validWeightKg(goal.targetKg) ? weightGoalProgress(goal, wk.cur.avg) : null;
  const obs = weightObservations(list, items, wk, mo);
  const tile = (value, label, hint) => `<div class="bw-metric"><div class="bw-metric-v">${value}</div><div class="bw-metric-l">${label}</div><div class="bw-metric-h">${hint}</div></div>`;
  const prevCount = (t) => (t.prev ? t.prev.n : 0);
  return `
    <div class="section-row">
      <div class="section-title">Body weight</div>
      <button type="button" class="link small" data-action="bw-list">Weigh-ins ›</button>
    </div>
    <div class="card card-pad bw-ins">
      <div class="bw-metrics">
        ${tile(fmtWeight(latest.kg), `Latest (${u})`, esc(bwDayText(latest.date)))}
        ${tile(fmtWeight(wk.cur.avg), `7-day avg (${u})`, `${plural(wk.cur.n, 'weigh-in')} · ${esc(bwSpan(wk.cur.from, wk.cur.to))}`)}
        ${tile(wk.change == null ? '–' : bwSigned(wk.change), `7-day change (${u})`, wk.change == null
          ? `Needs ${WEIGHT_COMPARE_MIN}+ weigh-ins in both weeks (have ${wk.cur.n} and ${prevCount(wk)})`
          : `vs ${esc(bwSpan(wk.prev.from, wk.prev.to))}`)}
        ${tile(mo.change == null ? '–' : bwSigned(mo.change), `30-day change (${u})`, mo.change == null
          ? `Needs ${WEIGHT_COMPARE_MIN}+ weigh-ins around ${esc(bwShort(sAddDays(latest.day, -WEIGHT_LONG_DAYS)))} (have ${prevCount(mo)})`
          : `vs ${esc(bwSpan(mo.prev.from, mo.prev.to))}`)}
      </div>
      ${prog ? `
      <div class="bw-ins-target">
        <div class="bw-goal-top"><span>Target <b>${esc(bwText(prog.target))}</b></span><span>${prog.reached ? 'Reached' : `${esc(bwText(prog.toGo))} ${wk.cur.avg > prog.target ? 'above' : 'below'}`}</span></div>
        <span class="bw-bar" aria-hidden="true"><span style="width:${Math.round(prog.pct)}%"></span></span>
        <div class="bw-metric-h">${Math.round(prog.pct)}% of the way from ${esc(bwText(prog.start))}, using the 7-day average</div>
      </div>` : ''}
      <div class="bw-ins-chart">
        <div class="stats-chart-title">Last 30 days (${u})</div>
        ${weightChart(list, { from: sAddDays(today, -29), target: goal?.targetKg, height: 112, minLine: WEIGHT_TREND_MIN_POINTS, sparse: true })}
      </div>
      ${obs.length ? `<ul class="bw-obs">${obs.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      ${wk.change == null && mo.change == null ? `<p class="stats-note bw-ins-note">Not enough weigh-ins to compare periods yet, so no trend is reported. Comparisons use 7-day averages with at least ${WEIGHT_COMPARE_MIN} weigh-ins in each period.</p>` : ''}
      ${ago > 7 ? `<p class="stats-note bw-ins-note">Your latest weigh-in was ${ago} days ago, so these figures describe the period up to ${esc(bwShort(latest.day))}.</p>` : ''}
    </div>`;
}

/** Weight change without a percentage or up/down colour: neither direction is "good" in general. */
function weightChangeCell(d) {
  return Math.abs(toDisplayWeight(d)) < 0.05 ? '<span class="muted">same</span>' : `<span class="chg">${bwSigned(d)}</span>`;
}

/** Weekly report row: average weigh-in in each period ('' when neither has one). */
function weightReportRow(curFrom, curTo, prevFrom, prevTo) {
  const list = weighIns();
  const c = weightMeanBetween(list, curFrom, curTo), p = weightMeanBetween(list, prevFrom, prevTo);
  if (!c && !p) return '';
  const cell = (m) => (m ? fmtWeight(m.avg) : '<span class="muted">–</span>');
  return `<tr><th>Body weight avg (${esc(unit())})</th><td>${cell(c)}</td><td>${cell(p)}</td><td>${c && p ? weightChangeCell(c.avg - p.avg) : '<span class="muted">–</span>'}</td></tr>`;
}

/* ---------- Events (called from the click handler in app.js) ---------- */

function handleWeightAction(action, el) {
  switch (action) {
    case 'bw-log-today': {
      const input = $('#bw-quick');
      const p = parseWeightInput(input?.value);
      if (p.error) { toast(p.error); input?.focus(); break; }
      const date = todayKey();
      const existing = (state.bodyweights || []).find((w) => w.date === date);
      if (!upsertWeighIn({ id: null, date, kg: p.kg, note: existing?.note })) break;
      render();
      toast(`Logged ${bwText(p.kg)} for today`);
      break;
    }
    case 'bw-add': ui.bw.back = el.dataset.from === 'list' ? 'list' : 'card'; openWeighInEditor(null); break;
    case 'bw-list': openWeighInList(); break;
    case 'bw-edit': ui.bw.back = 'list'; openWeighInEditor(el.dataset.id); break;
    case 'bw-cancel': closeWeighInEditor(); break;
    case 'bw-save': saveWeighInEditor(); break;
    case 'bw-delete': {
      const w = (state.bodyweights || []).find((x) => x.id === ui.bw.editId);
      if (!w) { closeWeighInEditor(); break; }
      if (!confirm(`Delete the weigh-in of ${bwText(w.kg)} ${bwDayPhrase(w.date)}?`)) break;
      deleteWeighIn(w.id);
      toast('Weigh-in deleted');
      closeWeighInEditor();
      break;
    }
    case 'bw-goal': openGoalEditor(); break;
    case 'bw-goal-save': saveGoalEditor(); break;
    case 'bw-goal-remove':
      if (!confirm('Remove your target weight? Your weigh-ins are kept.')) break;
      delete state.settings.weightGoal;
      save(); closeSheet(); render(); toast('Target removed');
      break;
    case 'bw-range': ui.bw.range = el.dataset.v; render(); break;
    default: return false;
  }
  return true;
}
