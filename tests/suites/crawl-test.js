const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const SP = process.argv[2], width = +process.argv[3], scheme = process.argv[4] || 'light';
const KEY = 'training-tracker.v1';
const L = (s) => new Date(s).toISOString();
const data = {
  schemaVersion: 2, cardioExercisesAdded: true, settings: { unit: 'kg', rest: 90 },
  exercises: [{ id: 'bench', name: 'Incline Dumbbell Bench Press With Pause', category: 'Chest' }, { id: 'run', name: 'Running', category: 'Cardio' },
    { id: 'row', name: 'Barbell Row', category: 'Back' }, { id: 'padel', name: 'Padel', category: 'Sports' }, { id: 'swim', name: 'Swimming', category: 'Cardio' }, { id: 'old', name: 'Old', category: 'Legs', archived: true }],
  workouts: [
    { id: 'w2', name: 'A very long workout name that keeps going and going', location: 'Fitness Centar Zagreb Velesajam Hall B', notes: 'Notes '.repeat(30), templateId: 't1', start: L('2026-10-27T10:00:00'), end: L('2026-10-27T11:10:00'),
      entries: [
        { exerciseId: 'bench', note: 'Seat 4, wide grip, pause at the bottom for two seconds', superset: 's1', sets: [{ weight: 40, reps: '10', type: 'warmup', done: true }, { weight: 102.5, reps: '5', target: { weight: 100, reps: 5 }, done: true }, { weight: 80, reps: '8', type: 'drop', done: true }] },
        { exerciseId: 'row', superset: 's1', sets: [{ weight: 60, reps: '10', done: true }] },
        { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 12345, duration: 3725, done: true }, { weight: '', reps: '', distance: 5000, duration: 1500, done: true }] },
        { exerciseId: 'swim', sets: [{ weight: '', reps: '', distance: 1500, duration: 1800, done: true }] }] },
    { id: 'w1', name: 'Legacy', location: '', notes: '', start: L('2026-10-20T10:00:00'), end: L('2026-10-20T11:00:00'),
      entries: [{ exerciseId: 'old', sets: [{ weight: '50', reps: '10', done: true }] }, { exerciseId: 'padel', sets: [{ weight: '', reps: '1', done: true }] }, { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 10000, duration: 3000, done: true }] }, { exerciseId: 'bench', sets: [{ weight: 95, reps: '5', done: true }] }] }],
  templates: [{ id: 't1', name: 'Push day with a long template name', location: 'Gym A', entries: [{ exerciseId: 'bench', note: 'Belt', superset: 'a', sets: [{ weight: 60, reps: 5, type: 'warmup' }, { weight: 100, reps: 5 }] }, { exerciseId: 'row', superset: 'a', sets: [{ weight: '', reps: 10 }] }, { exerciseId: 'run', sets: [{ weight: '', reps: '', distance: 5000, duration: 1500 }] }] }],
  active: null,
  bodyweights: Array.from({ length: 40 }, (_, i) => { const d = new Date(2026, 9, 28 - i); return { id: `bw${i}`, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, kg: 101.3 + Math.sin(i) * 1.4 + i * 0.05, ...(i === 3 ? { note: 'A long note about how the weigh-in went after a very salty dinner' } : {}) }; }),
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone SE'], viewport: { width, height: 640 }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
  const page = await ctx.newPage(); const F = require('./flow.js')(page);
  const errors = [], problems = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  page.on('dialog', (d) => d.dismiss());
  await page.clock.setFixedTime(new Date('2026-10-28T18:00:00+01:00'));
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(data)]);
  await page.goto('http://localhost:3000/training-tracker/');
  const wait = (ms = 250) => page.waitForTimeout(ms);
  let screens = 0;
  async function inspect(label) {
    screens++;
    const r = await page.evaluate(() => {
      const vw = window.innerWidth;
      const out = [];
      if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${vw}px)`);
      const sheet = document.querySelector('#sheet:not(.hidden) .sheet-body');
      if (sheet && sheet.scrollWidth > sheet.clientWidth + 1) out.push(`panel scrolls sideways (${sheet.scrollWidth} > ${sheet.clientWidth})`);
      document.querySelectorAll('input, select, textarea').forEach((el) => {
        if (el.offsetParent === null || el.type === 'file') return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) out.push(`${el.tagName.toLowerCase()}#${el.id || el.className} font ${fs}px (iOS zooms below 16px)`);
      });
      document.querySelectorAll('#view *, #sheet *').forEach((el) => {
        if (el.offsetParent === null || el.closest('.heat-scroll, .cat-chips, svg')) return;
        const b = el.getBoundingClientRect();
        if (b.width && b.right > vw + 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} sticks out (${Math.round(b.right)}px)`);
      });
      return [...new Set(out)];
    });
    r.forEach((x) => problems.push(`${label}: ${x}`));
  }
  const tab = async (t) => { await go(page, t); await wait(); };
  const close = async () => { const b = await page.$('#sheet:not(.hidden) .sheet-head .link:last-child'); if (b) await b.click(); await wait(); };

  await inspect('Today'); await tab('plans'); await inspect('Plans');
  await tab('workout'); await inspect('Workout start');
  await page.click('[data-action=start-flow]'); await wait(); await inspect('Start chooser');
  await page.click('#sheet [data-action=close-sheet]'); await wait();
  await page.click('[data-action=edit-template]'); await wait(); await inspect('Template editor');
  await page.click('#sheet .set-label[data-entry="0"][data-set="0"]'); await wait(); await inspect('Template set menu');
  await page.click('[data-action=set-menu-back]'); await wait();
  await page.click('[data-action=draft-add-exercise]'); await wait(); await inspect('Template exercise picker');
  await page.click('[data-action=back-to-template]'); await wait();
  await page.click('[data-action=cancel-template]'); await wait();
  await page.click('#view [data-action=review][data-kind=template]'); await wait(); await inspect('Template review'); await F.begin(); await inspect('Live workout from template');
  await tab('home'); await inspect('Today with a workout in progress'); await page.click('[data-action=continue-workout]'); await wait();
  await page.click('[data-action=entry-menu][data-entry="0"]'); await wait(); await inspect('Exercise menu'); await close();
  await page.click('.set-label[data-entry="0"][data-set="1"]'); await wait(); await inspect('Set menu');
  await page.click('[data-action=set-menu-back]'); await wait();
  await page.click('[data-action=toggle-set][data-entry="0"][data-set="0"]'); await wait();
  await page.click('[data-action=toggle-set][data-entry="1"][data-set="0"]'); await wait(); // end of superset round -> rest
  await inspect('Rest timer showing');
  if (await page.isVisible('#sb-rest')) await page.click('[data-action=rest-skip]');
  await page.click('[data-action=add-exercise]'); await wait(); await inspect('Exercise picker');
  await page.fill('#exercise-search', 'New thing with a really long name'); await wait(); await inspect('Picker create option');
  await page.click('[data-action=create-exercise]'); await wait(); await inspect('Category picker'); await close();
  await page.click('[data-action=finish]'); await wait(); await inspect('Finish summary');
  await page.click('#sheet [data-action=close-sheet]'); await wait();
  await page.click('[data-action=discard]').then(() => page.waitForTimeout(500)); await wait();

  await tab('history'); await inspect('History');
  await page.click('[data-action=open-workout][data-id="w2"]'); await wait(); await inspect('Workout details');
  await page.click('[data-action=edit-workout]'); await wait(); await inspect('Workout editor');
  await page.click('[data-action=cancel-wedit]'); await wait(); await page.click('#sheet .sheet-head [data-action=close-sheet]'); await wait();
  await tab('progress'); await inspect('Progress');
  await tab('body'); await inspect('Body weight');
  await page.click('[data-action=bw-list]'); await wait(); await inspect('Weigh-in list');
  await page.click('#sheet [data-action=bw-edit]'); await wait(); await inspect('Weigh-in editor');
  await page.click('[data-action=bw-cancel]'); await wait(); await page.click('#sheet [data-action=close-sheet]'); await wait();
  await page.click('[data-action=bw-goal]'); await wait(); await inspect('Target editor (none yet)');
  await page.fill('#bw-target', '95'); await page.click('[data-action=bw-goal-save]'); await wait(); await inspect('Progress with target');
  await page.click('[data-action=bw-add]'); await wait(); await inspect('Add weigh-in'); await page.click('[data-action=bw-cancel]'); await wait();
  await tab('progress');
  for (const ex of ['bench', 'run', 'padel']) { await page.selectOption('#progress-exercise', ex); await wait(); await inspect(`Progress ${ex}`); }
  await tab('insights'); await inspect('Insights week');
  await page.click('[data-iaction=week][data-dir="-1"]'); await wait(); await inspect('Insights current week');
  for (const v of ['strength', 'cardio', 'balance']) { await page.click(`[data-iaction=view][data-v="${v}"]`); await wait(); await inspect(`Insights ${v}`); }
  await page.click('[data-iaction=view][data-v="cardio"]'); await wait();
  await page.selectOption('#ins-cardio', 'swim'); await wait(); await inspect('Insights cardio swim');
  await page.click('[data-iaction=view][data-v="overview"]'); await wait();
  await tab('statistics'); await inspect('Statistics');
  for (const f of ['weights', 'cardio', 'sports', 'other', 'all']) { await page.click(`[data-saction=filter][data-v="${f}"]`); await wait(); await inspect(`Statistics filter ${f}`); }
  for (const ex of ['bench', 'run', 'swim', 'padel']) { await page.selectOption('#stats-perf-ex', ex); await wait(); await inspect(`Statistics performance ${ex}`); }
  await page.click('[data-saction=freq-mode][data-v="month"]'); await wait(); await inspect('Statistics monthly');
  await page.click('[data-day="2026-10-27"]'); await wait(); await inspect('Heatmap day'); await close();
  await tab('settings'); await inspect('Settings');
  await page.click('[data-action=unit][data-unit=lb]'); await wait();
  for (const t of ['workout', 'history', 'progress', 'statistics']) { await tab(t); await inspect(`${t} in lb`); }
  await tab('settings'); await page.click('[data-action=unit][data-unit=kg]');
  await page.click('[data-action=manage-exercises]'); await wait(); await inspect('Exercise manager');
  await page.click('[data-action=exm-edit][data-id="bench"]'); await wait(); await inspect('Exercise editor');
  await page.click('[data-action=exd-cancel]'); await wait(); await close();
  await page.setInputFiles('#import-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'training-tracker', format: 1, schemaVersion: 2, data })) }); await wait(500);
  await inspect('Restore confirm'); await page.click('[data-action=restore-cancel]'); await wait();
  await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('nope') }); await wait(500);
  await inspect('Restore error'); await close();
  await page.screenshot({ path: `${SP}/crawl-${width}-${scheme}.png` });
  console.log(`width ${width} ${scheme}: ${screens} screens checked`);
  console.log('problems:', problems.length ? '\n  ' + [...new Set(problems)].join('\n  ') : 'none');
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})();
