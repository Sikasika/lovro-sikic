// Data safety: backup reminder on Today, persistent storage, failed saves, Settings storage info.
// Usage: node safety-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { go } = require('./nav');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

const NOW = new Date('2026-11-10T09:00:00+01:00'); // Tuesday
const ago = (days, hours = 0) => new Date(NOW.getTime() - days * 864e5 - hours * 3600e3).toISOString();
const W = (id, endIso) => ({ id, name: `Workout ${id}`, notes: '', start: new Date(Date.parse(endIso) - 3600e3).toISOString(), end: endIso,
  entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: '10', done: true }] }] });
const exercises = [{ id: 'bench', name: 'Bench Press', category: 'Chest' }];
const base = (extra = {}) => ({ schemaVersion: 2, cardioExercisesAdded: true, active: null, bodyweights: [], templates: [], plans: [], exercises, workouts: [],
  settings: { unit: 'kg', rest: 90, theme: 'system', plateauWeeks: 6 }, ...extra });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width, height: 800 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
  // Simulated browser answers for persistent storage, chosen per test through a separate key.
  await ctx.addInitScript(() => {
    const mode = localStorage.getItem('__persist');
    window.__persistAsked = 0;
    if (!mode) return;
    if (mode === 'unsupported') { Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true }); return; }
    const fake = {
      persisted: async () => mode === 'already',
      persist: async () => { window.__persistAsked++; if (mode === 'error') throw new Error('no'); return mode === 'granted'; },
      estimate: async () => ({ usage: 812345, quota: 2147483648 })
    };
    Object.defineProperty(navigator, 'storage', { value: fake, configurable: true });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  let dialogs = [], dialogAnswer = true;
  page.on('dialog', (d) => { dialogs.push(d.message()); dialogAnswer ? d.accept() : d.dismiss(); });
  await page.clock.setFixedTime(NOW);
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 200) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const load = async (data, persist = 'granted') => {
    await ev(([k, v, p]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('__persist', p); }, [KEY, data, persist]);
    await page.reload(); await wait(350);
  };
  const stored = () => ev((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const view = async () => (await page.innerText('#view')).replace(/\s+/g, ' ');
  const reminder = async () => ((await page.$('.backup-reminder')) ? (await page.innerText('.backup-reminder')).replace(/\s+/g, ' ') : null);
  const lastToast = () => page.$$eval('.toast', (t) => (t.length ? t[t.length - 1].textContent : null)).catch(() => null);
  const noOverflow = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth
    && [...document.querySelectorAll('#view *, #save-warning *')].every((el) => el.offsetParent === null || el.closest('svg') || el.getBoundingClientRect().right <= window.innerWidth + 1));
  const toSettings = async () => { await go(page, 'home'); await page.click('[data-action=open-settings]'); await wait(250); };
  const exportVia = async (sel) => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const p = path.join(os.tmpdir(), `safety-${scheme}-${width}-${Date.now()}.json`); await dl.saveAs(p); await wait(250); return JSON.parse(fs.readFileSync(p, 'utf8')); };

  /* A. Backup reminder thresholds */
  await load(base());
  check('A no data: no reminder', await reminder(), null);
  await load(base({ settings: { unit: 'kg', rest: 120, theme: 'dark', plateauWeeks: 6 } }));
  check('A only changed settings: still no reminder', await reminder(), null);
  await load(base({ workouts: [W('w1', ago(1))] }));
  check('A one workout, never exported: reminder with one-tap export', await reminder(), (v) => v && v.includes('Back up your training') && v.includes("hasn't been backed up yet") && v.includes('Export Backup') && v.includes('Not Now'));
  check('A reminder below the Today card, fits the screen', `${await ev(() => !!document.querySelector('.home-today + .backup-reminder, .home-live + .backup-reminder'))}|${await noOverflow()}`, 'true|true');
  await load(base({ bodyweights: [{ id: 'b1', date: '2026-11-09', kg: 80 }] }));
  check('A a weigh-in alone is worth backing up', await reminder(), (v) => v && v.includes('Back up your training'));
  await load(base({ active: { id: 'a1', name: 'Push', start: ago(0, 1), notes: '', entries: [] } }));
  await go(page, 'home'); await wait();
  check('A a workout in progress alone is worth backing up (also shown during it)', await reminder(), (v) => v && v.includes('Back up your training'));
  await load(base({ workouts: [W('w1', ago(20)), W('w2', ago(2))], lastExportAt: ago(3) }));
  check('A exported 3 days ago, 1 workout since: no reminder', await reminder(), null);
  await load(base({ workouts: [W('w1', ago(20))], lastExportAt: ago(13, 23) }));
  check('A 13 days 23 h ago: no reminder', await reminder(), null);
  await load(base({ workouts: [W('w1', ago(20))], lastExportAt: ago(14, 1) }));
  check('A more than 14 days ago (nothing new): reminder with the date', await reminder(), (v) => v && v.includes('Time for a backup') && v.includes('Last backup 14 days ago.'));
  await load(base({ workouts: [W('w1', ago(30)), W('w2', ago(10)), W('w3', ago(5))], lastExportAt: ago(15) }));
  check('A 15 days ago, 2 workouts since: says both', await reminder(), (v) => v && v.includes('Last backup 15 days ago · 2 workouts since then.'));
  const since = (n) => Array.from({ length: n }, (_, i) => W(`n${i}`, ago(1, i)));
  await load(base({ workouts: [W('old', ago(9)), ...since(4)], lastExportAt: ago(2) }));
  check('A 4 workouts since a recent backup: no reminder', await reminder(), null);
  await load(base({ workouts: [W('old', ago(9)), ...since(5)], lastExportAt: ago(2) }));
  check('A 5 workouts since a recent backup: reminder', await reminder(), (v) => v && v.includes('Last backup 2 days ago · 5 workouts since then.'));
  await load(base({ workouts: Array.from({ length: 12 }, (_, i) => W(`p${i}`, ago(3 + i))), lastExportAt: ago(2) }));
  check('A workouts saved before the backup are not counted', await reminder(), null);
  await load(base({ workouts: [W('w1', ago(1))], lastExportAt: 'not a date' }));
  check('A damaged backup date: treated as never backed up (reminds, no crash)', await reminder(), (v) => v && v.includes('Back up your training'));

  /* B. "Not now" hides it for 3 days only */
  await load(base({ workouts: [W('w1', ago(20))], lastExportAt: ago(16) }));
  await page.click('[data-action=backup-snooze]'); await wait();
  let s = await stored();
  check('B Not Now: hidden, message says for how long', `${await reminder()}|${await lastToast()}`, 'null|Reminder hidden for 3 days');
  check('B snooze stored for 3 days', s.backupSnoozedUntil, new Date(NOW.getTime() + 3 * 864e5).toISOString());
  await page.reload(); await wait(300);
  check('B still hidden after reopening the app', await reminder(), null);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 2 * 864e5)); await page.reload(); await wait(300);
  check('B still hidden 2 days later', await reminder(), null);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 3 * 864e5 + 60e3)); await page.reload(); await wait(300);
  check('B back after 3 days (dismissal is never permanent)', await reminder(), (v) => v && v.includes('Last backup 19 days ago'));
  await page.clock.setFixedTime(NOW);

  /* C. Export from Today: success, cancel, failure */
  await load(base({ workouts: [W('w1', ago(20))], lastExportAt: ago(16), backupSnoozedUntil: ago(1) }));
  let exp = await exportVia('.backup-reminder [data-action=export]');
  s = await stored();
  check('C export from Today: file has the data; backup date saved; reminder gone; snooze cleared', `${exp.counts.workouts}|${s.lastExportAt === exp.exportedAt}|${await reminder()}|${'backupSnoozedUntil' in s}`, '1|true|null|false');
  check('C success message', await lastToast(), 'Backup exported · 1 workout');
  check('C backup file format unchanged (no reminder/storage fields)', `${Object.keys(exp).join(',')}|${Object.keys(exp.data).join(',')}|${JSON.stringify(exp).includes('backupSnoozedUntil') || JSON.stringify(exp).includes('lastExportAt')}`,
    'app,kind,format,schemaVersion,exportedAt,counts,data|exercises,workouts,templates,active,bodyweights,plans,settings,cardioExercisesAdded|false');
  await load(base({ workouts: [W('w1', ago(20))], lastExportAt: ago(16) }));
  await ev(() => { navigator.canShare = () => true; navigator.share = async () => { const e = new Error('cancel'); e.name = 'AbortError'; throw e; }; });
  await page.click('.backup-reminder [data-action=export]'); await wait(300);
  s = await stored();
  check('C cancelled share sheet: not counted as a backup, reminder stays', `${s.lastExportAt === ago(16)}|${!!(await reminder())}|${await lastToast()}`, 'true|true|Export cancelled');
  await load(base({ workouts: [W('w1', ago(20))], lastExportAt: ago(16) }));
  await ev(() => { window.File = function () { throw new Error('no file'); }; });
  dialogs = [];
  await page.click('.backup-reminder [data-action=export]'); await wait(300);
  s = await stored();
  check('C failed export: error shown, not counted, reminder stays', `${dialogs.join('')}|${s.lastExportAt === ago(16)}|${!!(await reminder())}`, 'The backup could not be created. Please try again.|true|true');

  /* D. Persistent storage outcomes (simulated browser answers) */
  await load(base({ workouts: [W('w1', ago(1))] }), 'granted');
  check('D granted: asked once at start (there is data)', await ev(() => window.__persistAsked), 1);
  await toSettings();
  let t = await view();
  check('D granted: Settings shows On, explanation, no ask button', `${t.includes('Persistent storage The browser has agreed not to clear this app\'s data on its own. On')}|${!!(await page.$('[data-action=persist-ask]'))}`, 'true|false');
  check('D says it doesn\'t replace backups or protect against clearing data, and isn\'t guaranteed on iPhone', t.includes("It doesn't protect against deleting the app from the Home Screen, clearing website data, or losing the phone, and on iPhone it isn't guaranteed. Only a backup file protects against that."), true);
  check('D storage: measured data size vs browser estimate and quota, clearly labelled', `${/Saved training data Measured on this device \d+ KB|Saved training data Measured on this device \d+ bytes/.test(t)}|${t.includes("Browser estimate 793 KB used, as counted by the browser (it decides what to include, so this may leave out the saved data above). Quota 2 GB: the browser's upper limit, not space reserved for you. Saved data has its own, smaller limit (usually about 5 MB).")}`, 'true|true');
  check('D Settings: last successful backup line', t.includes('No backup from this device yet'), true);
  check('D Settings fits the screen', await noOverflow(), true);
  await load(base({ workouts: [W('w1', ago(1))] }), 'already');
  check('D already persistent: not asked again', await ev(() => window.__persistAsked), 0);
  await load(base({ workouts: [W('w1', ago(1))] }), 'denied');
  await toSettings();
  t = await view();
  check('D denied: Not granted, explained, can ask again', `${t.includes('Not granted')}|${t.includes('may clear saved data on its own')}|${!!(await page.$('[data-action=persist-ask]'))}`, 'true|true|true');
  await page.click('[data-action=persist-ask]'); await wait(300);
  check('D ask again: asked, answer reported', `${await ev(() => window.__persistAsked)}|${await lastToast()}`, "2|The browser didn't allow it");
  await load(base({ workouts: [W('w1', ago(1))] }), 'unsupported');
  await toSettings();
  t = await view();
  check('D unsupported: Not available, no ask button, no estimate, app works', `${t.includes('Not available')}|${!!(await page.$('[data-action=persist-ask]'))}|${t.includes('Browser estimate')}|${t.includes('Saved training data')}`, 'true|false|false|true');
  await load(base({ workouts: [W('w1', ago(1))] }), 'error');
  await toSettings();
  check('D browser error: Unknown, can ask again', `${(await view()).includes('Unknown')}|${!!(await page.$('[data-action=persist-ask]'))}`, 'true|true');
  await load(base(), 'granted');
  check('D no data yet: not requested', await ev(() => window.__persistAsked), 0);
  await toSettings();
  check('D no data yet: Settings says when it will be asked', (await view()).includes('Not requested yet'), true);
  await ev(() => { state.bodyweights.push({ id: 'b1', date: '2026-11-10', kg: 80 }); save(); }); await wait(300);
  check('D first data saved: requested then', `${await ev(() => window.__persistAsked)}|${await ev(() => storageSafety.persist)}`, '1|granted');

  /* E. Failed saves */
  await load(base({ workouts: [W('w1', ago(20))], lastExportAt: ago(1) }));
  await ev(() => { const orig = Storage.prototype.setItem; window.__failSave = true;
    Storage.prototype.setItem = function (k, v) { if (window.__failSave && k === 'training-tracker.v1') { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return orig.call(this, k, v); }; });
  const before = JSON.stringify(await stored());
  await ev(() => { state.workouts.unshift({ id: 'new', name: 'Unsaved workout', notes: '', start: new Date(Date.now() - 3600e3).toISOString(), end: new Date().toISOString(), entries: [{ exerciseId: 'bench', sets: [{ weight: 70, reps: '5', done: true }] }] }); save(); render(); });
  await wait();
  const warn = async () => ((await page.$('#save-warning')) ? (await page.innerText('#save-warning')).replace(/\s+/g, ' ') : null);
  check('E failed save: warning stays on screen with Export Backup and Try Again', await warn(), (v) => v && v.includes("Your latest changes aren't saved") && v.includes('Export Backup') && v.includes('Try Again'));
  check('E it is an alert, not a toast', `${await ev(() => document.querySelector('#save-warning').getAttribute('role'))}|${(await lastToast()) || ''}`, (v) => v.startsWith('alert|') && !v.includes('Could not save'));
  check('E stored data untouched; new workout kept in memory', `${JSON.stringify(await stored()) === before}|${await ev(() => state.workouts[0].id)}`, 'true|new');
  await go(page, 'history'); await wait();
  await ev(() => { state.settings.rest = 75; save(); }); await wait();
  check('E stays across screens and further failed saves (one warning)', `${await ev(() => document.querySelectorAll('#save-warning').length)}|${(await view()).includes('Unsaved workout')}`, '1|true');
  check('E warning fits the screen', await noOverflow(), true);
  await go(page, 'home'); await wait();
  check('E warning doesn\'t cover the top bar', await ev(() => { const a = document.querySelector('.topbar').getBoundingClientRect(), b = document.querySelector('#save-warning').getBoundingClientRect(); return b.top >= a.bottom - 1; }), true);
  await page.evaluate(() => window.scrollTo(0, 400)); await wait();
  check('E still visible after scrolling', await ev(() => { const r = document.querySelector('#save-warning').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }), true);
  await page.evaluate(() => window.scrollTo(0, 0));
  exp = await exportVia('#save-warning [data-action=export]');
  check('E Export Backup from the warning: file has the unsaved workout', `${exp.counts.workouts}|${exp.data.workouts[0].id}|${exp.data.settings.rest}`, '2|new|75');
  check('E warning still up after export (still not saved)', !!(await warn()), true);
  await page.click('#save-warning [data-action=retry-save]'); await wait();
  check('E Try Again while still failing: says so, warning stays, nothing written', `${await lastToast()}|${!!(await warn())}|${JSON.stringify(await stored()) === before}`, "Still can't save. Export a backup to keep your changes.|true|true");
  // An app update must not reload away unsaved changes silently
  dialogs = []; dialogAnswer = false;
  await ev(() => { window.__marker = 1; window.reloadForUpdate(); }); await wait(300);
  check('E update reload while unsaved: asks first; Cancel keeps the page', `${dialogs[0] || ''}|${await ev(() => window.__marker)}`, (v) => v.includes("aren't saved and would be lost by reloading") && v.endsWith('|1'));
  dialogAnswer = true;
  await ev(() => { window.__failSave = false; });
  await page.click('#save-warning [data-action=retry-save]'); await wait();
  s = await stored();
  check('E space freed, Try Again: saved, warning gone, confirmed', `${!!(await warn())}|${await lastToast()}|${s.workouts[0].id}|${s.settings.rest}|${s.lastExportAt === exp.exportedAt}`, 'false|Saved · your changes are stored again|new|75|true');
  // A later ordinary save also clears it
  await ev(() => { window.__failSave = true; state.settings.rest = 80; save(); }); await wait();
  check('E failing again: warning back', !!(await warn()), true);
  await ev(() => { window.__failSave = false; state.settings.rest = 85; save(); }); await wait();
  check('E next ordinary save succeeds: warning gone, latest data stored', `${!!(await warn())}|${(await stored()).settings.rest}`, 'false|85');

  /* F. Restore keeps backup date and snooze; restored data counts as saved */
  await load(base({ workouts: [W('w1', ago(20))], lastExportAt: ago(5), backupSnoozedUntil: new Date(NOW.getTime() + 864e5).toISOString() }));
  const file = path.join(os.tmpdir(), `safety-restore-${scheme}-${width}.json`);
  fs.writeFileSync(file, JSON.stringify({ app: 'training-tracker', kind: 'backup', format: 1, schemaVersion: 2, exportedAt: ago(40), counts: { workouts: 2 },
    data: { exercises, workouts: [W('r1', ago(41)), W('r2', ago(42))], templates: [], active: null, bodyweights: [], plans: [], settings: { unit: 'kg', rest: 90 }, cardioExercisesAdded: true } }));
  await toSettings();
  await page.setInputFiles('#import-file', file); await wait(400);
  await page.click('[data-action=restore-confirm]').catch(() => {}); await wait(500);
  s = await stored();
  check('F restore: data replaced; last backup date and snooze kept from this device', `${s.workouts.map((w) => w.id).join(',')}|${s.lastExportAt === ago(5)}|${!!s.backupSnoozedUntil}`, 'r1,r2|true|true');

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
