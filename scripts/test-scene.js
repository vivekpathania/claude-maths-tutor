// test-scene.js — does the scene checker block wrong pictures and pass right ones?
//
//   node scripts/test-scene.js
//
// Plain node, no framework, same as every other script here. The checker is the
// part that makes a drawn diagram trustworthy, so these are cases where a
// picture is WRONG and must be refused, as much as cases where it is right.
// Touches no database.

const S = require('../public/scene.js');

let pass = 0, fails = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok    ' + name); }
  catch (e) { fails++; console.log('FAIL  ' + name + '\n        ' + e.message); }
}
const has = (list, re) => list.some((m) => re.test(m));
function ok(v, opts)  { const r = S.checkScene(v, opts); if (r.errors.length) throw new Error('expected no errors, got: ' + r.errors.join(' | ')); return r; }
function bad(v, re, opts) {
  const r = S.checkScene(v, opts);
  if (!r.errors.length) throw new Error('expected an error matching ' + re + ', got none');
  if (!has(r.errors, re)) throw new Error('expected an error matching ' + re + ', got: ' + r.errors.join(' | '));
  return r;
}
const scene = (items, facts, extra) => Object.assign({ type: 'scene', facts, items }, extra || {});

/* ── triangle ─────────────────────────────────────────────────────────── */

t('triangle 6,6,4: right sides pass', () =>
  ok(scene([{ m: 'triangle', id: 'T', sides: [6, 6, 4] }], [{ measure: 'sides', of: 'T', equals: [6, 6, 4] }])));

t('triangle: a fact that disagrees with the drawing is blocked', () =>
  bad(scene([{ m: 'triangle', id: 'T', sides: [6, 6, 4] }], [{ measure: 'sides', of: 'T', equals: [6, 6, 5] }]), /draws 4, 6, 6/));

t('triangle: sides that cannot close are refused', () =>
  bad(scene([{ m: 'triangle', sides: [1, 2, 5] }], [{ measure: 'sides', of: 'T', equals: [1, 2, 5] }]), /cannot make a triangle/));

t('triangle: angles that do not add to 180 are refused', () =>
  bad(scene([{ m: 'triangle', angles: [90, 50, 30] }], [{ measure: 'angle', of: 'T@A', equals: 90 }]), /add to 170, not 180/));

t('triangle 3,4,5 gets its square corner by itself, at C', () => {
  const v = scene([{ m: 'triangle', id: 'T', sides: [3, 4, 5] }], [{ measure: 'angle', of: 'T@C', equals: 90 }]);
  ok(v);
  const marks = S.expand(v).atoms.filter((a) => a.a === 'angleMark' && a.right);
  if (marks.length !== 1) throw new Error('expected exactly one square-corner mark, got ' + marks.length);
});

t('triangle 6,8,10 is also right-angled (not just 3,4,5)', () =>
  ok(scene([{ m: 'triangle', id: 'T', sides: [6, 8, 10] }], [{ measure: 'angle', of: 'T@C', equals: 90 }])));

t('triangle 6,6,4 has NO square corner', () => {
  const marks = S.expand(scene([{ m: 'triangle', sides: [6, 6, 4] }], [])).atoms.filter((a) => a.a === 'angleMark');
  if (marks.length) throw new Error('an isosceles 6,6,4 must not be drawn with a right angle');
});

t('triangle from angles 90,50,40 draws a 90 degree corner and 50 at B', () =>
  ok(scene([{ m: 'triangle', id: 'T', angles: [90, 50, 40], base: 5 }],
    [{ measure: 'angle', of: 'T@A', equals: 90 }, { measure: 'angle', of: 'T@B', equals: 50 }])));

t('triangle: equal sides get matching ticks, odd side none', () => {
  const poly = S.expand(scene([{ m: 'triangle', id: 'T', sides: [6, 6, 4] }], [])).atoms.find((a) => a.a === 'polygon');
  const ticks = poly.edges.map((e) => e.ticks).sort();
  if (ticks.join() !== '0,1,1') throw new Error('expected ticks 0,1,1 got ' + ticks.join());
});

