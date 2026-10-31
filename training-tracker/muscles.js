'use strict';

/*
  Muscle groups and the front/back body figure (inline SVG, no libraries).

  The figure is drawn on a 200 × 440 grid per view. Each muscle region is drawn once for
  the figure's left half and mirrored for the right half, so both sides share one muscle id.
  Regions carry data-muscle (the group id). Colour is a heatmap of weighted sets per week:
  0 → grey (m-none); above 0 → one blue scale (m-on) from very light to strong, with the
  intensity --t = min(sets/week, MUSCLE_HEAT_MAX) / MUSCLE_HEAT_MAX (see muscles.css).
  Not loaded by the app yet: this file currently only provides the figure for review.
*/

/** The 17 groups and the view(s) they appear on. */
const MUSCLE_GROUPS = [
  { id: 'chest', label: 'Chest', views: ['front'] },
  { id: 'front-delts', label: 'Front delts', views: ['front'] },
  { id: 'side-delts', label: 'Side delts', views: ['front', 'back'] },
  { id: 'rear-delts', label: 'Rear delts', views: ['back'] },
  { id: 'biceps', label: 'Biceps', views: ['front'] },
  { id: 'triceps', label: 'Triceps', views: ['back'] },
  { id: 'forearms', label: 'Forearms', views: ['front', 'back'] },
  { id: 'abs', label: 'Abs', views: ['front'] },
  { id: 'obliques', label: 'Obliques', views: ['front'] },
  { id: 'upper-back', label: 'Upper back & traps', views: ['back', 'front'] },
  { id: 'lats', label: 'Lats', views: ['back'] },
  { id: 'lower-back', label: 'Lower back', views: ['back'] },
  { id: 'glutes', label: 'Glutes', views: ['back'] },
  { id: 'quads', label: 'Quads', views: ['front'] },
  { id: 'hamstrings', label: 'Hamstrings', views: ['back'] },
  { id: 'adductors', label: 'Adductors', views: ['front'] },
  { id: 'calves', label: 'Calves', views: ['back', 'front'] }
];
const muscleLabel = (id) => MUSCLE_GROUPS.find((g) => g.id === id)?.label || id;

/* Body outline (left half; head and neck are drawn whole). */
const BODY_HALF = [
  // torso
  'M100.8,60 L88,60 C80,66 68,69 58,72 C52,80 54,96 60,110 C64,140 65,176 66,204 C64,214 64,222 66,232 L67,252 L100.8,252 Z',
  // upper arm
  'M58,72 C45,74 38,88 38,106 C38,124 40,142 43,158 L61,158 C63,140 65,122 65,104 C65,90 63,79 58,72 Z',
  // forearm
  'M43,156 C37,174 35,198 37,222 L53,224 C57,200 61,178 61,156 Z',
  // leg
  'M66,228 C61,256 61,292 67,328 C65,337 65,345 67,353 C63,372 65,396 71,414 L71,424 L93,424 L93,414 C97,394 99,372 97,353 C99,345 99,337 97,328 C100,300 100.8,262 100.8,236 Z'
];
const BODY_WHOLE = [
  '<ellipse cx="100" cy="30" rx="17" ry="21"/>',
  '<path d="M89,44 L111,44 L113,64 L87,64 Z"/>',
  '<ellipse cx="45" cy="236" rx="8" ry="13"/>', '<ellipse cx="155" cy="236" rx="8" ry="13"/>',
  '<ellipse cx="82" cy="429" rx="12" ry="6"/>', '<ellipse cx="118" cy="429" rx="12" ry="6"/>'
];

/* Muscle regions, left half of each view: [muscle id, path]. */
const MUSCLE_SHAPES = {
  front: [
    ['upper-back', 'M88,61 C80,66 71,69 63,72 C74,75 85,74 93,70 Z'],
    ['side-delts', 'M57,73 C45,75 38,88 39,108 L48.5,108 C48.5,96 51,86 58,79 Z'],
    ['front-delts', 'M59.5,78 C53,86 50.5,96 50.5,108 L61,108 C63,99 67,90 74,81 C69,77 64,76 59.5,78 Z'],
    ['chest', 'M98.8,77 L75,79 C67,86 63,96 64,108 C69,118 83,122 98.8,118 Z'],
    ['biceps', 'M46,112 C44,126 45,140 48,153 L59,153 C62,140 63,126 61,112 Z'],
    ['forearms', 'M45,161 C40,177 39,198 41,218 L51,219 C55,198 58,178 58,161 Z'],
    ['abs', 'M85.5,124 L98.8,122 L98.8,199 L88,199 C86,172 85,148 85.5,124 Z'],
    ['obliques', 'M82.5,126 C77,128 72,128 68,126 C69,152 70,178 73,200 L85,198 C83,172 82,150 82.5,126 Z'],
    ['quads', 'M69,234 C63,260 63,294 70,322 L86,322 C88,300 88,276 86,256 C84,246 81,239 77,235 Z'],
    ['adductors', 'M81,236 L98.8,240 C98.4,264 96.5,290 92,312 C91,288 90,262 81,236 Z'],
    ['calves', 'M68,356 C64,372 66,392 71,406 L79,406 C77,390 76,372 77,356 Z'],
    ['calves', 'M89,358 C92,372 92,390 89,404 L94,404 C96,388 96,371 94,357 Z']
  ],
  back: [
    ['upper-back', 'M98.8,54 L90,59 C82,65 71,69 62,73 C71,80 78,92 84,108 C88,119 93,126 98.8,131 Z'],
    ['side-delts', 'M57,73 C45,75 38,88 39,108 L48.5,108 C48.5,96 51,86 58,79 Z'],
    ['rear-delts', 'M59.5,78 C53,86 50.5,96 50.5,108 L61,108 C63,99 66,90 70,82 C67,78 63,77 59.5,78 Z'],
    ['lats', 'M65,94 C66,114 71,142 80,166 C86,160 92,152 96,145 C91,132 86,120 81,110 C75,101 70,96 65,94 Z'],
    ['lower-back', 'M98.8,139 C94,150 87,161 83,171 C85,183 87,193 89,202 L98.8,202 Z'],
    ['triceps', 'M46,112 C44,126 45,140 48,154 L59,154 C62,140 63,126 61,112 Z'],
    ['forearms', 'M45,161 C40,177 39,198 41,218 L51,219 C55,198 58,178 58,161 Z'],
    ['glutes', 'M98.8,212 L76,213 C68,226 68,246 76,258 C84,266 93,265 98.8,259 Z'],
    ['hamstrings', 'M71,266 C66,288 68,310 74,328 L93,328 C97,308 97,286 95,267 C87,270 79,270 71,266 Z'],
    ['calves', 'M69,353 C64,369 66,389 74,403 L91,403 C96,389 96,369 92,353 C84,349 76,349 69,353 Z']
  ]
};

