// Navigation and Today screen (five tabs, Progress sections, Settings gear). Usage: node nav-test.js <light|dark> <width>
const { chromium, devices } = require('playwright');
const { go } = require('./nav');
const scheme = process.argv[2] || 'light', width = +(process.argv[3] || 390);
const KEY = 'training-tracker.v1';
const results = [];
const check = (name, got, want) => { const ok = typeof want === 'function' ? want(got) : String(got) === String(want);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${typeof want === 'function' ? 'predicate' : JSON.stringify(want)}`}`); };

// Dates relative to now so "today" and "this week" always line up.
const at = (daysAgo, hour) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d; };
const iso = (d) => d.toISOString();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const W = (id, name, daysAgo) => { const s = at(daysAgo, 7); return { id, name, notes: '', start: iso(s), end: iso(new Date(s.getTime() + 3600e3)),
  entries: [{ exerciseId: 'bench', sets: [{ weight: 60, reps: '10', done: true }, { weight: 60, reps: '9', done: true }] }] }; };
const exercises = [{ id: 'bench', name: 'Bench Press', category: 'Chest' }, { id: 'run', name: 'Running', category: 'Cardio' }];
const base = (extra = {}) => ({ schemaVersion: 2, cardioExercisesAdded: true, active: null, bodyweights: [], templates: [], exercises, workouts: [],
  settings: { unit: 'kg', rest: 90, theme: 'system', plateauWeeks: 6 }, ...extra });

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
  const load = async (data) => { await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, data]); await page.reload(); await wait(300); };
  const title = () => page.innerText('#title');
  const current = () => page.$eval('.tabbar [aria-current=page]', (b) => b.dataset.tab).catch(() => null);
  const sub = () => page.$eval('#view .subnav [aria-current=page]', (b) => b.dataset.tab).catch(() => null);
  const view = () => page.innerText('#view');
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  /* A. New user */
  await load(base());
  check('A opens on Today', `${await title()}|${await current()}`, 'Today|home');
  check('A tab bar: five tabs in order', JSON.stringify(await page.$$eval('.tabbar button', (b) => b.map((x) => x.innerText.trim()))), JSON.stringify(['Today', 'Train', 'Plans', 'Progress', 'History']));
  check('A start card + empty note', `${(await view()).includes('Ready to train?')}|${await page.isVisible('#view [data-action=start-flow]')}|${(await view()).includes('appear here as you log them')}`, 'true|true|true');
  check('A week strip has 7 days, today marked', `${await page.$$eval('.wk-day', (d) => d.length)}|${await page.$$eval('.wk-day.today', (d) => d.length)}`, '7|1');
  check('A week summary empty', await page.innerText('.wk-sum'), 'No workouts yet this week');
  check('A no body-weight block without weigh-ins', await page.$('#view .home-bw'), null);
  check('A Today fits the screen', await noOverflow(), true);
  await go(page, 'progress'); await wait();
  check('A Overview empty state points to Body', `${(await view()).includes('Finish a workout to see your workout progress.')}|${(await view()).includes('Weigh-ins are under Body.')}|${await page.$('#view #bw-quick')}|${await noOverflow()}`, 'true|true|null|true');
  await go(page, 'body'); await wait();
  check('A Body: weigh-in entry with no weigh-ins', `${await page.isVisible('#bw-quick')}|${await page.innerText('[data-action=bw-log-today]')}`, 'true|Log today');
  await go(page, 'home'); await wait();

  /* B. Existing data: workout today, weigh-ins */
  const today = at(0, 12);
  const weekday = (today.getDay() + 6) % 7; // Monday = 0
  const workouts = [W('w0', 'Push day', 0), W('wOld', 'Old session', 20)];
  if (weekday >= 1) workouts.push(W('w1', 'Earlier this week', 1));
  const bws = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, date: ymd(at(i, 12)), kg: 80 + i * 0.1 }));
  const data = base({ workouts, bodyweights: bws });
  await load(data);
  const before = await page.evaluate((k) => localStorage.getItem(k), KEY);
  check('B trained today', `${(await view()).includes('Nice work today')}|${(await page.innerText('.home-today .hero-sub')).includes('Push day')}|${await page.innerText('.home-today .hero-btn')}`, 'true|true|Start Another Workout');
  check('B week strip: today done', await page.$eval('.wk-day.today', (d) => d.classList.contains('done')), true);
  check('B week summary counts this week only', (await page.innerText('.wk-sum')).startsWith(weekday >= 1 ? '2 workouts' : '1 workout'), true);
  check('B recent: latest workout', (await page.innerText('#view [data-action=open-workout]')).includes('Push day'), true);
  check('B body weight: latest + 7-day avg', `${await page.isVisible('.home-bw')}|${(await page.innerText('.home-bw')).includes('80.0') || (await page.innerText('.home-bw')).includes('80')}`, 'true|true');
  check('B Today fits the screen', await noOverflow(), true);
  await page.click('#view [data-action=open-workout]'); await wait();
  check('B recent opens the workout review', `${await page.isVisible('#sheet')}|${(await page.innerText('#sheet')).includes('Push day')}`, 'true|true');
  await page.click('#sheet .sheet-head [data-action=close-sheet]'); await wait();
  await page.click('#view .home-bw'); await wait();
  check('B body-weight block → Progress › Body', `${await title()}|${await current()}|${await sub()}|${await page.isVisible('#bw-quick')}`, 'Progress|progress|body|true');

  /* C. Progress sections */
  await page.click('.tabbar [data-tab=progress]'); await wait();
  check('C Progress remembers the last section', await sub(), 'body');
  check('C five sections', JSON.stringify(await page.$$eval('#view .subnav button', (b) => b.map((x) => x.innerText.trim()))), JSON.stringify(['Overview', 'Insights', 'Muscles', 'Stats', 'Body']));
  for (const [id, text] of [['progress', 'Total workouts'], ['insights', 'Week'], ['statistics', 'Body weight'], ['body', '7-day avg']]) {
    await page.click(`#view .subnav [data-tab=${id}]`); await wait();
    check(`C ${id}: content + highlight`, `${await sub()}|${await current()}|${(await view()).includes(text)}|${await noOverflow()}`, `${id}|progress|true|true`);
  }
  await page.click('#view .subnav [data-tab=insights]'); await wait();
  await go(page, 'history'); await wait();
  await page.click('.tabbar [data-tab=progress]'); await wait();
  check('C back to Progress returns to Insights', await sub(), 'insights');
  await go(page, 'progress'); await wait();
  check('C Overview no longer repeats the body-weight card', await page.$('#view #bw-quick'), null);

  /* D. Settings behind the gear */
  await go(page, 'home'); await wait();
  check('D gear on Today only', `${await page.isVisible('#topbar-action [data-action=open-settings]')}`, 'true');
  await page.click('[data-action=open-settings]'); await wait();
  check('D Settings opens', `${await title()}|${await current()}|${/backup/i.test(await view())}`, 'Settings|home|true');
  await page.click('#view .back-link'); await wait();
  check('D back to Today', await title(), 'Today');
  await go(page, 'history'); await wait();
  check('D no gear on other tabs', await page.$('[data-action=open-settings]'), null);

  /* E. Plans tab */
  await go(page, 'plans'); await wait();
  check('E Plans: program library', `${await title()}|${await current()}|${(await view()).includes('Full Body 3×/week')}|${(await view()).includes('Upper/Lower 4×/week')}|${await noOverflow()}`, 'Plans|plans|true|true|true');

  check('F browsing did not change stored data', before === await page.evaluate((k) => localStorage.getItem(k), KEY), true);

  /* G. Starting from Today; workout in progress */
  await go(page, 'home'); await wait();
  await page.click('#view [data-action=start-flow]'); await wait();
  check('G Start from Today opens the chooser', await page.isVisible('#sheet [data-action=start-empty]'), true);
  await page.click('#sheet [data-action=start-empty]'); await wait(600);
  check('G empty workout starts on Train', `${await title()}|${await current()}|${!!(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).active, KEY))}`, 'Train|workout|true');
  await go(page, 'home'); await wait();
  check('G Today shows the workout in progress, no live bar', `${await page.isVisible('.home-live')}|${await page.isVisible('#home-elapsed')}|${await page.isVisible('#live-bar')}`, 'true|true|false');
  check('G no second start button', await page.$('#view [data-action=start-flow]'), null);
  await go(page, 'history'); await wait();
  check('G live bar on other tabs', await page.isVisible('#live-bar'), true);
  await go(page, 'home'); await wait();
  await page.click('#view [data-action=continue-workout]'); await wait();
  check('G Continue → Train', `${await title()}|${await page.isVisible('#elapsed')}`, 'Train|true');
  await page.reload(); await wait(300);
  check('G reload with a workout in progress opens on Train', `${await title()}|${await current()}`, 'Train|workout');

  check('no page errors', JSON.stringify(errors), '[]');
  console.log(results.join('\n'));
  console.log(`${scheme} ${width}px — PASSES: ${results.filter((r) => r.startsWith('PASS')).length}  FAILS: ${results.filter((r) => r.startsWith('FAIL')).length}`);
  await browser.close();
})();