t('triangle: scalene gets no ticks, equilateral gets three', () => {
  const sc = S.expand(scene([{ m: 'triangle', id: 'T', sides: [3, 4, 5] }], [])).atoms.find((a) => a.a === 'polygon');
  if (sc.edges.some((e) => e.ticks)) throw new Error('scalene must have no equal-side ticks');
  const eq = S.expand(scene([{ m: 'triangle', id: 'T', sides: [5, 5, 5] }], [])).atoms.find((a) => a.a === 'polygon');
  if (eq.edges.some((e) => e.ticks !== 1)) throw new Error('equilateral must have one tick on every side');
});

t('perimeter and area are measured from the drawing', () =>
  ok(scene([{ m: 'triangle', id: 'T', sides: [3, 4, 5] }],
    [{ measure: 'perimeter', of: 'T', equals: 12 }, { measure: 'area', of: 'T', equals: 6 }])));

t('perimeter that is wrong is blocked', () =>
  bad(scene([{ m: 'triangle', id: 'T', sides: [3, 4, 5] }], [{ measure: 'perimeter', of: 'T', equals: 13 }]), /perimeter of "T" is 13, but the picture draws 12/));

/* ── claim cross-check (a teach step's headline) ──────────────────────── */

const tri664 = scene([{ m: 'triangle', id: 'T', sides: [6, 6, 4] }], [{ measure: 'sides', of: 'T', equals: [6, 6, 4] }]);
t('claim "isosceles" over a 6,6,4 triangle passes', () => ok(tri664, { claim: 'Isosceles: two sides match' }));
t('claim "equilateral" over a 6,6,4 triangle is blocked', () => bad(tri664, /says equilateral/, { claim: 'This is equilateral' }));
t('claim "scalene" over a 6,6,4 triangle is blocked', () => bad(tri664, /says scalene/, { claim: 'Scalene' }));
t('claim "right-angled" over a triangle with no square corner is blocked', () => bad(tri664, /right-angled/, { claim: 'A right-angled triangle' }));
t('a question or contrast is not treated as a claim', () => ok(tri664, { claim: 'Equilateral or isosceles?' }));
t('a negation is not treated as a claim', () => ok(tri664, { claim: 'Not equilateral' }));

/* ── number line ──────────────────────────────────────────────────────── */

const nl = (extra, facts) => scene([Object.assign({ m: 'numberLine', id: 'NL', min: -5, max: 5, step: 1, points: [{ id: 'A', at: -3, label: 'A' }] }, extra)], facts);

t('number line: a marked point reads back as its value', () => ok(nl({}, [{ measure: 'value', of: 'A', equals: -3 }])));
t('number line: a wrong claimed value is blocked', () => bad(nl({}, [{ measure: 'value', of: 'A', equals: 3 }]), /value of "A" is 3, but the picture draws -3/));
t('number line: step that does not divide evenly is refused', () => bad(scene([{ m: 'numberLine', min: 0, max: 10, step: 3 }], [{ measure: 'value', of: 'A', equals: 1 }]), /does not divide evenly/));
t('number line: a point outside the line is refused', () => bad(nl({ points: [{ id: 'A', at: 9 }] }, [{ measure: 'value', of: 'A', equals: 9 }]), /from -5 to 5/));
t('number line: decimals read back exactly', () =>
  ok(scene([{ m: 'numberLine', id: 'NL', min: 0, max: 1, step: 0.1, labelEvery: 5, points: [{ id: 'P', at: 0.3 }] }], [{ measure: 'value', of: 'P', equals: 0.3 }])));

t('mustNotShow: a visible tick label that is the answer is blocked', () =>
  bad(nl({}, [{ measure: 'value', of: 'A', equals: -3 }, { mustNotShow: ['-3'] }]), /which must not be shown/));
t('mustNotShow: hiding that tick label passes', () =>
  ok(nl({ hideLabels: [-3] }, [{ measure: 'value', of: 'A', equals: -3 }, { mustNotShow: ['-3'] }])));
