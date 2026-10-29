#!/usr/bin/env node
// Update test: a phone runs the version at <ref> (default HEAD) with data and a workout in
// progress; the current working tree is deployed over it. Checks the "New version ready"
// notice, that stored data is unchanged by the update, that the new code runs, and offline.
//   node tests/update-test.js [ref]
const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ref = process.argv[2] || 'HEAD';
const repo = path.join(__dirname, '..');
const site = path.join(__dirname, 'out', 'update-site');
const PORT = 3100;
const L = (s) => new Date(s).toISOString();
const data = {
  schemaVersion: 2, cardioExercisesAdded: true, templates: [],
  settings: { unit: 'kg', rest: 90, theme: 'system', plateauWeeks: 6 },
  exercises: [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'run', name: 'Running', category: 'Cardio' }],
  workouts: [{ id: 'w1', name: 'Push', notes: '', start: L('2026-10-20T18:00:00+02:00'), end: L('2026-10-20T19:00:00+02:00'),
    entries: [{ exerciseId: 'bench', sets: [{ weight: 40, reps: '10', done: true, type: 'warmup' }, { weight: 60, reps: '10', done: true }] }] }],
  bodyweights: [{ id: 'b1', date: '2026-10-20', kg: 81.5 }],
  active: { id: 'act', name: 'In progress', templateId: null, start: new Date().toISOString(), notes: '',
    entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: '10', done: true }, { weight: '', reps: '', done: false }] }] }
};
const up = () => new Promise((res) => http.get(`http://localhost:${PORT}/training-tracker/`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));
const results = [];
const check = (name, ok, got) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `: got ${JSON.stringify(got)}`}`);

(async () => {
  fs.rmSync(site, { recursive: true, force: true });
  fs.mkdirSync(site, { recursive: true });
  execSync(`git -C "${repo}" archive ${ref} training-tracker | tar -x -C "${site}"`);
  const oldCache = (fs.readFileSync(path.join(site, 'training-tracker/sw.js'), 'utf8').match(/CACHE = '([^']+)'/) || [])[1];
  const newCache = (fs.readFileSync(path.join(repo, 'training-tracker/sw.js'), 'utf8').match(/CACHE = '([^']+)'/) || [])[1];
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), site, String(PORT), '--cache'], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const url = `http://localhost:${PORT}/training-tracker/`;
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.evaluate((v) => localStorage.setItem('training-tracker.v1', v), JSON.stringify(data));
    await page.reload(); await page.waitForTimeout(600);
    const before = await page.evaluate(() => localStorage.getItem('training-tracker.v1'));
    check(`old version (${ref}, ${oldCache}) installed`, (await page.evaluate(() => caches.keys())).includes(oldCache), await page.evaluate(() => caches.keys()));
    execSync(`cp -r "${repo}/training-tracker/." "${site}/training-tracker/"`);
    if (oldCache === newCache) {
      check('cache version was bumped (required for installed apps to update)', false, newCache);
    } else {
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
      await page.waitForTimeout(2500);
      check('"New version ready" notice shown', await page.isVisible('#update-notice'), false);
      await Promise.all([page.waitForNavigation(), page.click('#update-notice button')]);
      await page.waitForTimeout(1200);
      check(`new cache active (${newCache})`, JSON.stringify(await page.evaluate(() => caches.keys())) === JSON.stringify([newCache]), await page.evaluate(() => caches.keys()));
    }
    check('stored data unchanged by the update', before === await page.evaluate(() => localStorage.getItem('training-tracker.v1')), 'changed');
    check('app renders', await page.evaluate(() => typeof render === 'function' && !!document.querySelector('.tabbar')), false);
    await ctx.setOffline(true);
    await page.reload(); await page.waitForTimeout(800);
    check('opens offline', await page.evaluate(() => typeof render === 'function' && !!document.querySelector('#view').innerHTML.trim()), false);
    check('workout in progress still there offline', await page.evaluate(() => JSON.parse(localStorage.getItem('training-tracker.v1')).active?.id === 'act'), false);
    check('no page errors', !errors.length, errors);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`PASSES: ${results.length - fails}  FAILS: ${fails}`);
  process.exit(fails ? 1 : 0);
})();
