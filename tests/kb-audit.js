// Keyboard geometry audit (not part of run.js): for each form with text fields, which fields and
// action buttons sit where an iPhone keyboard would be. Usage: node tests/kb-audit.js (app served on :3000).
const { chromium, devices } = require('playwright');
const FORMS = {
  'Weigh-in (add)': () => openWeighInEditor(null),
  'Target weight': () => openGoalEditor(),
  'Exercise editor (new)': () => openExerciseEditor(null),
  'Template editor (2 exercises)': () => { beginTemplateDraft(null); ui.draft.name = 'A'; ['Bench Press', 'Squat'].forEach((n) => ui.draft.entries.push({ exerciseId: state.exercises.find((e) => e.name === n).id, sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }] })); openTemplateEditor(); },
  'Edit saved workout': () => { beginWorkoutEdit(state.workouts[0]); openWorkoutEditor(); },
  'Plan session (move date)': () => { const p = state.plans[0]; const s = sessionStatuses(p).find((x) => x.date >= todayKey()); openPlanSession(`${p.id}|${s.key}`); },
  'Strength plan setup': () => openProgramSetup('full-body-3'),
  'Run plan setup': () => openRunSetup('5k'),
  'Swim plan setup': () => openSportSetup('swim'),
  'Ride plan setup': () => openSportSetup('bike'),
  'Finish (over 4 h)': () => { state.active = { id: 'a', name: 'E', notes: '', start: new Date(Date.now() - 6 * 3600e3).toISOString(), entries: [{ exerciseId: state.exercises[0].id, sets: [{ weight: 80, reps: '5', done: true }] }] }; ui.tab = 'workout'; render(); openFinishSheet(); }
};
const SIZES = [{ w: 320, h: 568, kb: 253 + 44 }, { w: 375, h: 667, kb: 260 + 44 }, { w: 390, h: 844, kb: 291 + 44 }];
(async () => {
  const b = await chromium.launch();
  const rows = [];
  for (const scheme of ['light', 'dark']) for (const sz of SIZES) {
    const ctx = await b.newContext({ ...devices['iPhone 14'], viewport: { width: sz.w, height: sz.h }, colorScheme: scheme, timezoneId: 'Europe/Zagreb', locale: 'en-GB' });
    const p = await ctx.newPage(); p.on('pageerror', (e) => rows.push(`ERR ${e.message}`));
    await p.goto('http://localhost:3000/training-tracker/'); await p.waitForTimeout(300);
    await p.evaluate(() => { localStorage.clear(); state = defaultState(); const id = (n) => state.exercises.find((e) => e.name === n).id;
      state.workouts = [{ id: 'w1', name: 'Push', notes: '', start: new Date(Date.now() - 86400e3).toISOString(), end: new Date(Date.now() - 86400e3 + 3600e3).toISOString(), entries: [{ exerciseId: id('Bench Press'), sets: [{ weight: 80, reps: '5', done: true }, { weight: 80, reps: '5', done: true }] }, { exerciseId: id('Squat'), sets: [{ weight: 100, reps: '5', done: true }] }] }];
      const r = createPlan(PLAN_LIBRARY.get('full-body-3'), { days: [0, 2, 4], weeks: 4, deload: 4 }, todayKey()); resolveProgramExercises(r.plan, state); state.plans.push(r.plan); save(); });
    for (const [name, open] of Object.entries(FORMS)) {
      await p.evaluate(() => { closeSheet(); state.active = null; ui.tab = 'home'; render(); });
      await p.evaluate(`(${open.toString()})()`); await p.waitForTimeout(350);
      const r = await p.evaluate(([H, K]) => {
        const kbTop = H - K;
        const body = document.querySelector('#sheet .sheet-body');
        const room = body ? body.scrollHeight - body.clientHeight : 0;
        const fields = [...document.querySelectorAll('#sheet input, #sheet textarea, #sheet select')].filter((el) => el.offsetParent && !['checkbox', 'radio', 'hidden'].includes(el.type));
        const covered = fields.filter((el) => el.getBoundingClientRect().bottom > kbTop);
        // Could the sheet body scroll the covered field above the keyboard?
        const stuck = covered.filter((el) => el.getBoundingClientRect().bottom - kbTop + 8 > room - (body?.scrollTop || 0));
        const foot = [...document.querySelectorAll('#sheet .sheet-foot .btn')].map((x) => x.textContent.trim());
        const head = [...document.querySelectorAll('#sheet .sheet-head button')].map((x) => x.textContent.trim()).filter(Boolean);
        const sheetTop = document.querySelector('#sheet').getBoundingClientRect().top;
        return { n: fields.length, covered: covered.length, stuck: stuck.map((e) => e.id || e.dataset.rs || e.dataset.ss || e.className || e.tagName).slice(0, 4), foot, head, sheetTop: Math.round(sheetTop), sheetH: Math.round(document.querySelector('#sheet').getBoundingClientRect().height) };
      }, [sz.h, sz.kb]);
      rows.push(`${scheme} ${sz.w}x${sz.h} kb${sz.kb} | ${name} | fields ${r.n}, below keyboard at open ${r.covered}, can't be scrolled above it: ${r.stuck.length ? r.stuck.join(',') : 'none'} | head: ${r.head.join(' / ')} | foot: ${r.foot.join(' / ') || '-'} | sheet ${r.sheetTop}+${r.sheetH}`);
    }
    await ctx.close();
  }
  console.log(rows.join('\n'));
  await b.close();
})();
