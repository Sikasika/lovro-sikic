// Progression: trend vs last time + next-weight recommendation. Usage: node prog-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const L = (s) => new Date(s).toISOString();
const S = (weight, reps, extra = {}) => ({ weight, reps: String(reps), done: true, ...extra });
const W = (id, start, entries) => ({ id, name: id, notes: '', start: L(start), end: new Date(new Date(start).getTime() + 3600e3).toISOString(), entries });
const exercises = [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'pull', name: 'Pull-up', category: 'Back' }, { id: 'run', name: 'Running', category: 'Cardio' }, { id: 'row', name: 'Barbell Row', category: 'Back' }, { id: 'fly', name: 'Cable Fly', category: 'Chest' }];
const baseState = (workouts, extra = {}) => ({ schemaVersion: 2, cardioExercisesAdded: true, active: null, bodyweights: [], templates: [], exercises,
  settings: { unit: 'kg', rest: 90, theme: 'system', plateauWeeks: 6, weightStepKg: 2.5, weightStepLb: 5 }, workouts, ...extra });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:3000/training-tracker/');
  const load = async (data, tab) => {
    await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, data]);
    await page.reload(); await page.waitForTimeout(300);
    if (tab) { await page.click(`[data-tab=${tab}]`); await page.waitForTimeout(150); }
  };
  const st = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);

  /* A. Recommendation rules (pure, shared) */
  await load(baseState([]));
  const adv = (sets, step) => page.evaluate(([sets, step]) => { const a = progressionAdvice(sets, step ?? weightStep()); return a ? `${a.action}|${fmtWeight(a.load)}|${a.next == null ? '-' : fmtWeight(a.next)}` : 'none'; }, [sets, step]);
  check('A any set 13+ reps → increase', await adv([S(60, 13), S(60, 10)]), 'increase|60|62.5');
  check('A all sets at 12 → increase', await adv([S(60, 12), S(60, 12)]), 'increase|60|62.5');
  check('A two at 12, one at 11 → keep', await adv([S(60, 12), S(60, 12), S(60, 11)]), 'keep|60|-');
  check('A all below 8 → decrease', await adv([S(60, 7), S(60, 6)]), 'decrease|60|57.5');
  check('A one at 8 → keep', await adv([S(60, 7), S(60, 8)]), 'keep|60|-');
  check('A in range → keep', await adv([S(60, 10), S(60, 9)]), 'keep|60|-');
  check('A two working sets are enough', await adv([S(60, 12), S(60, 12)]), 'increase|60|62.5');
  check('A three working sets', await adv([S(60, 12), S(60, 12), S(60, 12)]), 'increase|60|62.5');
  check('A mixed weights: rules on all sets, next from the heaviest', await adv([S(60, 13), S(62.5, 9)]), 'increase|62.5|65');
  check('A mixed weights in range → keep heaviest', await adv([S(60, 12), S(62.5, 9)]), 'keep|62.5|-');
  check('A bodyweight only → no recommendation', await adv([S('', 15)]), 'none');
  check('A no working sets → none', await adv([]), 'none');
  check('A next load can\'t go to 0 → no number', await adv([S(2, 5)]), 'decrease|2|-');
  check('A custom step 2 kg', await adv([S(60, 13)], 2), 'increase|60|62');
  // From a saved workout: warm-ups, drop sets, unticked and rep-less sets never count
  check('A warm-up 20 reps and drop 20 reps ignored', await page.evaluate(() => { const w = { start: '2026-10-20T10:00:00Z', entries: [{ exerciseId: 'bench', sets: [
    { weight: 40, reps: '20', done: true, type: 'warmup' }, { weight: 60, reps: '10', done: true }, { weight: 60, reps: '10', done: true }, { weight: 40, reps: '20', done: true, type: 'drop' },
    { weight: 60, reps: '15', done: false }, { weight: 60, reps: '', done: true }] }] };
    const a = progressionAdvice(progressionSets(w, 'bench')); return `${a.action}|${progressionSets(w, 'bench').length}`; }), 'keep|2');
  check('A only warm-ups → no recommendation', await page.evaluate(() => progressionAdvice(progressionSets({ entries: [{ exerciseId: 'bench', sets: [{ weight: 40, reps: '20', done: true, type: 'warmup' }] }] }, 'bench'))), null);

  /* B. Trend rules */
  const tr = (cur, prev) => page.evaluate(([c, p]) => { const t = strengthTrend(c, p); return t ? `${t.dir}|${t.kind}${t.dr != null ? `|${t.dr}` : ''}${t.pct != null ? `|${Math.round(t.pct * 1000) / 10}` : ''}` : 'null'; }, [cur, prev]);
  check('B same weight +1 rep on best set → up', await tr([S(60, 11), S(60, 9)], [S(60, 10), S(60, 10)]), 'up|weight|1');
  check('B same weight −1 → down', await tr([S(60, 9)], [S(60, 10)]), 'down|weight|-1');
  check('B same weight same best → same', await tr([S(60, 10), S(60, 8)], [S(60, 10), S(60, 10), S(60, 10)]), 'same|weight|0');
  check('B 60×12 → 62.5×10 within ±2% → same', await tr([S(62.5, 10)], [S(60, 12)]), 'same|e1rm|-0.8');
  check('B 60×12 → 62.5×9 is −3.3% → down (by estimated strength)', await tr([S(62.5, 9)], [S(60, 12)]), 'down|e1rm|-3.3');
  check('B 60×10 → 62.5×10 → up (heavier, same reps)', await tr([S(62.5, 10)], [S(60, 10)]), 'up|heavier');
  check('B 60×12 → 70×8 → up by estimated strength (+5.6%)', await tr([S(70, 8)], [S(60, 12)]), 'up|e1rm|5.6');
  check('B lighter, more reps, similar → same', await tr([S(55, 12)], [S(60, 8)]), 'same|e1rm|1.3');
  check('B different weight with 13+ reps (not clearly better or worse) → no trend', await tr([S(50, 15)], [S(60, 10)]), 'null|unclear');
  check('B heavier with at least as many reps → up, even at 13+ reps', await tr([S(62.5, 13)], [S(60, 12)]), 'up|heavier');
  check('B lighter with no more reps → down', await tr([S(57.5, 10)], [S(60, 10)]), 'down|lighter');
  check('B weighted vs bodyweight → no trend', await tr([S('', 9)], [S(10, 6)]), 'null|unclear');
  check('B bodyweight ±1 rep', `${await tr([S('', 10)], [S('', 9)])}#${await tr([S('', 9)], [S('', 9)])}`, 'up|reps|1#same|reps|0');
  check('B nothing to compare → null', await tr([], [S(60, 10)]), 'null');

  /* C. History review */
  const hw = [
    W('w3', '2026-10-27T18:00:00+01:00', [{ exerciseId: 'bench', sets: [S(40, 10, { type: 'warmup' }), S(60, 12), S(60, 12)] }, { exerciseId: 'pull', sets: [S('', 9)] }]),
    W('w2', '2026-10-24T10:00:00+02:00', [{ exerciseId: 'row', sets: [S(50, 10)] }]),
    W('w1', '2026-10-20T18:00:00+02:00', [{ exerciseId: 'bench', sets: [S(40, 10, { type: 'warmup' }), S(60, 10), S(60, 10), S(60, 9)] }, { exerciseId: 'pull', sets: [S(10, 6)] }]),
    W('w0', '2026-10-13T18:00:00+02:00', [{ exerciseId: 'bench', sets: [S(40, 12, { type: 'warmup' })] }])
  ];
  await load(baseState(hw), 'history');
  const prog = async (id) => { await page.click(`[data-action=open-workout][data-id="${id}"]`); await page.waitForTimeout(250);
    const r = await page.$$eval('#sheet .hist-ex', (cs) => cs.map((c) => { const t = c.querySelector('.trend'), r = c.querySelector('.rec');
      return { trend: t ? `${t.className.replace('trend ', '')}|${t.innerText.replace(/\s+/g, ' ').trim()}` : '', rec: r ? `${r.className.replace('rec ', '')}|${r.innerText.replace(/\s+/g, ' ').trim().replace(/^NEXT TIME/, 'Next time').replace(/^AT THE TIME/, 'At the time')}` : '' }; }));
    await page.click('#sheet .sheet-head [data-action=close-sheet]'); await page.waitForTimeout(120); return r; };
  let p = await prog('w3');
  check('C latest: trend up, +2 reps at the same weight', p[0].trend, 'up|↑ +2 reps at 60 kg vs Tue, 20 Oct');
  check('C latest: "Next time" recommendation from this session', p[0].rec, 'rec-increase|Next time Increase weight → 62.5 kg from this session');
  check('C weighted vs bodyweight: no arrow, says why; bodyweight → no recommendation', `${p[1].trend}#${p[1].rec}`, "none|No clear trend vs Tue, 20 Oct: one session used added weight and the other bodyweight only.#");
  p = await prog('w1');
  check('C older session: warm-up-only session is not "previous" → no trend', p[0].trend, '');
  check('C older session: labelled "At the time", names the later session', p[0].rec, 'rec-keep|At the time Keep 60 kg · aim for more reps from this session · done again on Tue, 27 Oct');
  p = await prog('w0');
  check('C only warm-ups: no trend, no recommendation', `${p[0].trend}#${p[0].rec}`, '#');
  await page.click('[data-action=open-workout][data-id="w3"]'); await page.waitForTimeout(200);
  check('C recommendation has no arrow and no up/down class', await page.$$eval('#sheet .rec', (r) => r.every((x) => !x.querySelector('.trend-ic') && !/\bup\b|\bdown\b/.test(x.className) && !/[↑↓]/.test(x.textContent))), true);
  await page.click('#sheet .sheet-head [data-action=close-sheet]'); await page.waitForTimeout(120);
  // Edit the older session → later session's trend follows
  await page.click('[data-action=open-workout][data-id="w1"]'); await page.waitForTimeout(200);
  await page.click('#sheet [data-action=edit-workout]'); await page.waitForTimeout(200);
  await page.fill('#sheet input[data-wfield=reps][data-entry="0"][data-set="1"]', '13');
  await page.click('[data-action=save-wedit]'); await page.waitForTimeout(250);
  await page.click('#sheet .sheet-head [data-action=close-sheet]'); await page.waitForTimeout(150);
  p = await prog('w3');
  check('C after editing the earlier session: trend becomes down (12 vs 13)', p[0].trend, 'down|↓ −1 rep at 60 kg vs Tue, 20 Oct');

  /* D. Live workout */
  const active = { id: 'act', name: 'Today', templateId: null, start: new Date().toISOString(), notes: '', entries: [
    { exerciseId: 'bench', sets: [{ weight: '', reps: '', done: false, type: 'warmup' }, { weight: '', reps: '', done: false }, { weight: 70, reps: '', done: false }, { weight: '', reps: '', done: false }, { weight: '', reps: '', done: false, type: 'drop' }] },
    { exerciseId: 'fly', sets: [{ weight: '', reps: '', done: false }] },
    { exerciseId: 'pull', sets: [{ weight: '', reps: '', done: false }] },
    { exerciseId: 'run', sets: [{ weight: '', reps: '', done: false }] }] };
  await load(baseState(hw, { active }), 'workout');
  const panel = (i) => page.$eval(`.prog-wrap[data-prog="${i}"]`, (el) => el.innerText.replace(/\s+/g, ' ').trim().replace(/^LAST\b/, 'Last').replace(/ NEXT /, ' Next ').replace(/^NEXT /, 'Next ')).catch(() => 'none');
  check('D before ticking: last session + recommendation based on it, no trend', await panel(0), 'Last Tue, 27 Oct: 60×12, 60×12 Next Increase weight → 62.5 kg based on Tue, 27 Oct Use 62.5 kg');
  check('D no previous working sets: says so, no recommendation yet', await panel(1), 'No previous session with working sets');
  check('D cardio: no progression panel', await page.$('.prog-wrap[data-prog="3"]'), null);
  // Use: fills only empty weights of unticked working sets
  await page.click('[data-action=use-weight][data-entry="0"]'); await page.waitForTimeout(200);
  let a = (await st()).active.entries[0].sets;
  check('D Use fills empty working weights only (not warm-up, not drop, not typed 70)', JSON.stringify(a.map((s) => s.weight)), JSON.stringify(['', 62.5, 70, 62.5, '']));
  check('D Use ticks nothing', a.every((s) => !s.done), true);
  check('D inputs show the filled weight', await page.inputValue('[data-field=weight][data-entry="0"][data-set="1"]'), '62.5');
  check('D Use button disappears when nothing is left to fill', await page.$('[data-action=use-weight][data-entry="0"]'), null);
  // Ticking a warm-up or drop set does not switch to "today"
  await page.fill('[data-field=weight][data-entry="0"][data-set="0"]', '40'); await page.fill('[data-field=reps][data-entry="0"][data-set="0"]', '20');
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await page.waitForTimeout(150);
  check('D ticked warm-up (20 reps) changes nothing', await panel(0), (t) => t.includes('based on Tue, 27 Oct') && !t.includes('today'));
  // Tick a working set → trend + live recommendation
  await page.fill('[data-field=reps][data-entry="0"][data-set="1"]', '10');
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="1"]'); await page.waitForTimeout(150);
  check('D after a working set: trend today vs last + "based on today so far"', await panel(0), (t) => t.includes('↑ 62.5 kg × 10 vs 60 kg × 12 (estimated strength') === false && t.includes('today vs Tue, 27 Oct') && t.includes('Keep 62.5 kg · aim for more reps based on today so far'));
  check('D 62.5×10 vs 60×12 is within ±2% → neutral', await page.$eval('.prog-wrap[data-prog="0"] .trend', (t) => t.className), 'trend same');
  // Editing reps of a ticked set updates live
  await page.fill('[data-field=reps][data-entry="0"][data-set="1"]', '13'); await page.waitForTimeout(100);
  check('D editing a ticked set updates trend and recommendation', await panel(0), (t) => t.includes('↑') && t.includes('62.5 kg × 13 vs 60 kg × 12 (heavier, at least as many reps)') && t.includes('Increase weight → 65 kg based on today so far'));
  // Unticking returns to last-session recommendation
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="1"]'); await page.waitForTimeout(150);
  check('D unticking returns to the last-session recommendation', await panel(0), (t) => t.includes('based on Tue, 27 Oct') && !t.includes('today'));
  // New exercise without history: recommendation appears once a working set is ticked
  await page.fill('[data-field=weight][data-entry="1"][data-set="0"]', '50'); await page.fill('[data-field=reps][data-entry="1"][data-set="0"]', '6');
  await page.click('[data-action=toggle-set][data-entry="1"][data-set="0"]'); await page.waitForTimeout(150);
  check('D no history: no trend, recommendation from today', await panel(1), (t) => t.includes('No previous session') && !t.includes('↑') && !t.includes('↓') && t.includes('Decrease weight → 47.5 kg based on today so far'));
  // Bodyweight exercise: last line, trend after a tick, never a weight recommendation
  await page.fill('[data-field=reps][data-entry="2"][data-set="0"]', '9');
  await page.click('[data-action=toggle-set][data-entry="2"][data-set="0"]'); await page.waitForTimeout(150);
  check('D bodyweight: trend vs last, no recommendation', await panel(2), (t) => t.startsWith('Last Tue, 27 Oct: 9 reps') && t.includes('No significant change') && !t.includes('Next'));
  // Set ticking itself unaffected
  check('D ticking still works (data = screen)', await page.evaluate(() => state.active.entries[1].sets[0].done && document.querySelector('.set-row[data-entry="1"][data-set="0"]').classList.contains('done')), true);

  /* E. Weight step setting, units, backup */
  await page.click('[data-tab=settings]'); await page.waitForTimeout(150);
  check('E setting shows default 2.5 kg', await page.inputValue('#weight-step'), '2.5');
  await page.fill('#weight-step', '1.25'); await page.waitForTimeout(100);
  check('E step saved (kg)', (await st()).settings.weightStepKg, 1.25);
  await page.fill('#weight-step', '999'); await page.waitForTimeout(100);
  check('E out-of-range step ignored', (await st()).settings.weightStepKg, 1.25);
  await page.click('[data-action=unit][data-unit=lb]'); await page.waitForTimeout(150);
  check('E lb shows its own default 5', await page.inputValue('#weight-step'), '5');
  check('E lb: next load = current lb + 5 lb', await page.evaluate(() => { const a = progressionAdvice([{ weight: 135 * KG_PER_LB, reps: '13', done: true }]); return `${fmtWeight(a.load)}→${fmtWeight(a.next)}`; }), '135→140');
  await page.click('[data-action=unit][data-unit=kg]'); await page.waitForTimeout(150);
  const b = await page.evaluate(() => buildBackup());
  check('E backup keeps step settings', `${b.data.settings.weightStepKg}|${b.data.settings.weightStepLb}`, '1.25|5');
  check('E invalid step in a backup → warning + default', await page.evaluate((bk) => { const o = JSON.parse(JSON.stringify(bk)); o.data.settings.weightStepKg = -3; const r = validateBackup(o); return `${r.ok}|${r.state.settings.weightStepKg}|${r.warnings.some((w) => w.includes('weight step'))}`; }, b), 'true|2.5|true');
  check('E older backup without step → defaults', await page.evaluate((bk) => { const o = JSON.parse(JSON.stringify(bk)); delete o.data.settings.weightStepKg; delete o.data.settings.weightStepLb; const r = validateBackup(o); return `${r.state.settings.weightStepKg}|${r.state.settings.weightStepLb}`; }, b), '2.5|5');
  check('E data format unchanged: workouts untouched', JSON.stringify((await st()).workouts.map((w) => w.id)), JSON.stringify(['w3', 'w2', 'w1', 'w0']));

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`${scheme} ${width}px — PASSES: ${results.filter((r) => r.startsWith('PASS')).length}  FAILS: ${results.filter((r) => r.startsWith('FAIL')).length}`);
  await browser.close();
})();
