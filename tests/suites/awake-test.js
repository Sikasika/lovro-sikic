// Keep screen awake during workouts and the rest-timer sound. Usage: node awake-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

const NOW = new Date('2026-11-10T09:00:00+01:00');
const exercises = [{ id: 'bench', name: 'Bench Press', category: 'Chest' }];
const active = (id = 'act1', sets = 3) => ({ id, name: 'Push', notes: '', start: new Date(NOW.getTime() - 600e3).toISOString(),
  entries: [{ exerciseId: 'bench', sets: Array.from({ length: sets }, () => ({ weight: 60, reps: '8', done: false })) }] });
const base = (extra = {}) => ({ schemaVersion: 2, cardioExercisesAdded: true, active: null, bodyweights: [], templates: [], plans: [], exercises, workouts: [],
  settings: { unit: 'kg', rest: 60, theme: 'system', plateauWeeks: 6 }, ...extra });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  // Simulated wake lock, page visibility and Web Audio, chosen per test through separate keys.
  await ctx.addInitScript(() => {
    const wakeMode = localStorage.getItem('__wake') || 'ok';
    const audioMode = localStorage.getItem('__audio') || 'ok';
    const T = window.__t = { requests: 0, held: 0, releases: 0, vis: 'visible', ctxCreated: 0, resumes: 0, beeps: 0, silent: 0 };
    Object.defineProperty(document, 'visibilityState', { get: () => T.vis, configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => T.vis !== 'visible', configurable: true });
    window.__setVis = (v) => {
      T.vis = v;
      if (v === 'hidden') (T.sentinels || []).forEach((s) => s.__drop()); // browsers drop the lock when hidden
      document.dispatchEvent(new Event('visibilitychange'));
    };
    if (wakeMode === 'unsupported') Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
    else Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (type) => {
      T.requests++;
      if (type !== 'screen') throw new TypeError('type');
      if (wakeMode === 'denied') { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; }
      if (wakeMode === 'error') throw new Error('boom');
      if (T.vis !== 'visible') { const e = new Error('hidden'); e.name = 'NotAllowedError'; throw e; }
      const s = new EventTarget(); s.released = false; T.held++;
      s.__drop = () => { if (!s.released) { s.released = true; T.held--; s.dispatchEvent(new Event('release')); } };
      s.release = async () => { if (!s.released) T.releases++; s.__drop(); };
      (T.sentinels = T.sentinels || []).push(s);
      return s;
    } } });
    if (audioMode === 'none') { window.AudioContext = undefined; window.webkitAudioContext = undefined; return; }
    class FakeParam { constructor() { this.value = 0; this.max = 0; } setValueAtTime(v) { this.value = v; this.max = Math.max(this.max, v); } exponentialRampToValueAtTime(v) { this.max = Math.max(this.max, v); } }
    class FakeNode { connect(n) { this.to = n; } }
    window.AudioContext = class {
      constructor() { if (audioMode === 'throw') throw new Error('no audio'); T.ctxCreated++; this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
      resume() { T.resumes++; if (audioMode === 'stuck') return Promise.reject(new Error('not allowed')); this.state = 'running'; return Promise.resolve(); }
      createGain() { const g = new FakeNode(); g.gain = new FakeParam(); return g; }
      createOscillator() {
        const o = new FakeNode(); o.frequency = { value: 0 };
        o.start = () => { if (audioMode === 'playfail') throw new Error('play failed'); const g = o.to; if (g && (g.gain.max > 0 || g.gain.value > 0)) T.beeps++; else T.silent++; };
        o.stop = () => {}; return o;
      }
    };
    window.webkitAudioContext = undefined;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.clock.install({ time: NOW });
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = async (ms = 250) => { await page.clock.runFor(ms); await page.waitForTimeout(30); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const T = () => ev(() => ({ ...window.__t, sentinels: undefined }));
  const load = async (data, wakeMode = 'ok', audioMode = 'ok') => {
    await ev(([k, v, w, a]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('__wake', w); localStorage.setItem('__audio', a); }, [KEY, data, wakeMode, audioMode]);
    await page.reload(); await wait(400);
  };
  const stored = () => ev((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const tick = async (si) => { await page.click(`[data-action=toggle-set][data-entry="0"][data-set="${si}"]`); await wait(100); };
  const restShown = () => ev(() => !document.querySelector('#sb-rest').classList.contains('hidden'));
  const toasts = () => ev(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));
  const toSettings = async () => { await go(page, 'home'); await page.click('[data-action=open-settings]'); await wait(); };
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#view *')].every((el) => el.offsetParent === null || el.closest('svg') || el.getBoundingClientRect().right <= window.innerWidth + 1));

  /* A. Wake lock follows the workout */
  await load(base());
  check('A no workout: no wake lock', `${(await T()).requests}|${(await T()).held}`, '0|0');
  await go(page, 'home');
  await page.click('[data-action=start-flow]'); await wait();
  await page.click('[data-action=start-empty]'); await wait();
  let t = await T();
  check('A empty workout started: screen kept awake', `${t.requests}|${t.held}`, '1|1');
  await go(page, 'history'); await wait(); await go(page, 'home'); await wait(); await go(page, 'workout'); await wait();
  t = await T();
  check('A moving between tabs and re-rendering: no extra requests', `${t.requests}|${t.held}`, '1|1');
  await ev(() => { state.active.entries.push({ exerciseId: 'bench', sets: [{ weight: 60, reps: '5', done: false }] }); render(); }); await wait();
  await tick(0);
  await page.click('[data-action=finish]'); await wait();
  await page.click('#sheet [data-action=save-workout]:not([data-include])'); await wait(400);
  t = await T();
  check('A workout finished: lock released; workout saved as before', `${t.held}|${t.releases}|${(await stored()).workouts.length}|${(await stored()).active}`, '0|1|1|null');
  await load(base({ active: { ...active('d1'), entries: [{ exerciseId: 'bench', sets: [{ weight: '', reps: '', done: false }] }] } }));
  t = await T();
  check('A app reopened during a workout: lock requested', `${t.requests}|${t.held}`, '1|1');
  await page.click('[data-action=finish]'); await wait();
  await page.click('#sheet [data-action=discard]'); await wait(400);
  t = await T();
  check('A workout discarded: lock released', `${t.held}|${t.releases}|${(await stored()).active}`, '0|1|null');

  /* B. Visibility: dropped when hidden, taken again when back */
  await load(base({ active: active('v1') }));
  await ev(() => window.__setVis('hidden')); await wait();
  t = await T();
  check('B app hidden: lock dropped, no request while hidden', `${t.held}|${t.requests}`, '0|1');
  await ev(() => window.__setVis('visible')); await wait();
  t = await T();
  check('B back to the app during the workout: lock taken again', `${t.held}|${t.requests}`, '1|2');
  await ev(() => { state.active = null; save(); render(); }); await wait();
  await ev(() => window.__setVis('hidden')); await wait(); await ev(() => window.__setVis('visible')); await wait();
  t = await T();
  check('B back to the app with no workout: no request', `${t.held}|${t.requests}`, '0|2');

  /* C. Unsupported, denied, error: logging and timers unaffected */
  for (const mode of ['unsupported', 'denied', 'error']) {
    await load(base({ active: active(`${mode}1`) }), mode);
    await tick(0);
    const shown = await restShown();
    await wait(61000);
    t = await T();
    check(`C ${mode}: set ticks, rest timer runs and ends, no page errors`, `${(await ev(() => state.active.entries[0].sets[0].done))}|${shown}|${await restShown()}|${(await toasts()).includes('Rest over. Next set! 🔔')}|${errors.length}`, 'true|true|false|true|0');
    const reqBefore = t.requests;
    await go(page, 'history'); await wait(); await go(page, 'workout'); await wait();
    check(`C ${mode}: not retried on every render`, (await T()).requests, reqBefore);
    if (mode !== 'unsupported') {
      await ev(() => window.__setVis('hidden')); await wait(); await ev(() => window.__setVis('visible')); await wait();
      check(`C ${mode}: tried again after coming back to the app`, (await T()).requests, reqBefore + 1);
    }
    await toSettings();
    const s = (await page.innerText('#view')).replace(/\s+/g, ' ');
    check(`C ${mode}: Settings explains`, s, (v) => (mode === 'unsupported' ? v.includes('Not available in this browser.') : v.includes('tries again when you come back to the app')));
    await go(page, 'workout'); await wait();
  }

  /* D. Settings toggles */
  await load(base());
  await toSettings();
  let txt = (await page.innerText('#view')).replace(/\s+/g, ' ');
  check('D both on by default, explained (incl. iPhone limits)', `${await page.getAttribute('[data-action=toggle-keep-awake]', 'aria-checked')}|${await page.getAttribute('[data-action=toggle-rest-sound]', 'aria-checked')}|${txt.includes('Keep screen awake')}|${txt.includes('Rest timer sound')}|${txt.includes("iPhone may still turn the screen off, or stop the app, when you switch apps, lock the phone or Low Power Mode is on")}|${txt.includes("The beep can't play while the phone is locked or the app is in the background")}`, 'true|true|true|true|true|true');
  check('D Settings fits the screen', await noOverflow(), true);
  await page.click('[data-action=toggle-keep-awake]'); await wait();
  await page.click('[data-action=toggle-rest-sound]'); await wait();
  check('D switched off: stored', `${(await stored()).settings.keepAwake}|${(await stored()).settings.restSound}`, 'false|false');
  await page.reload(); await wait(400); await toSettings();
  check('D off after reopening the app', `${await page.getAttribute('[data-action=toggle-keep-awake]', 'aria-checked')}|${await page.getAttribute('[data-action=toggle-rest-sound]', 'aria-checked')}`, 'false|false');
  await ev(() => { state.active = { id: 'off1', name: 'X', notes: '', start: new Date().toISOString(), entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: '8', done: false }] }] }; save(); }); await go(page, 'workout'); await wait();
  check('D keep awake off: no wake lock during a workout', (await T()).requests, 0);
  await toSettings(); await page.click('[data-action=toggle-keep-awake]'); await wait();
  t = await T();
  check('D switched on during a workout: lock taken right away', `${t.requests}|${t.held}`, '1|1');
  await page.click('[data-action=toggle-keep-awake]'); await wait();
  check('D switched off during a workout: released', (await T()).held, 0);
  await load(base({ settings: { unit: 'kg', rest: 90 } }));
  check('D older data without these settings: both on', `${await ev(() => keepAwakeOn())}|${await ev(() => restSoundOn())}`, 'true|true');

  /* E. Rest-timer sound */
  await load(base({ active: active('r1', 6) }));
  check('E no audio before any tap', (await T()).ctxCreated, 0);
  await tick(0);
  t = await T();
  check('E audio created and resumed inside the tap (unlock is silent)', `${t.ctxCreated}|${t.resumes >= 1}|${t.silent}|${t.beeps}`, '1|true|1|0');
  await wait(30000);
  check('E halfway: no beep', (await T()).beeps, 0);
  for (let i = 0; i < 5; i++) await ev(() => { render(); updateRestUI(); });
  await wait(31000);
  check('E rest ends: one beep (repeated renders don\'t add any), visual alert kept', `${(await T()).beeps}|${await restShown()}|${(await toasts()).filter((x) => x === 'Rest over. Next set! 🔔').length}`, '1|false|1');
  await wait(5000); for (let i = 0; i < 3; i++) await ev(() => tickRest());
  check('E no second beep for the same rest', (await T()).beeps, 1);
  await tick(1); await wait(10000);
  await page.click('[data-action=rest-skip]'); await wait(60000);
  check('E skipped rest: no beep', (await T()).beeps, 1);
  await tick(2); await wait(10000);
  for (let i = 0; i < 4; i++) { await page.click('[data-action=rest-adjust][data-dir="-15"]'); await wait(50); }
  check('E rest shortened to zero by hand: no beep, visual alert as before', `${(await T()).beeps}|${await restShown()}`, '1|false');
  await tick(3); await wait(20000);
  await tick(4); // a new rest replaces the running one (reset)
  await wait(45000);
  check('E rest restarted by the next set: the replaced rest never beeps', (await T()).beeps, 1);
  await wait(16000);
  check('E the new rest beeps once when it ends', (await T()).beeps, 2);
  await page.click('[data-action=rest-adjust][data-dir="15"]').catch(() => {});
  await tick(5); await wait(10000);
  await ev(() => window.__setVis('hidden'));
  await ev(() => { ui.restEnd = Date.now() - 20000; }); // the rest ended long ago while the phone was locked
  await ev(() => window.__setVis('visible')); await wait(300);
  check('E rest that ran out while the app was suspended: no late beep, timer cleared', `${(await T()).beeps}|${await restShown()}`, '2|false');
  // Sound off
  await load(base({ active: active('r2'), settings: { unit: 'kg', rest: 60, restSound: false } }));
  await tick(0); await wait(61000);
  t = await T();
  check('E sound off: no audio at all, visual alert still shown', `${t.ctxCreated}|${t.beeps}|${(await toasts()).includes('Rest over. Next set! 🔔')}`, '0|0|true');
  // Failures are silent
  for (const mode of ['none', 'throw', 'stuck', 'playfail']) {
    await load(base({ active: active(`a-${mode}`) }), 'ok', mode);
    await tick(0); await wait(61000);
    check(`E audio ${mode}: no errors, timer and visual alert work, set saved`, `${errors.length}|${await restShown()}|${(await toasts()).includes('Rest over. Next set! 🔔')}|${await ev(() => state.active.entries[0].sets[0].done)}`, '0|false|true|true');
  }

  /* F. Workout clock unchanged */
  await load(base({ active: active('c1') }));
  const el1 = await page.innerText('#elapsed').catch(() => '');
  await wait(65000);
  const el2 = await page.innerText('#elapsed').catch(() => '');
  const secs = (x) => x.split(':').reduce((n, p) => n * 60 + +p, 0);
  const startAgo = await ev(() => Math.floor((Date.now() - new Date(state.active.start)) / 1000));
  check('F workout clock still counts from the start time (+65 s)', `${secs(el2) - secs(el1)}|${Math.abs(secs(el2) - startAgo) <= 1}`, (v) => /^(64|65|66)\|true$/.test(v));

  /* G. Backups carry the settings like any other setting */
  await load(base({ settings: { unit: 'kg', rest: 60, keepAwake: false, restSound: true } }));
  const b = await ev(() => buildBackup());
  check('G backup: same format, settings included as they are', `${b.format}|${Object.keys(b).join(',')}|${b.data.settings.keepAwake}|${b.data.settings.restSound}`, '1|app,kind,format,schemaVersion,exportedAt,counts,data|false|true');
  const r1 = await ev((bk) => validateBackup(bk), b);
  const old = await ev(() => { const x = buildBackup(); delete x.data.settings.keepAwake; delete x.data.settings.restSound; return validateBackup(x); });
  check('G restore: keeps the choices; an older backup gets the defaults', `${r1.ok}|${r1.state.settings.keepAwake}|${old.ok}|${old.state.settings.keepAwake}|${old.state.settings.restSound}`, 'true|false|true|true|true');

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