t('mustNotShow matches whole words, so "4" is not found inside "14"', () =>
  ok(scene([{ m: 'numberLine', min: 10, max: 15, step: 1, points: [{ id: 'A', at: 12 }] }], [{ measure: 'value', of: 'A', equals: 12 }, { mustNotShow: ['4'] }])));

/* ── placing several macros side by side ("at") ───────────────────────── */

const threeFacts = [{ measure: 'sides', of: 'T1', equals: [6, 6, 6] }, { measure: 'sides', of: 'T2', equals: [4, 6, 6] }, { measure: 'sides', of: 'T3', equals: [3, 4, 6] }];
const threeItems = (show) => [
  { m: 'triangle', id: 'T1', sides: [6, 6, 6], at: [0, 0], show },
  { m: 'triangle', id: 'T2', sides: [6, 6, 4], at: [8, 0], show },
  { m: 'triangle', id: 'T3', sides: [6, 4, 3], at: [16, 0], show },
];
// Ticks only: which sides match is shown, the numbers go in the question text.
const three = scene(threeItems({ vertices: false, sides: false }), threeFacts);

t('at: three triangles side by side all measure correctly', () => ok(three));
t('layout: three triangles each carrying number labels are blocked — the labels collide', () =>
  bad(scene(threeItems({ vertices: false }), threeFacts), /would land on top of each other/));
t('layout: one labelled triangle is fine', () => ok(tri664));
t('layout: a crowded number line is blocked until its labels are thinned', () => {
  const withPt = (extra) => scene([Object.assign({ m: 'numberLine', id: 'NL', min: -20, max: 20, step: 1, points: [{ id: 'A', at: 0 }] }, extra)], [{ measure: 'value', of: 'A', equals: 0 }]);
  bad(withPt({}), /would land on top of each other/);
  ok(withPt({ labelEvery: 5 }));
});
t('at: they really are apart, not stacked on the origin', () => {
  const polys = S.expand(three).atoms.filter((a) => a.a === 'polygon');
  const minX = polys.map((p) => Math.min.apply(null, p.pts.map((q) => q.x)));
  if (!(minX[0] < minX[1] && minX[1] < minX[2])) throw new Error('triangles overlap: left edges at ' + minX.join(', '));
  const e = polys[1].edges[0];
  if (Math.abs(e.cx - polys[1].pts.reduce((s, q) => s + q.x, 0) / 3) > 1e-9) throw new Error('an edge kept its old centroid, so its label would float off');
});
t('at: a three-triangle headline is not treated as a single-triangle claim', () => ok(three, { claim: 'Equilateral' }));
t('at: a number-line point still reads back after the line is moved', () =>
  ok(scene([{ m: 'numberLine', id: 'NL', min: -5, max: 5, at: [10, 4], points: [{ id: 'A', at: -3 }] }], [{ measure: 'value', of: 'A', equals: -3 }])));
t('at: two arrays on the default id are refused rather than merged', () =>
  bad(scene([{ m: 'array', rows: 1, cols: 2 }, { m: 'array', rows: 1, cols: 3, at: [5, 0] }], [{ measure: 'count', of: 'AR', equals: 5 }]), /share the id "AR"/));
t('at: two arrays with their own ids count separately', () =>
  ok(scene([{ m: 'array', id: 'A1', rows: 1, cols: 2 }, { m: 'array', id: 'A2', rows: 1, cols: 3, at: [5, 0] }],
    [{ measure: 'count', of: 'A1', equals: 2 }, { measure: 'count', of: 'A2', equals: 3 }])));
t('at: a bad offset is refused', () =>
  bad(scene([{ m: 'array', id: 'A', rows: 1, cols: 1, at: ['x', 1] }], [{ measure: 'count', of: 'A', equals: 1 }]), /two finite numbers/));

/* ── angle labels sit inside their corner ─────────────────────────────── */

