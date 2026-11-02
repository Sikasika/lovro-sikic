// Restore never replaces data without a verified safety copy on this device; the file copy is
// optional on top of it; cancelling keeps the previous "Undo last restore" copy.
// Usage: node restore-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1', COPY = 'training-tracker.v1.before-restore';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

(async () => { try { await main(); } catch (e) { console.log(results.join('\n')); console.log('CRASH', e.stack.split('\n').slice(0, 12).join(' / ')); console.log('PASSES: 0  FAILS: 1'); process.exit(1); } })();
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 760 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  let answers = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => { dialogs.push(d.message()); (answers.length ? answers.shift() : true) ? d.accept() : d.dismiss(); });
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 250) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const names = () => ev((k) => JSON.parse(localStorage.getItem(k)).workouts.map((w) => w.name).join(','), KEY);
  const memNames = () => ev(() => state.workouts.map((w) => w.name).join(','));
  const copyNames = () => ev((k) => { const c = localStorage.getItem(k); return c ? JSON.parse(c).data.workouts.map((w) => w.name).join(',') : null; }, COPY);
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#sheet *')].every((el) => el.offsetParent === null || el.getBoundingClientRect().right <= window.innerWidth + 1));
  // Current data "Mine A, Mine B"; a backup "From backup"; optionally an older undo copy "Older".
  const setup = ({ olderCopy = false } = {}) => ev(([k, older]) => {
    localStorage.clear(); state = defaultState();
    const id = state.exercises.find((e) => e.name === 'Bench Press').id;
    const W = (wid, name) => ({ id: wid, name, notes: '', start: '2026-10-20T08:00:00.000Z', end: '2026-10-20T09:00:00.000Z', entries: [{ exerciseId: id, sets: [{ weight: 80, reps: '5', done: true }] }] });
    state.workouts = [W('b1', 'From backup')]; window.__backup = buildBackup();
    if (older) { state.workouts = [W('o1', 'Older')]; localStorage.setItem(k, JSON.stringify(buildBackup())); }
    state.workouts = [W('m1', 'Mine A'), W('m2', 'Mine B')]; save();
    window.__shares = 0; window.__shareResult = 'shared';
    window.shareFile = async () => { window.__shares++; return window.__shareResult; };
    ui.tab = 'settings'; render();
  }, [COPY, olderCopy]).then(() => wait(150));
  const openRestore = () => ev(() => openRestoreConfirm(validateBackup(window.__backup), { source: 'file', name: 'backup.json' })).then(() => wait(200));
  const setCopy = (on) => ev((v) => { if (ui.pendingRestore.saveCopy !== v) document.querySelector('[data-action=restore-toggle-copy]').click(); }, on).then(() => wait(100));
  const confirmBtn = () => page.click('[data-action=restore-confirm]').then(() => wait(400));
  // Storage: 'full' = writing the safety copy throws; 'silent' = the write is lost without an error
  const breakCopy = (how) => ev(([k, h]) => {
    window.__set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, v) {
      if (key === k) { if (h === 'full') { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return undefined; }
      return window.__set.call(this, key, v);
    };
  }, [COPY, how]);
  const fixStorage = () => ev(() => { if (window.__set) Storage.prototype.setItem = window.__set; window.__set = null; });

  /* 1. File copy succeeds, device copy succeeds */
  await setup(); await openRestore();
  check('1 confirm sheet explains the copy rule and fits', `${(await page.innerText('#sheet')).includes("If that copy can't be saved, nothing is restored.")}|${await noOverflow()}`, 'true|true');
  await setCopy(true); dialogs.length = 0;
  await confirmBtn();
  check('1 both copies: file shared once, restored, no questions asked', `${await ev(() => window.__shares)}|${await names()}|${await memNames()}|${dialogs.length}`, '1|From backup|From backup|0');
  check('1 the device copy holds the data from before the restore', await copyNames(), 'Mine A,Mine B');
  // Recover it: Undo last restore
  await ev(() => { ui.tab = 'settings'; render(); }); await wait(150);
  await page.click('[data-action=undo-restore]'); await wait(200);
  await setCopy(false); await confirmBtn();
  check('1 Undo last restore brings the earlier data back', `${await names()}|${await copyNames()}`, 'Mine A,Mine B|From backup');

  /* 2. File copy fails or is cancelled, device copy succeeds */
  for (const res of ['failed', 'cancelled']) {
    await setup({ olderCopy: true }); await openRestore(); await setCopy(true);
    await ev((r) => { window.__shareResult = r; }, res);
    dialogs.length = 0; answers = [true];
    await confirmBtn();
    check(`2 file ${res}: asked, and the message says a device copy exists (it does)`, `${dialogs.length}|${/Restore anyway\? A safety copy of your current data is kept on this device/.test(dialogs[0] || '')}`, '1|true');
    check(`2 file ${res}, "Restore anyway": restored; device copy = data from before`, `${await names()}|${await copyNames()}`, 'From backup|Mine A,Mine B');
    await setup({ olderCopy: true }); await openRestore(); await setCopy(true);
    await ev((r) => { window.__shareResult = r; }, res);
    answers = [false];
    await confirmBtn();
    check(`2 file ${res}, answer Cancel: nothing replaced; the previous undo copy is kept (not overwritten)`, `${await names()}|${await memNames()}|${await copyNames()}`, 'Mine A,Mine B|Mine A,Mine B|Older');
  }
  await ev(() => closeSheet());

  /* 3. Both copies fail (no room on the device; the file copy is never even started) */
  await setup({ olderCopy: true }); await openRestore(); await setCopy(true);
  await ev(() => { window.__shareResult = 'failed'; });
  await breakCopy('full');
  dialogs.length = 0; answers = [false];
  await confirmBtn();
  await fixStorage();
  check('3 both fail: restore cancelled, data unchanged (memory and storage)', `${await names()}|${await memNames()}`, 'Mine A,Mine B|Mine A,Mine B');
  check('3 no "Restore anyway" question; the message says it was cancelled because no safety copy could be saved', `${dialogs.length}|${dialogs.some((d) => d.includes('Restore anyway'))}|${/^Restore cancelled\. A safety copy of your current data couldn't be saved on this device.*nothing was replaced/s.test(dialogs[0] || '')}`, '1|false|true');
  check('3 the file copy was not attempted; the previous undo copy is untouched; sheet closed', `${await ev(() => window.__shares)}|${await copyNames()}|${await ev(() => document.querySelector('#sheet').classList.contains('hidden'))}`, '0|Older|true');

  // The audited defect path: the user says yes to every question; still nothing is replaced
  await setup({ olderCopy: true }); await openRestore(); await setCopy(true);
  await ev(() => { window.__shareResult = 'cancelled'; });
  await breakCopy('full');
  dialogs.length = 0; answers = [true, true, true];
  await confirmBtn();
  await fixStorage();
  check('3 both fail and the user answers yes to everything: still nothing replaced (memory and storage)', `${await names()}|${await memNames()}|${dialogs.some((d) => d.includes('Restore anyway'))}`, 'Mine A,Mine B|Mine A,Mine B|false');

  /* 4. Device copy fails with the file option off; and the export offer */
  await setup(); await openRestore(); await setCopy(false);
  await breakCopy('full');
  dialogs.length = 0; answers = [true];
  await confirmBtn();
  await fixStorage();
  check('4 device copy fails (file option off): aborted, data unchanged, no copy left', `${await names()}|${await memNames()}|${await copyNames()}`, 'Mine A,Mine B|Mine A,Mine B|null');
  check('4 accepting the offer starts a backup export', `${dialogs.length}|${await ev(() => window.__shares)}`, '1|1');
  // A write that is lost without an error is caught by the read-back check
  await setup({ olderCopy: true }); await openRestore(); await setCopy(false);
  await breakCopy('silent');
  dialogs.length = 0; answers = [false];
  await confirmBtn();
  await fixStorage();
  check('4 copy not readable after writing: aborted, data unchanged, older copy still there', `${await names()}|${dialogs[0]?.startsWith('Restore cancelled')}|${await copyNames()}`, 'Mine A,Mine B|true|Older');
  // Undo last restore also needs its copy
  await setup({ olderCopy: true });
  await ev(() => { ui.tab = 'settings'; render(); }); await wait(150);
  await page.click('[data-action=undo-restore]'); await wait(200); await setCopy(false);
  await breakCopy('full'); dialogs.length = 0; answers = [false];
  await confirmBtn(); await fixStorage();
  check('4 Undo last restore with no room for a copy: cancelled, current data kept', `${await names()}|${await copyNames()}|${dialogs[0]?.startsWith('Restore cancelled')}`, 'Mine A,Mine B|Older|true');

  /* 5. Writing the restored data fails after the copy was made: data and previous copy kept */
  await setup({ olderCopy: true }); await openRestore(); await setCopy(false);
  await ev((k) => { window.__set = Storage.prototype.setItem; let n = 0; Storage.prototype.setItem = function (key, v) { if (key === k && n++ === 0) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return window.__set.call(this, key, v); }; }, KEY);
  await confirmBtn(); await fixStorage();
  check('5 restored data can\'t be written: current data kept; previous undo copy put back', `${await names()}|${await memNames()}|${await copyNames()}`, 'Mine A,Mine B|Mine A,Mine B|Older');
  await ev(() => closeSheet());

  /* 6. Older backup formats still restore (no plans/weights fields: format 1) */
  await setup();
  const old = await ev(() => { const b = JSON.parse(JSON.stringify(window.__backup)); b.format = 1; delete b.data.plans; delete b.data.bodyweights; return b; });
  await ev((b) => openRestoreConfirm(validateBackup(b), { source: 'file', name: 'old.json' }), old); await wait(200);
  await setCopy(false); await confirmBtn();
  check('6 older-format backup: restored, safety copy made', `${await names()}|${await copyNames()}`, 'From backup|Mine A,Mine B');
  // Only one safety copy exists at any time
  check('6 a single safety copy key (no duplicates)', await ev(() => Object.keys(localStorage).filter((k) => k.includes('before-restore')).length), 1);

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
}
