// Rest timer survives reloads and the app being in the background (absolute end time, own key);
// a delayed focus never pulls the cursor out of a field the user is typing in.
// Usage: node rest-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1', REST = 'training-tracker.v1.rest';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => { try { await main(); } catch (e) { console.log(results.join('\n')); console.log('CRASH', e.stack.split('\n').slice(0, 12).join(' / ')); console.log('PASSES: 0  FAILS: 1'); process.exit(1); } })();
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 760 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 200) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const stored = () => ev((k) => JSON.parse(localStorage.getItem(k) || 'null'), REST);
  const left = () => ev(() => (ui.restEnd ? Math.round((ui.restEnd - Date.now()) / 1000) : null));
  const shown = () => ev(() => (document.querySelector('#sb-rest:not(.hidden) #sb-rest-time')?.textContent || ''));
  const toasts = () => ev(() => [...document.querySelectorAll('.toast, #toast')].map((t) => t.textContent).join(' | '));
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#session-bar *')].every((el) => el.offsetParent === null || el.getBoundingClientRect().right <= window.innerWidth + 1));
  const setup = (rest = 90) => ev((r) => {
    localStorage.clear(); state = defaultState(); stopRest(); ui.restOverPending = null; state.settings.rest = r;
    const id = state.exercises.find((e) => e.name === 'Bench Press').id;
    state.active = { id: 'a1', name: 'Push', notes: '', start: new Date(Date.now() - 600e3).toISOString(), entries: [{ exerciseId: id, sets: [0, 1, 2].map(() => ({ weight: 80, reps: '5', done: false })) }] };
    save(); ui.tapGuardUntil = 0; ui.tab = 'workout'; render();
  }, rest).then(() => wait(250));
  const tick = (s) => page.click(`[data-action=toggle-set][data-entry="0"][data-set="${s}"]`).then(() => wait(250));
  const reload = () => page.reload().then(() => wait(500));
  // Pretend the app went to the background and came back (visibilityState + the event).
  const setVisible = (v) => ev((vis) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis }); document.dispatchEvent(new Event('visibilitychange')); }, v ? 'visible' : 'hidden');

  /* 1. Start and store */
  await setup();
  const t0 = await ev(() => Date.now());
  await tick(0);
  let s = await stored();
  check('1 ticking a set starts rest and stores an absolute end time for this workout', `${s?.workoutId}|${Math.abs(s?.end - (t0 + 90000)) < 2000}|${await left()}`, (v) => /^a1\|true\|(89|90)$/.test(v));
  check('1 the session bar shows the countdown and fits the screen', `${/^1:(29|30)$/.test(await shown())}|${await noOverflow()}`, 'true|true');

  /* 2. Reload: same rest, same end time, still counting down */
  await reload();
  check('2 after a reload the rest continues (same end, not restarted)', `${await ev(() => ui.restEnd)}|${await left()}`, (v) => { const [end, l] = v.split('|'); return +end === s.end && +l <= 90 && +l >= 85; });
  check('2 the countdown is shown again', /^1:[23]\d$/.test(await shown()), true);
  // Time passed while closed: 30 s left
  await ev((k) => { const x = JSON.parse(localStorage.getItem(k)); x.end = Date.now() + 30000; localStorage.setItem(k, JSON.stringify(x)); }, REST);
  await reload();
  check('2 reopened with 30 s left: shows about 0:30', `${await left()}|${await shown()}`, (v) => /^(29|30)\|0:(29|30)$/.test(v));

  /* 3. Expired while closed: shown as over, never restarted */
  await ev((k) => { const x = JSON.parse(localStorage.getItem(k)); x.end = Date.now() - 40000; localStorage.setItem(k, JSON.stringify(x)); }, REST);
  await reload();
  check('3 ended 40 s ago: no timer, "Rest over · ended 0:40 ago", stored rest removed', `${await ev(() => ui.restEnd)}|${await shown()}|${/Rest over · ended 0:4\d ago/.test(await toasts())}|${await stored()}`, 'null||true|null');
  await ev((k) => localStorage.setItem(k, JSON.stringify({ end: Date.now() - 30 * 60000, workoutId: 'a1' })), REST);
  await reload();
  check('3 ended 30 min ago: cleared quietly (no stale message)', `${await ev(() => ui.restEnd)}|${/Rest over/.test(await toasts())}|${await stored()}`, 'null|false|null');

  /* 4. Background and back */
  await setup(); await tick(0);
  await setVisible(false);
  await ev(() => { ui.restEnd = Date.now() + 20000; storeRest(); }); // as if 70 s passed while hidden
  await setVisible(true);
  check('4 back from the background: the time left is corrected at once (0:20)', `${await shown()}|${(await stored()).end === (await ev(() => ui.restEnd))}`, (v) => /^0:(19|20)\|true$/.test(v));
  await setVisible(false);
  await ev(() => { ui.restEnd = Date.now() - 5000; tickRest(); }); // it ended while hidden
  check('4 ended while hidden: cleared, message held until the app is back', `${await ev(() => ui.restEnd)}|${await ev(() => ui.restOverPending != null)}|${await stored()}`, 'null|true|null');
  await setVisible(true); await wait(100);
  check('4 back: "Rest over · ended 0:05 ago" shown once', `${/Rest over · ended 0:0\d ago/.test(await toasts())}|${await ev(() => ui.restOverPending)}`, 'true|null');
  await setVisible(true);

  /* 5. A new rest replaces the old one; adjust and skip are stored */
  await setup(); await tick(0);
  const e1 = (await stored()).end;
  await wait(1100); await tick(1);
  const e2 = (await stored()).end;
  check('5 a new rest replaces the previous one (one stored rest, later end)', `${e2 > e1}|${await ev((k) => Object.keys(localStorage).filter((x) => x === k).length, REST)}`, 'true|1');
  await page.click('[data-action=rest-adjust][data-dir="15"]').catch(() => ev(() => document.querySelector('[data-action=rest-adjust]')?.click())); await wait(150);
  const e3 = (await stored()).end;
  check('5 +15 s is stored', e3 - e2 >= 14000 && e3 - e2 <= 16000, true);
  await page.click('[data-action=rest-skip]'); await wait(150);
  check('5 Skip clears it (nothing to restore)', `${await stored()}|${await ev(() => ui.restEnd)}`, 'null|null');
  await reload();
  check('5 after Skip + reload: no timer', await ev(() => ui.restEnd), null);

  /* 6. Finishing, discarding, unticking, another workout */
  await setup(); await tick(0);
  await page.click('[data-action=finish]'); await wait(300);
  await page.click('#sheet .save-btn[data-action=save-workout]'); await wait(400);
  check('6 finishing the workout clears the rest', `${await stored()}|${await ev(() => ui.restEnd)}`, 'null|null');
  await reload();
  check('6 and nothing comes back after a reload', await ev(() => ui.restEnd), null);
  await setup(); await tick(0);
  await page.click('[data-action=finish]'); await wait(300);
  await ev(() => discardActiveWorkout()); await wait(300);
  check('6 discarding the workout clears the rest', `${await ev(() => state.active)}|${await stored()}`, 'null|null');
  await setup(); await tick(0); await tick(0);
  check('6 unticking the set that started the rest stops and clears it', `${await stored()}|${await ev(() => ui.restEnd)}`, 'null|null');
  await setup();
  await ev((k) => localStorage.setItem(k, JSON.stringify({ end: Date.now() + 60000, workoutId: 'old-workout' })), REST);
  await reload();
  check('6 a stored rest from another workout is ignored and removed', `${await ev(() => ui.restEnd)}|${await stored()}`, 'null|null');
  await ev((k) => localStorage.setItem(k, '{broken'), REST);
  await reload();
  check('6 an unreadable stored rest is ignored', `${await ev(() => ui.restEnd)}|${await stored()}`, 'null|null');

  /* 7. Data and backups untouched; storage failures are harmless */
  await setup(); await tick(0);
  check('7 the rest is not in the saved data or in backups', await ev(() => `${'rest' in JSON.parse(localStorage.getItem('training-tracker.v1'))}|${JSON.stringify(buildBackup()).includes('restEnd')}|${Object.keys(buildBackup()).join(',')}`), 'false|false|app,kind,format,schemaVersion,exportedAt,counts,data');
  await ev((k) => { window.__si = Storage.prototype.setItem; Storage.prototype.setItem = function (a, b) { if (a === k) throw new Error('full'); return window.__si.call(this, a, b); }; }, REST);
  await tick(1);
  check('7 storage refusing the rest key: the timer still runs, no errors', `${(await left()) > 80}|${errors.length}`, 'true|0');
  await ev(() => { Storage.prototype.setItem = window.__si; });

  /* 8. Delayed focus never steals the cursor (root cause of the bw-test timeout) */
  await ev(() => { stopRest(); state.active = null; save(); ui.tab = 'body'; render(); openWeighInEditor(null); });
  await page.focus('#bw-note'); await page.keyboard.type('After dinner');
  await wait(450); // past the editor's 300 ms focus
  check('8 typing in Note right after opening Add Weigh-in: the text stays in Note, cursor stays there', await ev(() => `${document.activeElement.id}|${document.querySelector('#bw-note').value}|${document.querySelector('#bw-kg').value}`), 'bw-note|After dinner|');
  await ev(() => { closeSheet(); openWeighInEditor(null); }); await wait(450);
  check('8 without typing, the Weight field still gets the cursor', await ev(() => document.activeElement.id), 'bw-kg');
  await ev(() => closeSheet());

  // Add Exercise while a set field is still focused (Safari keeps focus on a field when a button
  // is tapped; a script click does the same here): the search takes over, nothing goes behind the sheet.
  await setup();
  await page.focus('[data-field=weight][data-entry="0"][data-set="0"]');
  await ev(() => document.querySelector('[data-action=add-exercise]').click()); // no focus change
  await wait(450);
  check('9 Add Exercise with a set field focused: the search gets the cursor', await ev(() => document.activeElement.id), 'exercise-search');
  await page.keyboard.type('Squat'); await wait(150);
  check('9 typing goes into the search, the hidden set weight is unchanged', await ev(() => `${document.querySelector('#exercise-search').value}|${state.active.entries[0].sets[0].weight}|${document.querySelector('[data-field=weight][data-entry="0"][data-set="0"]').value}`), 'Squat|80|80');
  await ev(() => closeSheet());
  await page.click('[data-action=add-exercise]'); await wait(450);
  check('9 normal tap on Add Exercise: the search gets the cursor', await ev(() => document.activeElement.id), 'exercise-search');
  await ev(() => closeSheet()); await wait(450);
  check('9 after closing the sheet nothing grabs focus', await ev(() => document.activeElement.tagName), (v) => v !== 'INPUT');
  // Typing in another field of the same sheet is still protected (Exercise editor)
  await ev(() => { state.active = null; save(); ui.tab = 'settings'; render(); openExerciseManager(); }); await wait(200);
  await page.click('[data-action=exm-new]');
  const other = await ev(() => [...document.querySelectorAll('#sheet input, #sheet select, #sheet textarea')].find((x) => x.id !== 'exd-name' && x.offsetParent && x.type !== 'checkbox' && x.type !== 'radio')?.id || '');
  if (other) {
    await page.focus(`#${other}`); await wait(450);
    check('9 Exercise editor: a field picked before the delayed focus keeps the cursor', await ev(() => document.activeElement.id), other);
  } else {
    await wait(450);
    check('9 Exercise editor: the name field gets the cursor', await ev(() => document.activeElement.id), 'exd-name');
  }
  await ev(() => closeSheet());

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
}