t('angle labels: a narrow corner\'s label is pushed out further than a square one\'s', () => {
  const cx = S.expand(scene([{ m: 'triangle', id: 'T', angles: [90, 50, 40], base: 5 }], []));
  const L = S.layout(cx);
  const dist = (mark) => {
    const lab = L.texts.find((x) => x.cls === 'angle' && x.text === mark.label);
    return Math.hypot(lab.x - mark.vx, lab.y - mark.vy);
  };
  const marks = cx.atoms.filter((a) => a.a === 'angleMark');
  const at = (deg) => marks.find((m) => m.label === deg + '°');
  if (!(dist(at(40)) > dist(at(50)) && dist(at(40)) > dist(at(90))))
    throw new Error('expected the 40° label farther out than the 50° and 90° ones; got ' + [40, 50, 90].map((d) => dist(at(d)).toFixed(2)).join(' / '));
});

/* ── pieces may not sit on top of each other ──────────────────────────── */

const noLabels = { vertices: false, sides: false };
const two = (gap) => scene([
  { m: 'triangle', id: 'T1', sides: [6, 6, 6], show: noLabels },
  Object.assign({ m: 'triangle', id: 'T2', sides: [6, 6, 4], show: noLabels }, gap == null ? {} : { at: [gap, 0] }),
], [{ measure: 'sides', of: 'T1', equals: [6, 6, 6] }]);

t('overlap: two macros that were never placed sit on the origin and are blocked', () => bad(two(null), /overlap or touch/));
t('overlap: pieces that merely touch are blocked', () => bad(two(6), /overlap or touch/));
t('overlap: pieces with air between them pass, even with no labels to collide', () => ok(two(8)));
t('overlap: the message says how to fix it', () => bad(two(null), /"at"/));
t('overlap: one macro on its own is never an overlap', () => ok(tri664));

/* ── a hidden label can still be read off the gap ─────────────────────── */

const warns = (v) => S.checkScene(v).warnings;
const nlA = (extra) => scene([Object.assign({ m: 'numberLine', id: 'NL', min: -5, max: 5, step: 1, points: [{ id: 'A', at: -3, label: 'A' }] }, extra)], [{ measure: 'value', of: 'A', equals: -3 }]);

t('gap: one hidden tick label between two written ones is warned about', () => {
  if (!has(warns(nlA({ hideLabels: [-3] })), /read the answer off the gap/)) throw new Error('expected a gap warning');
});
t('gap: writing fewer numbers (labelEvery) removes the warning', () => {
  const w = warns(nlA({ hideLabels: [-3], labelEvery: 5 }));
  if (w.length) throw new Error('unexpected warning: ' + w.join(' | '));
});
t('gap: a point whose label is not hidden is not a giveaway of this kind', () => {
  if (warns(nlA({})).length) throw new Error('no label is hidden, so there is no gap');
});
t('gap: hiding the label of a point at the very end is not a gap', () => {
  const w = warns(scene([{ m: 'numberLine', id: 'NL', min: -5, max: 5, hideLabels: [5], points: [{ id: 'A', at: 5 }] }], [{ measure: 'value', of: 'A', equals: 5 }]));
  if (w.length) throw new Error('an end label has only one neighbour, so there is no gap: ' + w.join(' | '));
});
t('gap: a warning never blocks', () => ok(nlA({ hideLabels: [-3] })));

/* ── array ────────────────────────────────────────────────────────────── */

t('array: counts are measured from the dots drawn', () =>
  ok(scene([{ m: 'array', id: 'AR', rows: 3, cols: 4, shaded: 5 }],
    [{ measure: 'count', of: 'AR', equals: 12 }, { measure: 'count', of: 'AR', where: { on: true }, equals: 5 }])));
t('array: a wrong total is blocked', () =>
  bad(scene([{ m: 'array', id: 'AR', rows: 3, cols: 4 }], [{ measure: 'count', of: 'AR', equals: 13 }]), /draws 12/));
t('array: shading more than exists is refused', () =>
  bad(scene([{ m: 'array', id: 'AR', rows: 2, cols: 2, shaded: 9 }], [{ measure: 'count', of: 'AR', equals: 4 }]), /shaded must be a whole number from 0 to 4/));
