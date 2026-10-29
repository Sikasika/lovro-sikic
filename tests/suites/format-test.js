// Backup format 1/2: backups with plans export as format 2, without as format 1; the current
// app restores both; incomplete or malformed files change nothing; and the real v21 code
// (before plans) refuses a format-2 backup instead of silently dropping its plans.
// Usage: node format-test.js <outDir> <light|dark>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const OUT = path.resolve(process.argv[2] || '.'), scheme = process.argv[3] || 'light';
const DIR = `${OUT}/backup-files/format-${scheme}`;
const KEY = 'training-tracker.v1', BEFORE_KEY = 'training-tracker.v1.before-restore';
const V21 = '3f7c297'; // Phase 1 release (cache v21): the last version without plans
const V21_PORT = scheme === 'dark' ? 3202 : 3201;
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got).slice(0, 300)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };
const L = (s) => new Date(s).toISOString();
const W = (id, day, extra = {}) => ({ id, name: `Workout ${id}`, notes: '', start: L(`${day}T18:00:00+01:00`), end: L(`${day}T19:00:00+01:00`),
  entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: '10', done: true }] }], ...extra });
const exercises = [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'run', name: 'Running', category: 'Cardio' }];
const settings = { unit: 'kg', rest: 90, theme: 'system', plateauWeeks: 6, weightStepKg: 2.5, weightStepLb: 5 };
const deviceData = { schemaVersion: 2, cardioExercisesAdded: true, active: null, templates: [], exercises, settings,
  bodyweights: [{ id: 'b1', date: '2026-11-09', kg: 81 }], workouts: [W('d1', '2026-11-04'), W('d2', '2026-11-02')] };
const DEF = `({ id: 'fmt-test', version: 1, kind: 'strength', name: 'Format test program',
  build: (a, start) => [{ week: 1, sessions: [{ key: 's1', date: start, type: 'strength', title: 'A' }, { key: 's2', date: sKey(sAddDays(sFromKey(start), 2)), type: 'strength', title: 'B' }] }] })`;