const MIRROR = 'matrix(-1 0 0 1 200 0)';
/** Weighted sets per week at which the colour reaches full strength. */
const MUSCLE_HEAT_MAX = 12;
const muscleHeat = (v) => (v > 0 ? Math.min(v, MUSCLE_HEAT_MAX) / MUSCLE_HEAT_MAX : 0);
/** Coarse level 1–4 (used where colour mixing isn't supported). */
const muscleHeatLevel = (v) => (v > 0 ? Math.min(4, 1 + Math.floor(muscleHeat(v) * 4 - 1e-9)) : 0);
const fmtSetsWeek = (v) => { const r = Math.round(v * 10) / 10; return `${r.toLocaleString()} set${r === 1 ? '' : 's'}/week`; };

/**
 * Front and back figures as HTML. values: { [muscleId]: weighted sets per week };
 * selected: a muscle id (drawn with an outline, never a different colour).
 */
function muscleFigureSvg({ values = {}, selected = null } = {}) {
  const region = (id, d, view) => {
    const v = Number(values[id]) || 0;
    const heat = v > 0 ? ` m-on m-l${muscleHeatLevel(v)}" style="--t:${muscleHeat(v).toFixed(3)}` : ' m-none';
    return `<path d="${d}" class="m-region${heat}" data-muscle="${id}" data-view="${view}"/>`;
  };
  const outline = (name) => (selected && MUSCLE_SHAPES[name].some(([id]) => id === selected)
    ? `<g class="m-outline">${MUSCLE_SHAPES[name].filter(([id]) => id === selected).map(([, d]) => `<path d="${d}"/>`).join('')}<g transform="${MIRROR}">${MUSCLE_SHAPES[name].filter(([id]) => id === selected).map(([, d]) => `<path d="${d}"/>`).join('')}</g></g>` : '');
  const view = (name, title) => {
    const shapes = MUSCLE_SHAPES[name];
    const half = shapes.map(([id, d]) => region(id, d, name)).join('');
    // One accessible button per group in this view (the paths themselves are decoration).
    const ids = [...new Set(shapes.map(([id]) => id))];
    return `
      <figure class="mf-view">
        <svg viewBox="0 0 200 440" class="mf-svg" role="group" aria-label="${title} view">
          <g class="mf-body">${BODY_WHOLE.join('')}${BODY_HALF.map((d) => `<path d="${d}"/>`).join('')}<g transform="${MIRROR}">${BODY_HALF.map((d) => `<path d="${d}"/>`).join('')}</g></g>
          <g class="mf-muscles">${half}<g transform="${MIRROR}">${half}</g></g>
          ${outline(name)}
        </svg>
        <figcaption>${title}</figcaption>
        <div class="mf-hidden-buttons">${ids.map((id) => `<button type="button" class="sr-only" data-muscle="${id}" aria-label="${muscleLabel(id)}: ${Number(values[id]) > 0 ? fmtSetsWeek(Number(values[id])) : 'no sets'}"${selected === id ? ' aria-pressed="true"' : ''}></button>`).join('')}</div>
      </figure>`;
  };
  return `<div class="muscle-figure">${view('front', 'Front')}${view('back', 'Back')}</div>`;
}

/** Legend: grey for no sets, then the blue scale with weighted sets/week marks. */
function muscleLegendHtml() {
  const cells = Array.from({ length: 24 }, (_, i) => (i + 0.5) / 24);
  return `
    <div class="mf-legend" aria-label="Colour scale: grey means no sets; blue gets stronger with more weighted sets per week, up to ${MUSCLE_HEAT_MAX} or more.">
      <span class="mf-key"><i class="m-none-swatch"></i>No sets</span>
      <span class="mf-scale">
        <span class="mf-bar">${cells.map((t) => `<i class="m-on m-l${Math.min(4, 1 + Math.floor(t * 4))}" style="--t:${t.toFixed(3)}"></i>`).join('')}</span>
        <span class="mf-ticks"><span>&lt;1</span><span>4</span><span>8</span><span>${MUSCLE_HEAT_MAX}+</span></span>
      </span>
    </div>
    <div class="mf-legend-note">Weighted sets per week</div>`;
}
