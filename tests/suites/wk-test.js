// Workout tab redesign: flow, set completion reliability, finishing, compatibility.
// Usage: node wk-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const seed = require('./wk-seed.js');
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 700 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  let answer = true;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(seed)]);
  await page.goto('http://localhost:3000/training-tracker/');
  await go(page, 'workout'); // the app opens on Today
  const st = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const wait = (ms = 250) => page.waitForTimeout(ms);
  const settle = () => wait(500);
  const sheetOpen = () => page.isVisible('#sheet');
  const f = (e, s, k) => `#view [data-field=${k}][data-entry="${e}"][data-set="${s}"]`;
  const chk = (e, s) => `#view [data-action=toggle-set][data-entry="${e}"][data-set="${s}"]`;
  // Tap like a finger, at the centre of the element (or an offset inside it).
  const tap = async (sel, dx = 0.5, dy = 0.5) => {
    await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
    const b = await page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
    await page.touchscreen.tap(b.x + b.width * dx, b.y + b.height * dy);
  };
  // Screen and data agree for a set?
  const setState = (e, s) => page.evaluate(([k, e, s]) => {
    const d = JSON.parse(localStorage.getItem(k)).active.entries[e].sets[s].done;
    const row = document.querySelector(`#view .set-row[data-entry="${e}"][data-set="${s}"]`);
    const btn = row.querySelector('.set-check');
    return { data: !!d, row: row.classList.contains('done'), aria: btn.getAttribute('aria-pressed') === 'true' };
  }, [KEY, e, s]);
  const consistent = async (e, s, want) => { const x = await setState(e, s); return x.data === want && x.row === want && x.aria === want; };
  const addEx = async (q) => { await page.click('#view [data-action=add-exercise]'); await page.fill('#exercise-search', q); await page.click('#sheet [data-action=pick-exercise]'); await wait(); };
  const counts = () => page.innerText('#sb-count');

  /* 1. Workout tab with no active workout */
  check('1 start screen: hero + Start Workout', await page.isVisible('#view [data-action=start-flow]'), true);
  check('1 templates listed on start screen', (await page.$$eval('#view [data-kind=template] .tpl-name', (n) => n.map((x) => x.textContent))).join(), 'Push Day,Legs,Easy Run');
  check('1 no workout started, no clock', `${(await st()).active}|${await page.$('#elapsed')}`, 'null|null');
  check('1 no location anywhere on start screen', (await page.innerText('#view')).includes('City Gym'), false);

  /* 2 + 4. Choose a template and review it; clock not started before Begin */
  await page.click('#view [data-action=start-flow]'); await wait();
  check('2 chooser: templates first, empty option present', `${await page.$$eval('#sheet [data-kind=template]', (n) => n.length)}|${await page.isVisible('#sheet [data-action=start-empty]')}`, '3|true');
  check('2 opening chooser does not start', (await st()).active, null);
  await page.click('#sheet [data-action=review][data-id=t1]'); await wait();
  const review = (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  check('2 review shows template, exercises, plan', review.includes('Push Day') && review.includes('3 exercises · 9 sets') && review.includes('Warm-up 40×10') && review.includes('3 × 80×5') && review.includes('Drop 60×8') && review.includes('Pause at bottom'), true);
  check('2 review shows superset', (review.match(/SUPERSET A/gi) || []).length, 2);
  check('4 reviewing does not start the clock', `${(await st()).active}|${await page.$('#elapsed')}`, 'null|null');
  await page.click('#sheet [data-action=start-flow]'); await wait(); // Back
  check('2 Back returns to chooser, still nothing started', `${await page.isVisible('#sheet [data-action=start-empty]')}|${(await st()).active}`, 'true|null');
  await page.click('#sheet [data-action=close-sheet]'); await wait();
  check('2 Cancel: nothing started', (await st()).active, null);
  // Begin: the clock starts at Begin, not when the review opened
  await page.click('#view [data-action=review][data-id=t1]'); await wait(1600);
  const beforeBegin = Date.now();
  await page.click('#sheet [data-action=begin]'); await settle();
  let s = await st();
  const startMs = new Date(s.active.start).getTime();
  check('4 clock starts at Begin (not when review opened)', startMs >= beforeBegin - 50, true);
  check('2 template workout: 3 exercises, 9 sets, planned', `${s.active.entries.length}|${s.active.entries.reduce((n, e) => n + e.sets.length, 0)}|${s.active.templateId}`, '3|9|t1');
  check('2 template untouched, location not copied', `${JSON.stringify(s.templates[0]) === JSON.stringify(seed.templates[0])}|${'location' in s.active}`, 'true|false');
  check('2 session bar: name, clock, Finish', `${await page.inputValue('#workout-name')}|${await page.isVisible('#elapsed')}|${await page.isVisible('#view [data-action=finish]')}`, 'Push Day|true|true');
  check('2 no location field in live workout', await page.$('#workout-location'), null);
  check('2 sets start unticked, plan in placeholders', `${await page.$$eval('.set-row.done', (r) => r.length)}|${await page.getAttribute(f(0, 1, 'weight'), 'placeholder')}|${await page.inputValue(f(0, 1, 'weight'))}`, '0|80|');
  check('2 previous column shows last time', (await page.$$eval('.ex-card[data-entry="0"] .prev', (p) => p.map((x) => x.textContent))).join(), '40×10,77.5×5,77.5×5,77.5×4,–');
  check('8 set labels W,1,2,3,D', (await page.$$eval('.ex-card[data-entry="0"] .set-label', (b) => b.map((x) => x.textContent))).join(), 'W,1,2,3,D');

  /* 8. Duplicate sessions are impossible */
  const id0 = s.active.id;
  await go(page, 'history'); await wait();
  check('11 live bar on other tabs', `${await page.isVisible('#live-bar')}|${await page.innerText('#lb-name')}`, 'true|Push Day');
  await page.click('[data-action=open-workout][data-id=w3]'); await wait();
  await page.click('#sheet [data-action=repeat]'); await settle();
  s = await st();
  check('dup: Repeat while active goes to the live workout, no new session', `${s.active.id === id0}|${await page.isVisible('#session-bar')}|${await sheetOpen()}`, 'true|true|false');
  await page.evaluate(() => startWorkout()); await settle();
  check('dup: startWorkout() while active does nothing', (await st()).active.id, id0);

  /* 5. Repeated tick / untick with finger taps */
  let ok = true;
  for (let i = 0; i < 12; i++) { await tap(chk(0, 1)); if (!(await consistent(0, 1, i % 2 === 0))) { ok = false; break; } }
  check('5 12 taps on one ✓ alternate done/undone, screen = data', ok, true);
  check('5 tapping ✓ opened no menu/sheet', await sheetOpen(), false);
  // Quick double tap: two taps 120 ms apart both count
  await tap(chk(0, 2)); await wait(120); await tap(chk(0, 2));
  check('5 quick double tap = tick + untick', await consistent(0, 2, false), true);
  // Near misses: corner of the ✓ cell (outside the drawn box) still counts
  await tap(chk(0, 2), 0.05, 0.08);
  check('5 tap near the edge of the ✓ cell counts', await consistent(0, 2, true), true);
  await tap(chk(0, 2), 0.95, 0.92);
  check('5 tap at the other edge unticks', await consistent(0, 2, false), true);
  const box = await page.$eval(chk(0, 2), (el) => el.getBoundingClientRect().toJSON());
  check('5 ✓ target at least 44×44', box.width >= 44 && box.height >= 44, true);
  // Tick fills blanks from the plan placeholder (visible), unticking keeps values
  await tap(chk(0, 1)); // currently ticked after 12 taps? (even count → unticked) → now ticked
  check('5 tick fills plan values into the row', `${await page.inputValue(f(0, 1, 'weight'))}|${await page.inputValue(f(0, 1, 'reps'))}|${(await st()).active.entries[0].sets[1].weight}`, '80|5|80');
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');

  /* 6. Edit values, then tick the same set while the field still has focus */
  await page.click(f(0, 3, 'weight'));
  check('6 focusing a set field selects its text', await page.$eval(f(0, 3, 'weight'), (i) => i.selectionStart === 0 && i.selectionEnd === i.value.length), true);
  await page.keyboard.type('82.5');
  await page.click(f(0, 3, 'reps')); await page.keyboard.type('4');
  check('6 field still focused before ✓', await page.evaluate(() => document.activeElement.dataset.field), 'reps');
  await tap(chk(0, 3));
  s = await st();
  check('6 typed values kept, set ticked', `${s.active.entries[0].sets[3].weight}|${s.active.entries[0].sets[3].reps}|${await consistent(0, 3, true)}`, '82.5|4|true');
  check('6 values not overwritten by plan', await page.inputValue(f(0, 3, 'weight')), '82.5');
  await page.fill(f(0, 3, 'reps'), '3');
  check('6 editing a ticked set keeps it ticked', `${(await st()).active.entries[0].sets[3].reps}|${await consistent(0, 3, true)}`, '3|true');
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');

  /* 9. Superset + rest timer; next-set marker */
  check('9 superset cards badged', await page.$$eval('#view .ex-card .ss-badge', (b) => b.length), 2);
  await tap(chk(1, 0));
  check('9 no rest after first exercise of the round', await page.isVisible('#sb-rest'), false);
  check('9 next-set marker = first unticked set (bench still open)', await page.$eval('.set-row.next', (r) => `${r.dataset.entry}/${r.dataset.set}`), '0/0');
  check('9 next set within a superset goes round by round', await page.evaluate(() => JSON.stringify([
    nextSetPosition([{ superset: 'a', sets: [{ done: true }, { done: false }] }, { superset: 'a', sets: [{ done: false }, { done: false }] }]),
    nextSetPosition([{ superset: 'a', sets: [{ done: true }, { done: false }] }, { superset: 'a', sets: [{ done: true }, { done: false }] }]),
    nextSetPosition([{ sets: [{ done: true }] }, { sets: [{ done: true }, { done: false }] }])])), '[{"i":1,"j":0},{"i":0,"j":1},{"i":1,"j":1}]');
  await tap(chk(2, 0));
  check('9 rest starts after the round, inside the session bar', `${await page.isVisible('#sb-rest')}|${await page.isVisible('#sb-progress')}`, 'true|false');
  const r0 = await page.innerText('#sb-rest-time');
  await page.click('[data-action=rest-adjust][data-dir="15"]');
  check('9 +15 s', await page.innerText('#sb-rest-time'), (v) => { const p = (t) => t.split(':').reduce((a, b) => a * 60 + +b, 0); return p(v) - p(r0) >= 14 && p(v) - p(r0) <= 15; });

  // Rest timer never covers a set row: every visible ✓ is hittable
  const covered = await page.evaluate(() => {
    const out = [];
    for (let y = 0; y < document.body.scrollHeight; y += 60) {
      window.scrollTo(0, y);
      const barBottom = document.querySelector('#session-bar').getBoundingClientRect().bottom;
      document.querySelectorAll('#view .set-check').forEach((b) => {
        const q = b.getBoundingClientRect(); const cy = q.y + q.height / 2;
        if (cy > barBottom + 2 && cy < innerHeight - 70) { const hit = document.elementFromPoint(q.x + q.width / 2, cy); if (!b.contains(hit)) out.push(`${b.dataset.entry}/${b.dataset.set}`); }
      });
    }
    return [...new Set(out)];
  });
  check('9 no ✓ covered by rest timer or anything else at any scroll position', covered.join(), '');
  await page.click('[data-action=rest-skip]');
  check('9 skip hides rest, progress back', `${await page.isVisible('#sb-rest')}|${await page.isVisible('#sb-progress')}`, 'false|true');

  /* 8. Set types: warm-up / working / drop via the set menu */
  await page.click('#view .set-label[data-entry="0"][data-set="2"]'); await wait();
  await page.click('#sheet [data-action=set-type][data-v="drop"]'); await wait();
  check('8 change type to drop', (await page.$$eval('.ex-card[data-entry="0"] .set-label', (b) => b.map((x) => x.textContent))).join(), 'W,1,D,2,D');
  check('8 tick state survives re-render', `${await consistent(0, 1, true)}|${await consistent(0, 3, true)}`, 'true|true');

  /* 7. Add / remove sets and exercises, then tick again */
  await page.click('#view [data-action=add-set][data-entry="0"]'); await wait();
  check('7 add set → 6 rows', await page.$$eval('.ex-card[data-entry="0"] .set-row', (r) => r.length), 6);
  await tap(chk(0, 5));
  check('7 tick the new set', await consistent(0, 5, true), true);
  answer = false;
  await page.click('#view [data-action=remove-set][data-entry="0"]');
  check('7 removing a ticked set asks; cancel keeps it', `${await page.$$eval('.ex-card[data-entry="0"] .set-row', (r) => r.length)}|${dialogs.pop()?.includes('ticked')}`, '6|true');
  answer = true;
  await page.click('#view [data-action=remove-set][data-entry="0"]'); await wait();
  check('7 confirmed: 5 rows', await page.$$eval('.ex-card[data-entry="0"] .set-row', (r) => r.length), 5);
  await addEx('squat');
  check('7 new exercise added at the end', await page.$eval('.ex-card[data-entry="3"] .ex-name', (n) => n.textContent), 'Squat');
  check('7 new exercise scrolled into view below the bar', await page.$eval('.ex-card[data-entry="3"]', (c) => { const r = c.getBoundingClientRect(); return r.top >= document.querySelector('#session-bar').getBoundingClientRect().bottom - 2 && r.top < innerHeight; }), true);
  await tap(chk(3, 0));
  check('7 tick on the new exercise', `${await consistent(3, 0, true)}|${(await st()).active.entries[3].sets[0].weight}`, 'true|100');
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
  // remove the first (Cable Fly) exercise of the superset: indexes shift, ticks must follow
  await page.click('#view [data-action=entry-menu][data-entry="1"]'); await wait();
  await page.click('#sheet [data-action=remove-entry]'); await wait();
  check('7 removing an exercise with ticked sets asked first', dialogs.pop()?.includes('Cable Fly'), true);
  check('7 superset dissolved, Row now 2nd, its tick kept', `${await page.$$eval('#view .ss-badge', (b) => b.length)}|${await page.$eval('.ex-card[data-entry="1"] .ex-name', (n) => n.textContent)}|${await consistent(1, 0, true)}`, '0|Barbell Row|true');
  await tap(chk(1, 1));
  check('7 tick after removing an exercise hits the right set', `${await consistent(1, 1, true)}|${await consistent(2, 0, true)}|${await consistent(2, 1, false)}`, 'true|true|true');
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
  { const a = (await st()).active; const all = a.entries.flatMap((e) => e.sets); check('status counts match data', await counts(), `${all.filter((x) => x.done).length} of ${all.length} sets done`); }
  check('exercise status text', await page.$eval('.ex-card[data-entry="1"] .ex-status', (x) => x.textContent), '✓ Done');

  /* 10. Cardio */
  await addEx('running');
  check('10 cardio columns', (await page.$$eval('.ex-card[data-entry="3"] .set-head span', (t) => t.map((x) => x.textContent))).join('|'), 'Set|Previous|km|Time|✓');
  await page.fill(f(3, 0, 'distance'), '4,2'); await page.fill(f(3, 0, 'duration'), '21:30');
  await tap(chk(3, 0));
  s = await st();
  check('10 cardio stored in m / s, ticked', `${s.active.entries[3].sets[0].distance}|${s.active.entries[3].sets[0].duration}|${await consistent(3, 0, true)}`, '4200|1290|true');
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');

  /* 11. Navigate away and back */
  await page.evaluate(() => window.scrollTo(0, 500)); await wait();
  const y0 = await page.evaluate(() => window.scrollY);
  await go(page, 'statistics'); await wait(1200);
  check('11 live bar shows clock', /\d+:\d\d/.test(await page.innerText('#lb-time')), true);
  await page.click('#live-bar'); await wait();
  check('11 Continue returns to the live workout at the same place', `${await page.isVisible('#session-bar')}|${Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 5}`, 'true|true');
  check('11 values and ticks intact', `${await page.inputValue(f(0, 3, 'weight'))}|${await consistent(0, 3, true)}|${await consistent(3, 0, true)}`, '82.5|true|true');
  await go(page, 'progress'); await wait(); await go(page, 'workout'); await wait();
  check('11 tab bar return also restores position', Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 5, true);
  await page.reload(); await wait(600);
  check('11 survives an app restart', `${(await st()).active.id === id0}|${await consistent(0, 3, true)}`, 'true|true');
  await page.evaluate(() => window.scrollTo(0, 0));

  /* 12a. Finish → Back keeps everything (old bug: sets were wiped) */
  await page.fill(f(0, 4, 'weight'), '55'); // unticked set with a value
  const activeBefore = JSON.stringify((await st()).active);
  const tickedTypes = JSON.parse(activeBefore).entries[0].sets.filter((x) => x.done).map((x) => x.type || 'working');
  const nTicked = JSON.parse(activeBefore).entries.flatMap((e) => e.sets).filter((x) => x.done).length;
  const nPending = JSON.parse(activeBefore).entries.flatMap((e) => e.sets).filter((x) => !x.done && (+x.weight > 0 || +x.reps > 0 || +x.distance > 0 || +x.duration > 0)).length;
  await page.click('#view [data-action=finish]'); await wait();
  const fin = (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  check('12 finish summary: sets to save + pending note', fin.includes(`${nTicked} Sets to save`) && fin.includes(`${nPending} set${nPending === 1 ? ' has' : 's have'} values but`), true);
  check('12 opening Finish saved nothing yet', `${(await st()).workouts.length}|${!!(await st()).active}`, '3|true');
  await page.click('#sheet [data-action=close-sheet]'); await wait();
  check('12 Back keeps the workout unchanged', JSON.stringify((await st()).active) === activeBefore, true);
  /* 12b. Save (double-tapped) → exactly one saved workout */
  await page.click('#view [data-action=finish]'); await wait();
  await page.evaluate(() => { const b = document.querySelector('#sheet [data-action=save-workout]:not([data-include])'); b.click(); b.click(); });
  await settle();
  s = await st();
  const saved = s.workouts[0];
  check('12 saved once, workout no longer active', `${s.workouts.length}|${s.active}|${s.workouts.filter((w) => w.id === id0).length}`, '4|null|1');
  check('12 only ticked sets saved; unticked 55 kg left out', `${saved.entries.reduce((n, e) => n + e.sets.length, 0)}|${saved.entries[0].sets.some((x) => x.weight === 55)}`, `${nTicked}|false`);
  check('12 set types saved as ticked', JSON.stringify(saved.entries[0].sets.map((x) => x.type || 'working')), JSON.stringify(tickedTypes));
  check('12 saved banner on start screen', (await page.innerText('#view .saved-card')).includes('Workout saved'), true);
  await page.click('#view .saved-card [data-action=open-workout]'); await wait();
  const det = (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  check('12 History detail', det.includes('82.5 kg × 3') && det.includes('4.20 km · 21:30'), true);
  await page.click('#sheet [data-action=close-sheet]'); await wait();
  await go(page, 'history'); await wait();
  check('12 History list first', await page.$eval('[data-action=open-workout]', (b) => b.dataset.id), id0);
  await go(page, 'progress'); await wait();
  check('12 Progress counts it', (await page.innerText('#view')).replace(/\s+/g, ' ').includes('4 Total workouts'), true);
  await go(page, 'insights'); await wait();
  check('12 Insights renders', (await page.innerText('#view')).length > 50, true);
  await go(page, 'statistics'); await wait();
  check('12 Statistics renders', (await page.innerText('#view')).length > 50, true);

  /* 12c. Nothing ticked: Keep Training keeps data; Tick & Save includes values */
  await go(page, 'workout'); await wait();
  await page.click('#view [data-action=start-flow]'); await page.click('#sheet [data-action=start-empty]'); await settle();
  check('3 empty workout: empty state + Add Exercise', `${await page.isVisible('.empty-session')}|${await page.isVisible('#view [data-action=add-exercise]')}`, 'true|true');
  await addEx('bench');
  await page.fill(f(0, 0, 'weight'), '50'); await page.fill(f(0, 0, 'reps'), '10');
  await page.click('#view [data-action=finish]'); await wait();
  const fin2 = (await page.innerText('#sheet')).replace(/\s+/g, ' ');
  check('12 nothing ticked: no plain Save, offers Tick & Save', `${!!(await page.$('#sheet [data-action=save-workout]:not([data-include])'))}|${fin2.includes('No sets are ticked yet')}|${!!(await page.$('#sheet [data-include="1"]'))}`, 'false|true|true');
  await page.click('#sheet .sheet-foot [data-action=close-sheet]'); await wait();
  s = await st();
  check('12 Keep Training: exercises and values intact (old wipe bug)', `${s.active.entries.length}|${s.active.entries[0].sets[0].weight}|${s.active.entries[0].sets[0].reps}`, '1|50|10');
  await page.click('#view [data-action=finish]'); await wait();
  await page.click('#sheet [data-include="1"]'); await settle();
  s = await st();
  check('12 Tick & Save saves the set with values only', `${s.active}|${s.workouts[0].entries[0].sets.length}|${s.workouts[0].entries[0].sets[0].weight}x${s.workouts[0].entries[0].sets[0].reps}`, 'null|1|50x10');

  /* 13. Discard is deliberate */
  await page.click('#view [data-action=start-flow]'); await page.click('#sheet [data-action=review][data-id=t2]'); await wait(); await page.click('#sheet [data-action=begin]'); await settle();
  check('legacy count template starts with 3 empty sets', await page.$$eval('.set-row', (r) => r.length), 3);
  await tap(chk(0, 0));
  answer = false;
  await page.click('#view [data-action=discard]'); await settle();
  check('13 discard asks, mentions ticked sets; cancel keeps it', `${dialogs.pop()?.includes('1 ticked set')}|${!!(await st()).active}`, 'true|true');
  answer = true;
  const nW = (await st()).workouts.length;
  await page.click('#view [data-action=discard]'); await settle();
  s = await st();
  check('13 confirmed discard: nothing saved, nothing active', `${s.active}|${s.workouts.length === nW}`, 'null|true');
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');

  /* Ghost tap: a second tap right after Begin can't tick a set */
  await page.click('#view [data-action=review][data-id=t2]'); await wait();
  const pos = await page.$eval('#sheet [data-action=begin]', (b) => b.getBoundingClientRect().toJSON());
  await page.touchscreen.tap(pos.x + 20, pos.y + 10);
  await page.evaluate(() => document.querySelector('#view [data-action=toggle-set]')?.click());
  check('ghost tap right after Begin ignored', (await st()).active.entries[0].sets[0].done, false);
  await settle();
  await tap(chk(0, 0));
  check('normal tap after that works', await consistent(0, 0, true), true);
  await page.click('#view [data-action=discard]'); await settle();

  /* 14. Old in-progress workout from the previous version (has location, ticked blank set) */
  const legacy = JSON.parse(JSON.stringify(await st()));
  legacy.active = { id: 'legacy1', name: 'Old live', location: 'Old Gym', templateId: null, start: new Date(Date.now() - 600000).toISOString(), notes: '',
    entries: [{ exerciseId: 'squat', sets: [{ weight: '', reps: '', done: true }, { weight: 90, reps: '5', done: false }] }] };
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(legacy)]);
  await page.reload(); await wait(600);
  check('14 old live workout opens', `${await page.inputValue('#workout-name')}|${await consistent(0, 0, true)}`, 'Old live|true');
  await page.click('#view [data-action=finish]'); await wait();
  await page.click('#sheet [data-action=save-workout]:not([data-include])'); await settle();
  s = await st();
  const lw = s.workouts.find((w) => w.id === 'legacy1');
  check('14 blank ticked set filled from last time; location kept in data', `${lw.entries[0].sets.length}|${lw.entries[0].sets[0].weight}x${lw.entries[0].sets[0].reps}|${lw.location}`, '1|100x5|Old Gym');
  check('14 old workouts and templates still have their location', `${s.workouts.find((w) => w.id === 'w1').location}|${s.templates[0].location}`, 'City Gym|City Gym');

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`${scheme} ${width}px — PASSES: ${results.filter((r) => r.startsWith('PASS')).length}  FAILS: ${results.filter((r) => r.startsWith('FAIL')).length}`);
  await browser.close();
})();
