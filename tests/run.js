#!/usr/bin/env node
// Runs the training-tracker browser tests and prints one pass/fail summary.
//
//   node tests/run.js              full run: light + dark, 320/390 px (and 320/375/414 for the layout crawl)
//   node tests/run.js --quick      light only, one width each (a few minutes)
//   node tests/run.js --only=hist-test,prog-test
//   node tests/run.js --jobs=3     run suites in parallel (default 2)
//
// Starts tests/server.js on port 3000 unless something already serves the app there.
// Screenshots and generated files go to tests/out/ (git-ignored). Exit code 1 if anything failed.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const args = process.argv.slice(2);
const opt = (name) => { const a = args.find((x) => x.startsWith(`--${name}`)); return a ? (a.split('=')[1] ?? true) : null; };
const quick = !!opt('quick');
const only = opt('only') ? String(opt('only')).split(',') : null;
const jobs = Math.max(1, +(opt('jobs') || 2));
const OUT = path.join(__dirname, 'out');
const SUITES = path.join(__dirname, 'suites');
fs.mkdirSync(path.join(OUT, 'backup-files'), { recursive: true });

const schemes = quick ? ['light'] : ['light', 'dark'];
const widths = quick ? [390] : [320, 390];
const crawlWidths = quick ? [375] : [320, 375, 414];
// Suites taking (outDir, scheme)
const classic = ['logging-test', 'tpl-test', 'cardio-test', 'wedit-test', 'exlib-test', 'units-test', 'backup-test', 'ps-test', 'stats-test', 'stats-test-ny', 'insights-test', 'plan-test', 'format-test', 'program-test', 'run-test', 'sport-test'];
// Suites taking (scheme, width)
const sized = ['wk-test', 'bw-test', 'bwi-test', 'hist-test', 'prog-test', 'nav-test', 'safety-test'];

const list = [];
for (const sc of schemes) {
  for (const s of classic) list.push({ name: s, label: `${s} ${sc}`, args: [OUT, sc] });
  for (const s of sized) for (const w of widths) list.push({ name: s, label: `${s} ${sc} ${w}`, args: [sc, String(w)] });
  for (const w of crawlWidths) list.push({ name: 'crawl-test', label: `crawl-test ${sc} ${w}`, args: [OUT, String(w), sc], crawl: true });
}
const todo = list.filter((t) => !only || only.includes(t.name));

const up = () => new Promise((res) => http.get('http://localhost:3000/training-tracker/', (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));

function runOne(t) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(process.execPath, [path.join(SUITES, `${t.name}.js`), ...t.args], { env: { ...process.env, TZ: 'Europe/Zagreb' }, cwd: OUT });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 6 * 60 * 1000);
    p.on('close', (code) => {
      clearTimeout(timer);
      const fails = out.split('\n').filter((l) => l.startsWith('FAIL '));
      let ok, summary;
      if (t.crawl) {
        ok = code === 0 && /problems: none/.test(out) && /errors: \[\]/.test(out);
        summary = (out.match(/\d+ screens checked/) || ['no result'])[0];
      } else {
        const passes = (out.match(/PASSES: (\d+)/) || [])[1] ?? String(out.split('\n').filter((l) => l.startsWith('PASS ')).length);
        const failCount = (out.match(/FAILS: (\d+)/) || [])[1];
        ok = code === 0 && failCount === '0' && !fails.length;
        summary = passes != null ? `${passes} passed, ${failCount} failed` : failCount != null ? `${failCount} failed` : 'no result';
      }
      resolve({ ...t, ok, summary, fails, out, secs: Math.round((Date.now() - started) / 1000) });
    });
  });
}

(async () => {
  let server = null;
  if (!(await up())) {
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), path.join(__dirname, '..'), '3000'], { stdio: 'ignore' });
    for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
  }
  if (!(await up())) { console.error('Could not reach http://localhost:3000/training-tracker/'); process.exit(2); }
  console.log(`Running ${todo.length} suite runs (${jobs} at a time)…`);
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (i < todo.length) {
      const t = todo[i++];
      const r = await runOne(t);
      results.push(r);
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(26)} ${r.summary} (${r.secs}s)`);
      if (!r.ok) {
        const detail = r.fails.length ? r.fails.slice(0, 5) : r.out.trim().split('\n').slice(-6);
        detail.forEach((l) => console.log(`      ${l.slice(0, 220)}`));
      }
    }
  }));
  if (server) server.kill();
  const bad = results.filter((r) => !r.ok);
  const lines = results.sort((a, b) => a.label.localeCompare(b.label)).map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.label}  ${r.summary}`);
  fs.writeFileSync(path.join(OUT, 'summary.txt'), `${lines.join('\n')}\n`);
  console.log(`\n${results.length - bad.length}/${results.length} suite runs passed${bad.length ? ` — failed: ${bad.map((r) => r.label).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
})();