t('array: explicit shaded cells count correctly', () =>
  ok(scene([{ m: 'array', id: 'AR', rows: 2, cols: 3, shadedCells: [[0, 0], [1, 2]] }], [{ measure: 'count', of: 'AR', where: { on: true }, equals: 2 }])));

/* ── atoms authored by hand ───────────────────────────────────────────── */

const hand = (pts, facts) => scene([{ a: 'polygon', id: 'P', points: pts, labels: true }], facts);
t('atoms: a hand-built 3-4-5 triangle passes', () =>
  ok(hand({ A: [0, 0], B: [4, 0], C: [0, 3] }, [{ measure: 'perimeter', of: 'P', equals: 12 }, { measure: 'angle', of: 'P@A', equals: 90 }])));
t('atoms: coordinates that are a little off are blocked', () =>
  bad(hand({ A: [0, 0], B: [4, 0], C: [0, 3.5] }, [{ measure: 'length', of: 'P.CA', equals: 3 }]), /length of "P.CA" is 3, but the picture draws 3.5/));
t('atoms: an edge can be named in either order', () =>
  ok(hand({ A: [0, 0], B: [4, 0], C: [0, 3] }, [{ measure: 'length', of: 'P.BA', equals: 4 }])));
t('atoms: a rectangle has an area', () =>
  ok(scene([{ a: 'rect', id: 'R', at: [0, 0], w: 4, h: 3 }], [{ measure: 'area', of: 'R', equals: 12 }])));

/* ── the contract itself ──────────────────────────────────────────────── */

t('a scene with no facts is refused — nothing would be verified', () =>
  bad(scene([{ m: 'array', rows: 2, cols: 2 }], []), /at least one measurable fact/));
t('mustNotShow alone is not a fact', () =>
  bad(scene([{ m: 'array', rows: 2, cols: 2 }], [{ mustNotShow: ['x'] }]), /at least one measurable fact/));
t('a request with no items says it has not been illustrated yet', () => {
  const r = bad({ type: 'scene', request: 'a triangle', facts: [{ measure: 'sides', of: 'T', equals: [3, 4, 5] }] }, /not been illustrated yet/);
  if (!r.unresolved) throw new Error('should be flagged unresolved so the pipeline can find it');
});
t('unknown macro, atom, measure and key are all refused', () => {
  bad(scene([{ m: 'hexagon' }], [{ measure: 'count', of: 'x', equals: 1 }]), /unknown macro "hexagon"/);
  bad(scene([{ a: 'blob' }], [{ measure: 'count', of: 'x', equals: 1 }]), /unknown atom "blob"/);
  bad(scene([{ m: 'array', rows: 1, cols: 1, id: 'AR' }], [{ measure: 'weight', of: 'AR', equals: 1 }]), /unknown measure "weight"/);
  bad(scene([{ m: 'array', rows: 1, cols: 1, colour: 'red' }], [{ measure: 'count', of: 'AR', equals: 1 }]), /unknown key "colour"/);
});
t('a fact naming something that is not in the scene is refused', () =>
  bad(scene([{ m: 'array', id: 'AR', rows: 1, cols: 1 }], [{ measure: 'sides', of: 'NOPE', equals: [1, 2, 3] }]), /no polygon called "NOPE"/));
t('two pieces with the same id are refused', () =>
  bad(scene([{ m: 'array', id: 'X', rows: 1, cols: 1 }, { m: 'triangle', id: 'X', sides: [3, 4, 5] }], [{ measure: 'count', of: 'X', equals: 1 }]), /share the id "X"/));
t('non-numeric and huge coordinates are refused', () => {
  bad(scene([{ a: 'point', at: ['1', 2] }], [{ measure: 'count', of: 'x', equals: 0 }]), /two finite numbers/);
  bad(scene([{ a: 'point', at: [1e9, 0] }], [{ measure: 'count', of: 'x', equals: 0 }]), /two finite numbers/);
});

