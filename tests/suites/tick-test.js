// Ticking sets: rows never move under a finger; unticking undoes only what the tick did.
// Taps go to fixed screen positions measured once (not re-queried after layout changes).
// Usage: node tick-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 150) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const sel = (e, s) => `[data-action=toggle-set][data-entry="${e}"][data-set="${s}"]`;
  // Scenario: last time Bench 80×5 ×3 and Row 60×8 ×3; today both with 3 empty sets.
  const setup = (opts = {}) => ev((o) => {
    localStorage.clear(); state = defaultState(); stopRest();
    const id = (n) => state.exercises.find((e) => e.name === n).id;
    const S = (w, r, k) => Array.from({ length: k }, () => ({ weight: w, reps: r, done: true }));
    if (o.history !== false) state.workouts = [{ id: 'old', name: 'Old', notes: '', start: '2026-10-20T08:00:00', end: '2026-10-20T09:00:00', entries: [{ exerciseId: id('Bench Press'), sets: S(80, 5, 3) }, { exerciseId: id('Barbell Row'), sets: S(60, 8, 3) }] }];
    const E = () => Array.from({ length: 3 }, () => ({ weight: '', reps: '', done: false }));
    state.active = { id: 'a', name: 'Push', notes: '', start: new Date(Date.now() - 600e3).toISOString(), entries: [{ exerciseId: id('Bench Press'), sets: E() }, { exerciseId: id('Barbell Row'), sets: E() }] };
    if (o.target) state.active.entries[0].sets.forEach((s) => { s.target = { weight: 70, reps: '8' }; });
    save(); ui.tab = 'workout'; render(); window.scrollTo(0, 0);
  }, opts).then(() => wait(300));
  const pos = async (s) => { const b = await page.locator(s).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const allY = () => page.$$eval('[data-action=toggle-set]', (b) => b.map((x) => Math.round(x.getBoundingClientRect().y)).join(','));
  const tapAt = async (p, gap = 120) => { await page.touchscreen.tap(p.x, p.y); await wait(gap); };
  const set = (e, s) => ev(([e, s]) => { const x = state.active.entries[e].sets[s]; return `${x.weight}|${x.reps}|${x.done}`; }, [e, s]);
  const rest = () => ev(() => !!ui.restEnd);
  const inputs = (e, s) => ev(([e, s]) => { const r = document.querySelector(`.set-row[data-entry="${e}"][data-set="${s}"]`); return `${r.querySelector('[data-field=weight]').value}|${r.querySelector('[data-field=reps]').value}`; }, [e, s]);

  /* A. Rows never move under a finger */
  for (const history of [true, false]) {
    await setup({ history });
    const y0 = await allY();
    const p = [await pos(sel(0, 0)), await pos(sel(0, 1)), await pos(sel(0, 2)), await pos(sel(1, 0))];
    await tapAt(p[0]); await tapAt(p[1]);
    const y1 = await allY();
    await tapAt(p[2]); await tapAt(p[3]);
    const y2 = await allY();
    check(`A ${history ? 'with' : 'without'} history: ticking sets moves no set row (both exercises)`, `${y0 === y1}|${y1 === y2}`, 'true|true');
    check(`A ${history ? 'with' : 'without'} history: quick taps at fixed spots tick exactly the intended sets`, (await ev(() => state.active.entries.map((e) => e.sets.map((s) => (s.done ? 1 : 0)).join('')).join(' '))), '111 100');
    await tapAt(p[1]);
    check(`A ${history ? 'with' : 'without'} history: tapping the same spot again unticks that same set`, await ev(() => state.active.entries[0].sets.map((s) => (s.done ? 1 : 0)).join('')), '101');
  }
  // The suggestion is still there, below the sets, and still usable
  await setup();
  await tapAt(await pos(sel(0, 0)));
  const prog = await ev(() => { const c = document.querySelector('.ex-card[data-entry="0"]'); const g = c.querySelector('.set-grid'), w = c.querySelector('.prog-wrap'); return { below: !!(g.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING), text: w.innerText.replace(/\s+/g, ' ') }; });
  check('A suggestion kept, now below the set rows (Last, trend and Next)', `${prog.below}|${/Last/i.test(prog.text)}|${/Next/i.test(prog.text)}`, 'true|true|true');
  await page.click('.ex-card[data-entry="0"] .rec-use'); await wait();
  check('A its "Use" button still fills the empty weights', await ev(() => state.active.entries[0].sets.slice(1).map((s) => s.weight !== '').join(',')), 'true,true');
  // The panel never shrinks during the session: controls below it stay put
  await setup();
  const foot0 = await ev(() => Math.round(document.querySelector('.ex-card[data-entry="1"]').getBoundingClientRect().y));
  const p0 = await pos(sel(0, 0));
  await tapAt(p0); await tapAt(p0); await tapAt(p0);
  const foot1 = await ev(() => Math.round(document.querySelector('.ex-card[data-entry="1"]').getBoundingClientRect().y));
  check('A the next exercise never moves up after suggestions change (no shrinking)', foot1 >= foot0, true);
  check('A layout fits the screen', await ev(() => document.documentElement.scrollWidth <= innerWidth), true);

  /* B. Unticking undoes only what the tick did */
  await setup();
  let p = await pos(sel(0, 0));
  await tapAt(p, 300);
  check('B1 tick an empty set: filled from last time (80 × 5), rest started', `${await set(0, 0)}|${await inputs(0, 0)}|${await rest()}`, '80|5|true|80|5|true');
  await tapAt(p, 300);
  check('B1 untick: the filled values are cleared and its rest stopped', `${await set(0, 0)}|${await inputs(0, 0)}|${await rest()}`, '||false|||false');
  await page.click('[data-action=finish]'); await wait(300);
  let t = (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  check('B1 Finish: nothing counted as done, no "has values but isn\'t ticked" offer', `${t.includes('No sets are ticked yet')}|${t.includes("isn't ticked")}|${!!(await page.$('#sheet [data-include="1"]'))}`, 'true|false|false');
  await ev(() => closeSheet());
  // Manual values are never cleared
  await setup();
  await page.fill('[data-field=weight][data-entry="0"][data-set="1"]', '70'); await page.fill('[data-field=reps][data-entry="0"][data-set="1"]', '6');
  p = await pos(sel(0, 1));
  await tapAt(p, 300); await tapAt(p, 300);
  check('B2 typed values: kept after tick + untick; rest stopped', `${await set(0, 1)}|${await rest()}`, '70|6|false|false');
  // Only the missing field is filled, and only that one is cleared
  await setup();
  await page.fill('[data-field=weight][data-entry="0"][data-set="2"]', '75');
  p = await pos(sel(0, 2));
  await tapAt(p, 300);
  check('B3 weight typed, reps empty: tick fills only reps', await set(0, 2), '75|5|true');
  await tapAt(p, 300);
  check('B3 untick clears only the filled reps', await set(0, 2), '75||false');
  // A filled value edited after the tick becomes the user's
  await setup();
  p = await pos(sel(0, 0));
  await tapAt(p, 300);
  await page.fill('[data-field=reps][data-entry="0"][data-set="0"]', '6');
  await tapAt(p, 300);
  check('B4 filled reps changed by hand before untick: kept; untouched filled weight cleared', await set(0, 0), '|6|false');
  // Retick and finish
  await setup();
  p = await pos(sel(0, 0));
  await tapAt(p, 300); await tapAt(p, 300); await tapAt(p, 300);
  check('B5 tick, untick, tick again: filled again, rest running', `${await set(0, 0)}|${await rest()}`, '80|5|true|true');
  await page.click('[data-action=finish]'); await wait(300);
  t = (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  check('B5 Finish: exactly one set to save', /1 Sets to save/.test(t), true);
  await page.click('#sheet [data-action=save-workout]:not([data-include])'); await wait(400);
  const saved = await ev((k) => JSON.parse(localStorage.getItem(k)).workouts.find((w) => w.id === 'a'), KEY);
  check('B5 saved: that one set, 80 × 5, with no extra fields', `${saved.entries.length}|${JSON.stringify(saved.entries[0].sets)}`, '1|[{"weight":80,"reps":"5","done":true}]');
  // Another set's rest is not stopped
  await setup();
  const a0 = await pos(sel(0, 0)), a1 = await pos(sel(0, 1));
  await tapAt(a0, 300); await tapAt(a1, 300); // the second tick's rest replaces the first
  await tapAt(a0, 300);
  check('B6 untick an earlier set: the rest started by a later set keeps running', `${await set(0, 0)}|${await set(0, 1)}|${await rest()}`, '||false|80|5|true|true');
  // Plan targets are filled and cleared the same way
  await setup({ target: true });
  p = await pos(sel(0, 0));
  await tapAt(p, 300);
  const filled = await set(0, 0);
  await tapAt(p, 300);
  check('B7 planned target filled on tick (70 × 8) and cleared on untick', `${filled}/${await set(0, 0)}`, '70|8|true/||false');
  // After a reload the tick's details are gone: unticking keeps the values (shown, not ticked)
  await setup();
  await tapAt(await pos(sel(0, 0)), 300);
  await page.reload(); await wait(400);
  await tapAt(await pos(sel(0, 0)), 300);
  check('B8 after a reload: untick keeps the values (never deletes what it can\'t attribute)', await set(0, 0), '80|5|false');

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
