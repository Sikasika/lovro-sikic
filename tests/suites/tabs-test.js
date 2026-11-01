// Erase needs its safety copy; several tabs never overwrite each other's newer data.
// Usage: node tabs-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
  const errors = [];
  const open = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    p.dialogs = []; p.answers = [];
    p.on('dialog', (d) => { p.dialogs.push(d.message()); (p.answers.length ? p.answers.shift() : true) ? d.accept() : d.dismiss(); });
    await p.goto('http://localhost:3000/training-tracker/');
    await p.waitForTimeout(300);
    return p;
  };
  const ev = (p, fn, arg) => p.evaluate(fn, arg);
  const stored = (p) => ev(p, (k) => JSON.parse(localStorage.getItem(k)), KEY);
  const W = (id) => ({ id, name: `Workout ${id}`, notes: '', start: '2026-11-20T08:00:00', end: '2026-11-20T09:00:00', entries: [{ exerciseId: 'x', sets: [{ weight: 50, reps: 5, done: true }] }] });
  const banner = (p) => p.$('#stale-warning').then((x) => !!x);
  const noOverflow = (p) => ev(p, () => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#stale-warning *')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1));

  /* A. Erase needs its safety copy */
  let a = await open();
  await ev(a, (w) => { localStorage.clear(); state = defaultState(); state.workouts = [w]; save();
    window.__orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k.endsWith('before-restore')) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return window.__orig.call(this, k, v); };
    ui.tab = 'settings'; render(); }, W('keep'));
  a.dialogs = []; a.answers = [true, false]; // confirm erase; then decline the export offer
  await a.click('[data-action=reset]'); await a.waitForTimeout(300);
  check('A safety copy fails: nothing erased (memory and storage)', `${await ev(a, () => state.workouts.length)}|${(await stored(a)).workouts.length}|${await ev(a, () => !!localStorage.getItem('training-tracker.v1.before-restore'))}`, '1|1|false');
  check('A clear explanation and an export offer', a.dialogs[1] || '', (v) => v.startsWith('Nothing was erased') && v.includes('safety copy') && v.includes('Export a backup now?'));
  a.dialogs = []; a.answers = [true, true]; // confirm erase; accept the export offer
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('[data-action=reset]')]);
  await a.waitForTimeout(300);
  check('A accepting the offer exports a backup (with the data); still nothing erased', `${dl.suggestedFilename().startsWith('training-backup-')}|${(await stored(a)).workouts.length}`, 'true|1');
  await ev(a, () => { Storage.prototype.setItem = window.__orig; });
  a.dialogs = []; a.answers = [true];
  await a.click('[data-action=reset]'); await a.waitForTimeout(300);
  check('A with room for the copy: erased as before, undo copy kept', `${await ev(a, () => state.workouts.length)}|${(await stored(a)).workouts.length}|${await ev(a, () => !!localStorage.getItem('training-tracker.v1.before-restore'))}|${a.dialogs.length}`, '0|0|true|1');
  await a.close();

  /* B. Two tabs */
  a = await open();
  await ev(a, () => { localStorage.clear(); state = defaultState(); save(); });
  let b = await open();
  check('B both tabs start on the same revision, no warning', `${await ev(a, () => myRev)}|${await ev(b, () => myRev)}|${await banner(a)}|${await banner(b)}`, (v) => { const [x, y, p, q] = v.split('|'); return x === y && p === 'false' && q === 'false'; });
  // 1. Tab A saves a workout; idle tab B quietly takes it over
  await ev(a, (w) => { state.workouts.push(w); save(); }, W('fromA')); await b.waitForTimeout(300);
  check('B1 idle tab B takes over A\'s change quietly (no reload, no warning)', `${await ev(b, () => state.workouts.map((w) => w.id).join(','))}|${await banner(b)}`, 'fromA|false');
  await ev(b, () => { state.settings.rest = 75; save(); }); await a.waitForTimeout(300);
  const s1 = await stored(a);
  check('B1 B\'s later change is saved on top: both kept, nothing duplicated', `${s1.workouts.map((w) => w.id).join(',')}|${s1.settings.rest}|${await ev(a, () => state.settings.rest)}`, 'fromA|75|75');
  // 2. B is in the middle of typing when A saves: B stops saving and asks to reload
  await ev(b, () => { ui.tab = 'settings'; render(); }); await b.focus('#rest-seconds');
  await ev(a, (w) => { state.workouts.push(w); save(); }, W('fromA2')); await b.waitForTimeout(300);
  check('B2 typing in B when A saves: B shows "Changed in another tab", nothing overwritten', `${await banner(b)}|${(await b.innerText('#stale-warning')).includes('Changed in another tab')}|${(await stored(a)).workouts.length}`, 'true|true|2');
  await b.fill('#rest-seconds', '30'); await b.waitForTimeout(200);
  await ev(b, () => { state.workouts = []; save(); });
  const s2 = await stored(a);
  check('B2 B can no longer overwrite: A\'s workouts and setting stay', `${s2.workouts.map((w) => w.id).join(',')}|${s2.settings.rest}`, 'fromA,fromA2|75');
  check('B2 warning fits the screen', await noOverflow(b), true);
  await b.click('[data-action=stale-reload]'); await b.waitForLoadState(); await b.waitForTimeout(400);
  check('B2 Reload: B shows the latest data and saves again', `${await banner(b)}|${await ev(b, () => state.workouts.length)}|${await ev(b, () => { state.settings.rest = 60; return save(); })}|${(await stored(a)).settings.rest}`, 'false|2|true|60');
  // 3. A missed notification: B still refuses to write over newer data at save time
  await a.waitForTimeout(300);
  await ev(b, () => { localStorage.setItem('training-tracker.v1.rev', String(myRev + 5)); }); // as if another tab saved unnoticed
  const before3 = JSON.stringify(await stored(a));
  check('B3 missed notification: save refused, warning shown, stored data unchanged', `${await ev(b, () => { state.workouts = []; return save(); })}|${await banner(b)}|${JSON.stringify(await stored(a)) === before3}`, 'false|true|true');
  await b.close();
  // 4. A sheet open in B when A saves: warning; restore is refused in the out-of-date tab
  b = await open();
  await ev(b, () => { ui.tab = 'settings'; render(); openExerciseManager(); }); await b.waitForTimeout(200);
  await ev(a, () => { state.settings.rest = 45; save(); }); await b.waitForTimeout(300);
  check('B4 sheet open in B when A saves: warning instead of swapping data under it', await banner(b), true);
  const before4 = JSON.stringify(await stored(a));
  await ev(b, () => { ui.pendingRestore = { result: validateBackup(buildBackup()), origin: { source: 'file' }, saveCopy: false }; return confirmRestore(); });
  check('B4 restore in the out-of-date tab is refused; nothing written', JSON.stringify(await stored(a)) === before4, true);
  await b.close();
  // 5. A workout finished in A while B shows it in progress: B follows, no duplicate
  await ev(a, () => { state.active = { id: 'live', name: 'Live', notes: '', start: new Date().toISOString(), entries: [{ exerciseId: state.exercises[0].id, sets: [{ weight: 60, reps: '5', done: true }] }] }; save(); });
  b = await open();
  check('B5 B opens on the workout in progress', await ev(b, () => `${ui.tab}|${state.active?.id}`), 'workout|live');
  await ev(a, () => { const w = state.active; w.end = new Date().toISOString(); state.workouts.unshift(w); state.active = null; save(); }); await b.waitForTimeout(300);
  check('B5 after A finishes it, B has no workout in progress and one saved copy', `${await ev(b, () => `${state.active}|${state.workouts.filter((w) => w.id === 'live').length}|${ui.tab}`)}|${await banner(b)}`, 'null|1|home|false');
  // 6. Cleared storage is not "newer data": the open tab may write again
  await ev(a, () => localStorage.clear()); await b.waitForTimeout(200);
  check('B6 storage cleared elsewhere: B keeps working and can save', `${await ev(b, () => save())}|${await banner(b)}|${!!(await stored(a))}`, 'true|false|true');
  // 7. One tab alone never sees the warning; backups unchanged
  await b.close();
  for (let i = 0; i < 5; i++) await ev(a, (i) => { state.settings.rest = 60 + i; save(); }, i);
  check('B7 one tab: repeated saves, never a warning', `${await banner(a)}|${(await stored(a)).settings.rest}`, 'false|64');
  check('B7 backup format unchanged (the revision is not in backups)', await ev(a, () => { const x = buildBackup(); return `${Object.keys(x).join(',')}|${JSON.stringify(x).includes('.rev')}`; }), 'app,kind,format,schemaVersion,exportedAt,counts,data|false');

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