/* ── answer leak, for a question's own picture ────────────────────────── */

t('leak: a label equal to the answer is reported', () => {
  const v = scene([{ m: 'triangle', id: 'T', sides: [6, 6, 4] }], [{ measure: 'sides', of: 'T', equals: [6, 6, 4] }]);
  if (!S.checkLeak(v, '4').length) throw new Error('"4 cm" is printed and the answer is 4 — should be reported');
});
t('leak: hiding the side labels leaves nothing to report', () => {
  const v = scene([{ m: 'triangle', id: 'T', sides: [6, 6, 4], show: { sides: false } }], [{ measure: 'sides', of: 'T', equals: [6, 6, 4] }]);
  if (S.checkLeak(v, '4').length) throw new Error('nothing is printed, so nothing should be reported');
});
t('leak: "4" is not found inside "14 cm"', () => {
  const v = scene([{ m: 'triangle', id: 'T', sides: [14, 14, 10] }], [{ measure: 'sides', of: 'T', equals: [14, 14, 10] }]);
  if (S.checkLeak(v, '4').length) throw new Error('"14 cm" must not count as showing 4');
});

/* ── rendering ────────────────────────────────────────────────────────── */

t('html: draws an svg for each of the three macros', () => {
  [tri664, nl({}, [{ measure: 'value', of: 'A', equals: -3 }]), scene([{ m: 'array', id: 'AR', rows: 3, cols: 4, shaded: 5 }], [{ measure: 'count', of: 'AR', equals: 12 }])]
    .forEach((v) => { const h = S.html(v); if (!/<svg[\s\S]*<\/svg>/.test(h)) throw new Error('no svg for ' + v.items[0].m); });
});
t('html: a broken scene renders nothing, never half a picture', () => {
  if (S.html(scene([{ m: 'triangle', sides: [1, 2, 5] }], [])) !== '') throw new Error('an impossible triangle must render nothing');
});
t('html: text is escaped, so authored text cannot inject markup', () => {
  const h = S.html(scene([{ a: 'text', at: [0, 0], text: '<img src=x onerror=alert(1)>' }, { a: 'point', id: 'p', at: [0, 0] }], [{ measure: 'count', of: 'x', equals: 0 }]), { });
  if (/<img/.test(h)) throw new Error('markup survived: ' + h.slice(0, 200));
});
t('html: a caption is escaped too', () => {
  const h = S.html(Object.assign(scene([{ m: 'array', rows: 1, cols: 1 }], []), { caption: '<b>x</b>' }));
  if (/<b>x/.test(h)) throw new Error('caption markup survived');
});
t('html: output carries no script, no event handler, no foreign element', () => {
  const h = S.html(tri664);
  if (/<script|onerror|onload|javascript:|<foreignObject/i.test(h)) throw new Error('unsafe markup in output');
});

/* ── describe + walk ──────────────────────────────────────────────────── */

t('describe: says what is drawn in words an agent can use', () => {
  const d = S.describe(tri664);
  if (!/sides AB=4.*BC=6.*CA=6/.test(d) || !/ticks/.test(d)) throw new Error('unexpected description: ' + d);
});
t('walkScenes: finds scenes anywhere, with the question they belong to', () => {
  const session = { practice: [{ id: 'p_1', ask: 'What type?', answer: 'isosceles', visual: tri664 }],
                    teach: { cycles: [{ steps: [{ big: 'Isosceles', visual: tri664 }], q: { ask: 'g', correctVisual: tri664 } }] } };
  const w = S.walkScenes(session);
  if (w.length !== 3) throw new Error('expected 3 scenes, found ' + w.length);
  if (w[0].ask !== 'What type?' || w[0].answer !== 'isosceles') throw new Error('lost the question context');
  if (!w.some((x) => x.big === 'Isosceles')) throw new Error('lost the step headline');
});

console.log('\n' + (fails ? fails + ' FAILED, ' : '') + pass + ' passed');
process.exitCode = fails ? 1 : 0;