const up = (port) => new Promise((res) => http.get(`http://localhost:${port}/training-tracker/`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const write = (name, obj) => { const f = `${DIR}/${name}`; fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (url) => {
    const ctx = await browser.newContext({ ...devices['iPhone 14'], colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB', acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${url}: ${e.message}`));
    page.on('dialog', (d) => d.accept());
    await page.clock.setFixedTime(new Date('2026-11-11T12:00:00+01:00'));
    await page.goto(url);
    return page;
  };
  const tools = (page) => {
    const wait = (ms = 250) => page.waitForTimeout(ms);
    const snapshot = () => page.evaluate(([k, b]) => JSON.stringify([localStorage.getItem(k), localStorage.getItem(b)]), [KEY, BEFORE_KEY]);
    const load = async (data) => { await page.evaluate(([k, b, v]) => { localStorage.setItem(k, JSON.stringify(v)); localStorage.removeItem(b); }, [KEY, BEFORE_KEY, data]); await page.reload(); await wait(300); };
    const choose = async (file) => {
      await page.evaluate(() => closeSheet()); await wait(100);
      await go(page, 'settings'); await wait();
      await page.setInputFiles('#import-file', file); await wait(400);
      return (await page.innerText('#sheet')).replace(/\s+/g, ' ');
    };
    const confirm = async () => {
      if (await page.$('#sheet [data-action=restore-toggle-copy][aria-checked=true]')) await page.click('#sheet [data-action=restore-toggle-copy]');
      await page.click('#sheet [data-action=restore-confirm]'); await wait(500);
    };
    const exportNow = async (name) => {
      await page.evaluate(() => closeSheet());
      await go(page, 'settings'); await wait();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
      const f = `${DIR}/${name}`; await dl.saveAs(f); return { file: f, json: JSON.parse(fs.readFileSync(f, 'utf8')) };
    };
    const st = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
    return { wait, snapshot, load, choose, confirm, exportNow, st };
  };

  /* ---------- Current app ---------- */
  const page = await newPage('http://localhost:3000/training-tracker/');
  const T = tools(page);
  await T.load(deviceData);

  // 1. No plans → format 1, restores as before
  const f1 = await T.exportNow('no-plans.json');
  check('1 backup without plans exports as format 1', `${f1.json.format}|${f1.json.counts.plans}|${JSON.stringify(f1.json.data.plans)}`, '1|0|[]');
  await page.evaluate(() => { state.workouts = []; save(); });
  let t = await T.choose(f1.file);
  check('1 format 1 accepted', t.includes('Restore backup') && t.includes('2 workouts'), true);
  await T.confirm();
  check('1 format 1 restored', JSON.stringify((await T.st()).workouts.map((w) => w.id)), '["d1","d2"]');

  // 2. Plans → format 2, restores with plans and links
  await page.evaluate((d) => { const r = createPlan(eval(d), {}, '2026-11-09', { id: 'fp' }); addPlan(state, r.plan); state.workouts.unshift({ id: 'pw', name: 'Plan A', notes: '', start: new Date('2026-11-09T18:00:00+01:00').toISOString(), end: new Date('2026-11-09T19:00:00+01:00').toISOString(), entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: '10', done: true }] }] }); linkWorkout(state, 'pw', 'fp', 's1'); save(); }, DEF);
  const f2 = await T.exportNow('with-plans.json');
  check('2 backup with plans exports as format 2', `${f2.json.format}|${f2.json.counts.plans}|${f2.json.data.plans[0].id}|${JSON.stringify(f2.json.data.workouts.find((w) => w.id === 'pw').plan)}`, '2|1|fp|{"planId":"fp","sessionKey":"s1"}');
  check('2 undo copy made before any plans existed stays format 1', await page.evaluate((b) => { const c = localStorage.getItem(b); return c ? JSON.parse(c).format : 'none'; }, BEFORE_KEY), 1);
  await page.evaluate(() => { state.plans = []; state.workouts = state.workouts.filter((w) => w.id !== 'pw'); save(); });
  t = await T.choose(f2.file);
  check('2 format 2 accepted and shows the plan', t.includes('Restore backup') && t.includes('1 plan'), true);
  await T.confirm();
  let s = await T.st();
  check('2 format 2 restored: plans and links', `${s.plans.length}|${s.plans[0].id}|${JSON.stringify(s.workouts.find((w) => w.id === 'pw')?.plan)}`, '1|fp|{"planId":"fp","sessionKey":"s1"}');
  check('2 that format-1 undo copy still validates', await page.evaluate((b) => validateBackup(JSON.parse(localStorage.getItem(b))).ok, BEFORE_KEY), true);
  const f2b = await T.exportNow('with-plans-2.json');
  await T.choose(f1.file); await T.confirm(); // back to a backup without plans: device plans are kept
  check('2 undo copy of data with plans is format 2', await page.evaluate((b) => JSON.parse(localStorage.getItem(b)).format, BEFORE_KEY), 2);
  check('2 restoring format 1 (no plans) keeps the device plans', `${(await T.st()).plans.length}|${(await T.st()).workouts.length}`, '1|2');

  // 3. Rejections change nothing (data and the undo copy)
  await T.choose(f2b.file); await T.confirm();
  const rejectCases = [
    ['format 2 without a plan list', (() => { const o = JSON.parse(JSON.stringify(f2b.json)); delete o.data.plans; return o; })(), 'it is marked as containing plans, but the plan list is missing'],
    ['format 2 with a plan list of the wrong type', (() => { const o = JSON.parse(JSON.stringify(f2b.json)); o.data.plans = { fp: true }; return o; })(), 'plan list is missing'],
    ['format 3 (newer app)', (() => { const o = JSON.parse(JSON.stringify(f2b.json)); o.format = 3; return o; })(), 'made by a newer version of the app'],
    ['plan count mismatch', (() => { const o = JSON.parse(JSON.stringify(f2b.json)); o.counts.plans = 2; return o; })(), 'looks incomplete'],
    ['damaged plan', (() => { const o = JSON.parse(JSON.stringify(f2b.json)); o.data.plans[0].weeks = []; return o; })(), 'has no schedule'],
    ['workout list missing', (() => { const o = JSON.parse(JSON.stringify(f2b.json)); delete o.data.workouts; return o; })(), 'workout list is missing'],
    ['not JSON', '{"app":"training-tracker", "format": 2, "data": {', "isn't valid JSON"],
  ];
  for (const [name, obj, msg] of rejectCases) {
    const before = await T.snapshot();
    t = await T.choose(write(`bad-${name.replace(/\W+/g, '-')}.json`, obj));
    check(`3 ${name}: refused, nothing changed`, `${t.includes("Can't restore this file")}|${t.includes(msg)}|${t.includes('Nothing was changed')}|${(await T.snapshot()) === before}`, 'true|true|true|true');
  }

  // 4. Existing format-1 and older backups keep working
  const oldest = { schemaVersion: 2, exercises, workouts: [W('o1', '2026-10-01')], templates: [], settings }; // pre-format: data at the top level
  const fmt1Old = { app: 'training-tracker', kind: 'backup', format: 1, schemaVersion: 2, exportedAt: L('2026-10-20T10:00:00Z'), counts: { workouts: 1, templates: 0, exercises: 2 },
    data: { exercises, workouts: [W('o2', '2026-10-02')], templates: [], active: null, settings, cardioExercisesAdded: true } }; // made before weigh-ins and plans
  for (const [name, obj, id] of [['backup from before format numbers', oldest, 'o1'], ['format-1 backup from before plans', fmt1Old, 'o2']]) {
    t = await T.choose(write(`${id}.json`, obj));
    const accepted = t.includes('Restore backup');
    if (accepted) await T.confirm();
    s = await T.st();
    check(`4 ${name}: restored, device plans kept`, `${accepted}|${s.workouts.map((w) => w.id).join(',')}|${s.plans.length}`, `true|${id}|1`);
  }

  /* ---------- The real v21 code (before plans) ---------- */
  const site = `${OUT}/v21-site-${scheme}`;
  fs.rmSync(site, { recursive: true, force: true }); fs.mkdirSync(site, { recursive: true });
  execSync(`git -C "${path.join(__dirname, '..', '..')}" archive ${V21} training-tracker | tar -x -C "${site}"`);
  check('v21 code checked out (cache v21, no plans.js)', `${/CACHE = 'training-tracker-v21'/.test(fs.readFileSync(`${site}/training-tracker/sw.js`, 'utf8'))}|${fs.existsSync(`${site}/training-tracker/plans.js`)}`, 'true|false');
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), site, String(V21_PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up(V21_PORT)); i++) await new Promise((r) => setTimeout(r, 100));
  try {
    const old = await newPage(`http://localhost:${V21_PORT}/training-tracker/`);
    const O = tools(old);
    await O.load(deviceData);
    check('v21 running', await old.evaluate(() => typeof plansOf === 'undefined' && typeof validateBackup === 'function' && BACKUP_FORMAT === 1), true);
    let before = await O.snapshot();
    t = await O.choose(f2b.file);
    check('v21 refuses a format-2 backup (with plans)', `${t.includes("Can't restore this file")}|${t.includes('made by a newer version of the app')}|${t.includes('Nothing was changed')}`, 'true|true|true');
    check('v21 data unchanged after refusing it', (await O.snapshot()) === before, true);
    // What the fix prevents: the same file marked format 1 would be accepted by v21 without its plans.
    const asFormat1 = JSON.parse(JSON.stringify(f2b.json)); asFormat1.format = 1;
    check('v21 would have dropped plans from a format-1 file (the bug)', await old.evaluate((b) => { const r = validateBackup(b); return `${r.ok}|${'plans' in r.state}`; }, asFormat1), 'true|false');
    // Compatibility: format-1 backups without plans still restore in v21
    before = await O.snapshot();
    t = await O.choose(f1.file);
    check('v21 still accepts a format-1 backup without plans', t.includes('Restore backup') && t.includes('2 workouts'), true);
    await O.confirm();
    check('v21 restored it', JSON.stringify((await O.st()).workouts.map((w) => w.id)), '["d1","d2"]');
  } finally {
    server.kill();
  }

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`PASSES: ${results.filter((x) => x.startsWith('PASS')).length}  FAILS: ${results.filter((x) => x.startsWith('FAIL')).length}`);
  await browser.close();
})();
