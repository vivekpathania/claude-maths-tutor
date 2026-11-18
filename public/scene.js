/* scene.js — declarative diagrams, drawn AND measured by the same code.
 *
 * Loaded two ways, same file, same pattern as session-shape.js:
 *   browser — <script src="/scene.js"></script>   → window.SceneLib
 *   node    — require('../public/scene.js')       → module.exports
 *
 * Why one module for both: the page turns a scene into SVG, and
 * verify-session.js turns the SAME scene back into measurements (side lengths,
 * angles, counts, values) and compares them with the facts the author stated.
 * If those were two implementations they could drift, and a diagram could pass
 * its check while drawing something else. Here they cannot.
 *
 * Agents never write SVG or HTML. A scene is data:
 *
 *   { "type": "scene",
 *     "request": "A triangle the child can classify by its sides",   // intent, optional
 *     "facts":   [ { "measure": "sides", "of": "T", "equals": [6, 6, 4] },
 *                  { "mustNotShow": ["isosceles"] } ],               // the contract
 *     "items":   [ { "m": "triangle", "id": "T", "sides": [6, 6, 4] } ],   // the drawing
 *     "caption": "optional" }
 *
 * `facts` is written by whoever owns the maths (teacher / author). `items` is
 * written by the illustrator agent. The checker recomputes every fact from the
 * items and blocks the session if they disagree — a wrong picture is as bad as
 * a wrong answer key, because it teaches the error directly.
 *
 * Items are MACROS ({ "m": ... } — the page does the geometry, so nobody can
 * get it wrong) or ATOMS ({ "a": ... } — flexible, and still checked).
 * See docs/visuals.md.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SceneLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var EPS = 1e-9;
  var MAX_ATOMS = 400;
  var MAX_COORD = 10000;
  var MAX_TEXT = 40;

  /* ── small helpers ───────────────────────────────────────────────────── */

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function extend(a, b) { for (var k in b) if (has(b, k)) a[k] = b[k]; return a; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 6 decimals, no float noise; real minus sign so "-3" reads as a number.
  function fmt(n) {
    var s = String(parseFloat(Number(n).toFixed(6)));
    return s.charAt(0) === '-' ? '−' + s.slice(1) : s;
  }
  // For error messages and descriptions an agent will read and may copy back
  // into a fact: a plain "-", never the typographic minus fmt() puts on a label.
  function shown(n) { return String(Math.round(n * 1000) / 1000); }
  // Normalised, space-padded text, so a phrase only matches on word boundaries
  // ("4" must not match inside "14 cm", but must match "4 cm" and "4°").
  function plain(s) {
    return ' ' + String(s == null ? '' : s).replace(/−/g, '-').replace(/[°%]/g, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase() + ' ';
  }
  function hasPhrase(text, phrase) {
    var p = plain(phrase);
    return p.trim() !== '' && plain(text).indexOf(p) >= 0;
  }
  function dist(x1, y1, x2, y2) { return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)); }
  function angleDeg(px, py, ax, ay, bx, by) {
    var ux = ax - px, uy = ay - py, vx = bx - px, vy = by - py;
    return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180 / Math.PI;
  }
  function near(a, b, tol) { return Math.abs(a - b) <= tol; }

  /* ── expansion context ───────────────────────────────────────────────── */

  function newCtx() { return { atoms: [], byId: {}, axes: {}, errors: [], warnings: [] }; }
  function fail(cx, msg) { cx.errors.push(msg); }

  function add(cx, atom) {
    if (cx.atoms.length >= MAX_ATOMS) {
      if (!cx.capped) { cx.capped = true; fail(cx, 'Scene has more than ' + MAX_ATOMS + ' pieces — simplify it.'); }
      return atom;
    }
    cx.atoms.push(atom);
    if (atom.id != null) {
      if (has(cx.byId, atom.id)) fail(cx, 'Two pieces share the id "' + atom.id + '".');
      else cx.byId[atom.id] = atom;
    }
    return atom;
  }

  function pt(cx, v, where) {
    if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1]) ||
        Math.abs(v[0]) > MAX_COORD || Math.abs(v[1]) > MAX_COORD) {
      fail(cx, where + ': a point must be [x, y] with two finite numbers.');
      return null;
    }
    return v;
  }

  function centroid(pts) {
    var x = 0, y = 0;
    pts.forEach(function (p) { x += p.x; y += p.y; });
    return [x / pts.length, y / pts.length];
  }

  function checkKeys(cx, it, allowed, label) {
    for (var k in it) {
      if (has(it, k) && allowed.indexOf(k) < 0)
        fail(cx, label + ': unknown key "' + k + '". Allowed: ' + allowed.join(', ') + '.');
    }
  }

  function cleanText(cx, s, where) {
    var t = String(s == null ? '' : s);
    if (t.length > MAX_TEXT) { fail(cx, where + ': text is ' + t.length + ' characters, over the ' + MAX_TEXT + ' limit.'); return t.slice(0, MAX_TEXT); }
    return t;
  }

  // A polygon plus a virtual segment per edge. The edges are never drawn as
  // lines (the outline does that) — they exist so a fact can name "T.AB" and so
  // an edge can carry equal-length ticks and a length label.
  function addPolygon(cx, id, pts, opts) {
    opts = opts || {};
    var poly = add(cx, { a: 'polygon', id: id, pts: pts, fill: !!opts.fill });
    var c = centroid(pts);
    poly.edges = [];
    for (var i = 0; i < pts.length; i++) {
      var j = (i + 1) % pts.length;
      var e = { a: 'segment', id: id + '.' + pts[i].n + pts[j].n, x1: pts[i].x, y1: pts[i].y,
                x2: pts[j].x, y2: pts[j].y, virtual: true, ticks: 0, label: null, cx: c[0], cy: c[1] };
      add(cx, e);
      poly.edges.push(e);
    }
    if (opts.labelVertices) {
      pts.forEach(function (p) {
        var dx = p.x - c[0], dy = p.y - c[1], d = Math.sqrt(dx * dx + dy * dy) || 1;
        add(cx, { a: 'text', x: p.x, y: p.y, text: p.n, dir: [dx / d, dy / d], gap: 1.1, cls: 'vtx' });
      });
    }
    return poly;
  }

  /* ── macros ──────────────────────────────────────────────────────────── */

  // triangle — sides:[a,b,c] OR angles:[A,B,C]. a is opposite vertex A, so
  // a=|BC|, b=|CA|, c=|AB|. Equal sides get matching tick marks and a square
  // corner appears wherever an angle is 90°, both worked out from the numbers —
  // nothing is declared separately, so nothing can contradict the lengths.
  function mTriangle(m, cx) {
    checkKeys(cx, m, ['m', 'id', 'at', 'sides', 'angles', 'base', 'names', 'unit', 'show'], 'triangle');
    var id = m.id || 'T';
    var names = (Array.isArray(m.names) && m.names.length === 3) ? m.names.map(String) : ['A', 'B', 'C'];
    var byAngles = Array.isArray(m.angles);
    var show = extend({ sides: !byAngles, angles: byAngles, ticks: true, rightMark: true, vertices: true }, m.show || {});
    var unit = m.unit == null ? 'cm' : String(m.unit);
    var a, b, c;

    if (Array.isArray(m.sides) && m.sides.length === 3 && !byAngles) {
      a = m.sides[0]; b = m.sides[1]; c = m.sides[2];
      if (![a, b, c].every(function (n) { return isNum(n) && n > 0; }))
        return fail(cx, id + ': sides must be three positive numbers.');
      if (a + b <= c + EPS || b + c <= a + EPS || a + c <= b + EPS)
        return fail(cx, id + ': sides ' + [a, b, c].join(', ') + ' cannot make a triangle — the two shorter sides must add to more than the longest.');
    } else if (byAngles && m.angles.length === 3) {
      var A = m.angles[0], B = m.angles[1], C = m.angles[2];
      if (![A, B, C].every(function (n) { return isNum(n) && n > 0 && n < 180; }))
        return fail(cx, id + ': angles must be three numbers between 0 and 180.');
      if (!near(A + B + C, 180, 1e-6))
        return fail(cx, id + ': angles ' + [A, B, C].join(', ') + ' add to ' + fmt(A + B + C) + ', not 180.');
      var base = isNum(m.base) && m.base > 0 ? m.base : 6, rad = Math.PI / 180;
      c = base;
      a = base * Math.sin(A * rad) / Math.sin(C * rad);
      b = base * Math.sin(B * rad) / Math.sin(C * rad);
    } else {
      return fail(cx, id + ': give either "sides": [a, b, c] or "angles": [A, B, C].');
    }

    // L[i][j] = length of the edge between vertices i and j (0=A, 1=B, 2=C).
    var L = [[0, c, b], [c, 0, a], [b, a, 0]];
    var tol = 1e-9 * Math.max(a, b, c, 1);

    // Layout: a right angle sits bottom-left with its legs on the axes; an
    // isosceles triangle stands on its odd side so the apex is centred;
    // otherwise the longest side is the base.
    var opp = [a, b, c];
    var adj = [[b, c], [a, c], [a, b]];
    var rightAt = -1;
    for (var r = 0; r < 3; r++) {
      if (near(opp[r] * opp[r], adj[r][0] * adj[r][0] + adj[r][1] * adj[r][1], 1e-9 * opp[r] * opp[r])) rightAt = r;
    }
    var i, j, k;
    if (rightAt >= 0) {
      i = rightAt;
      var others = [0, 1, 2].filter(function (v) { return v !== i; });
      j = L[i][others[0]] >= L[i][others[1]] ? others[0] : others[1];
      k = others[0] === j ? others[1] : others[0];
    } else {
      var edges = [[0, 1, c], [1, 2, a], [2, 0, b]], pick = null, e;
      for (e = 0; e < 3; e++) {
        var o = edges.filter(function (_, n) { return n !== e; });
        if (near(o[0][2], o[1][2], tol) && !near(edges[e][2], o[0][2], tol)) pick = edges[e];
      }
      if (!pick) pick = edges.slice().sort(function (p, q) { return q[2] - p[2]; })[0];
      i = pick[0]; j = pick[1]; k = 3 - i - j;
    }
    var P = [null, null, null];
    P[i] = { x: 0, y: 0 };
    P[j] = { x: L[i][j], y: 0 };
    if (rightAt >= 0) P[k] = { x: 0, y: L[i][k] };
    else {
      var dij = L[i][j], dik = L[i][k], djk = L[j][k];
      var x = (dik * dik + dij * dij - djk * djk) / (2 * dij);
      P[k] = { x: x, y: Math.sqrt(Math.max(0, dik * dik - x * x)) };
    }
    var pts = P.map(function (p, n) { return { n: names[n], x: p.x, y: p.y }; });

    var poly = addPolygon(cx, id, pts, { labelVertices: show.vertices });
    var lens = [c, a, b];                       // edges are AB, BC, CA
    if (show.ticks) {
      var groups = [], t = 0;
      lens.forEach(function (len, n) {
        var g = groups.filter(function (q) { return near(q.len, len, tol); })[0];
        if (!g) { g = { len: len, idx: [] }; groups.push(g); }
        g.idx.push(n);
      });
      groups.forEach(function (g) {
        if (g.idx.length > 1) { t++; g.idx.forEach(function (n) { poly.edges[n].ticks = t; }); }
      });
    }
    if (show.sides) poly.edges.forEach(function (ed, n) { ed.label = fmt(lens[n]) + (unit ? ' ' + unit : ''); });

    pts.forEach(function (p, n) {
      var q = pts[(n + 1) % 3], s = pts[(n + 2) % 3];
      var deg = angleDeg(p.x, p.y, q.x, q.y, s.x, s.y);
      var right = near(deg, 90, 0.01) && show.rightMark;
      if (right || show.angles)
        add(cx, { a: 'angleMark', id: id + '@' + p.n + '.mark', vx: p.x, vy: p.y, ax: q.x, ay: q.y, bx: s.x, by: s.y,
                  right: right, label: show.angles ? fmt(deg) + '°' : null });
    });
  }

  // numberLine — min..max, a tick every `step`, optional points. Positions come
  // from the values, and a point's value is read back from where it was drawn.
  function mNumberLine(m, cx) {
    checkKeys(cx, m, ['m', 'id', 'at', 'min', 'max', 'step', 'labelEvery', 'hideLabels', 'points', 'arrows'], 'numberLine');
    var id = m.id || 'NL', min = m.min, max = m.max, step = m.step == null ? 1 : m.step;
    if (!isNum(min) || !isNum(max) || !isNum(step) || max <= min || step <= 0)
      return fail(cx, id + ': needs numbers with min < max and step > 0.');
    var n = Math.round((max - min) / step);
    if (!near(n * step, max - min, 1e-9 * Math.max(1, max - min)))
      return fail(cx, id + ': step ' + step + ' does not divide evenly from ' + min + ' to ' + max + '.');
    if (n > 200) return fail(cx, id + ': more than 200 ticks — use a bigger step.');

    var ref = max - min, tickH = ref * 0.03, e = ref * 0.045;
    var labelEvery = m.labelEvery == null ? 1 : Math.max(1, Math.round(m.labelEvery));
    var hide = Array.isArray(m.hideLabels) ? m.hideLabels : [];
    cx.axes[id] = { x0: 0, v0: min, k: 1 };

    add(cx, { a: 'segment', id: id + '.line', x1: -e, y1: 0, x2: ref + e, y2: 0, ticks: 0, label: null,
              arrow: m.arrows === false ? null : 'both' });
    for (var t = 0; t <= n; t++) {
      var v = min + t * step, x = t * step;
      add(cx, { a: 'segment', id: id + '.t' + t, x1: x, y1: -tickH, x2: x, y2: tickH, ticks: 0, label: null, tick: true, value: v });
      var hidden = hide.some(function (h) { return isNum(h) && near(h, v, 1e-9 * Math.max(1, Math.abs(v))); });
      if (t % labelEvery === 0 && !hidden)
        add(cx, { a: 'text', x: x, y: -tickH, text: fmt(v), dir: [0, -1], gap: 1.3, cls: 'tick', value: v });
    }
    (Array.isArray(m.points) ? m.points : []).forEach(function (p, pi) {
      if (!p || !isNum(p.at) || p.at < min - EPS || p.at > max + EPS)
        return fail(cx, id + '.points[' + pi + ']: "at" must be a number from ' + min + ' to ' + max + '.');
      add(cx, { a: 'point', id: p.id || (id + '.p' + pi), x: p.at - min, y: 0, axis: id });
      if (p.label)
        add(cx, { a: 'text', x: p.at - min, y: 0, text: cleanText(cx, p.label, id + '.points[' + pi + ']'), dir: [0, 1], gap: 1.5, cls: 'marker' });
    });
  }

  // array — rows × cols of dots, the first `shaded` (reading order) filled.
  function mArray(m, cx) {
    checkKeys(cx, m, ['m', 'id', 'at', 'rows', 'cols', 'shaded', 'shadedCells', 'shape'], 'array');
    var id = m.id || 'AR', rows = m.rows, cols = m.cols;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows * cols > 200)
      return fail(cx, id + ': rows and cols must be whole numbers, with at most 200 in all.');
    var shape = m.shape === 'square' ? 'square' : 'dot';
    var cells = null;
    if (Array.isArray(m.shadedCells)) {
      cells = {};
      m.shadedCells.forEach(function (rc) {
        if (!Array.isArray(rc) || !Number.isInteger(rc[0]) || !Number.isInteger(rc[1]) || rc[0] < 0 || rc[0] >= rows || rc[1] < 0 || rc[1] >= cols)
          fail(cx, id + ': shadedCells holds a [row, col] outside the array.');
        else cells[rc[0] + ',' + rc[1]] = true;
      });
    } else if (m.shaded != null && (!Number.isInteger(m.shaded) || m.shaded < 0 || m.shaded > rows * cols)) {
      return fail(cx, id + ': shaded must be a whole number from 0 to ' + (rows * cols) + '.');
    }
    var shadedN = m.shaded == null ? 0 : m.shaded;
    cx.pxCap = ARRAY_PX_PER_UNIT;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var on = cells ? !!cells[r + ',' + c] : (r * cols + c) < shadedN;
        add(cx, shape === 'square'
          ? { a: 'rect', x: c - 0.45, y: -r - 0.45, w: 0.9, h: 0.9, on: on, group: id, row: r, col: c }
          : { a: 'circle', x: c, y: -r, r: 0.38, on: on, group: id, row: r, col: c });
      }
    }
  }

  var MACROS = { triangle: mTriangle, numberLine: mNumberLine, array: mArray };

  /* ── atoms (authored directly) ───────────────────────────────────────── */

  function aSegment(it, cx) {
    checkKeys(cx, it, ['a', 'id', 'from', 'to', 'ticks', 'label', 'arrow'], 'segment');
    var f = pt(cx, it.from, 'segment.from'), t = pt(cx, it.to, 'segment.to');
    if (!f || !t) return;
    var ticks = it.ticks == null ? 0 : it.ticks;
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > 5) return fail(cx, 'segment.ticks must be a whole number from 0 to 5.');
    add(cx, { a: 'segment', id: it.id, x1: f[0], y1: f[1], x2: t[0], y2: t[1], ticks: ticks,
              label: it.label == null ? null : cleanText(cx, it.label, 'segment.label'), arrow: it.arrow || null });
  }
  function aPolygon(it, cx) {
    checkKeys(cx, it, ['a', 'id', 'points', 'labels', 'fill'], 'polygon');
    var list = [];
    if (Array.isArray(it.points)) {
      it.points.forEach(function (p, n) { var q = pt(cx, p, 'polygon.points[' + n + ']'); if (q) list.push({ n: String.fromCharCode(65 + n), x: q[0], y: q[1] }); });
    } else if (it.points && typeof it.points === 'object') {
      Object.keys(it.points).forEach(function (name) { var q = pt(cx, it.points[name], 'polygon.points.' + name); if (q) list.push({ n: name, x: q[0], y: q[1] }); });
    }
    if (list.length < 3) return fail(cx, 'polygon needs at least 3 points.');
    addPolygon(cx, it.id || 'poly' + cx.atoms.length, list, { labelVertices: !!it.labels, fill: !!it.fill });
  }
  function aCircle(it, cx) {
    checkKeys(cx, it, ['a', 'id', 'at', 'r', 'on', 'group'], 'circle');
    var p = pt(cx, it.at, 'circle.at');
    if (!p) return;
    if (!isNum(it.r) || it.r <= 0) return fail(cx, 'circle.r must be a positive number.');
    add(cx, { a: 'circle', id: it.id, x: p[0], y: p[1], r: it.r, on: !!it.on, group: it.group });
  }
  function aRect(it, cx) {
    checkKeys(cx, it, ['a', 'id', 'at', 'w', 'h', 'on', 'group'], 'rect');
    var p = pt(cx, it.at, 'rect.at');
    if (!p) return;
    if (!isNum(it.w) || !isNum(it.h) || it.w <= 0 || it.h <= 0) return fail(cx, 'rect.w and rect.h must be positive numbers.');
    add(cx, { a: 'rect', id: it.id, x: p[0], y: p[1], w: it.w, h: it.h, on: !!it.on, group: it.group });
  }
  function aText(it, cx) {
    checkKeys(cx, it, ['a', 'id', 'at', 'text', 'anchor'], 'text');
    var p = pt(cx, it.at, 'text.at');
    if (!p) return;
    add(cx, { a: 'text', id: it.id, x: p[0], y: p[1], text: cleanText(cx, it.text, 'text'),
              anchor: ['start', 'middle', 'end'].indexOf(it.anchor) >= 0 ? it.anchor : 'middle', cls: 'free' });
  }
  function aPoint(it, cx) {
    checkKeys(cx, it, ['a', 'id', 'at', 'label'], 'point');
    var p = pt(cx, it.at, 'point.at');
    if (!p) return;
    add(cx, { a: 'point', id: it.id, x: p[0], y: p[1] });
    if (it.label) add(cx, { a: 'text', x: p[0], y: p[1], text: cleanText(cx, it.label, 'point.label'), dir: [0, 1], gap: 1.2, cls: 'marker' });
  }
  function aAngleMark(it, cx) {
    checkKeys(cx, it, ['a', 'id', 'at', 'from', 'to', 'label'], 'angleMark');
    var v = pt(cx, it.at, 'angleMark.at'), f = pt(cx, it.from, 'angleMark.from'), t = pt(cx, it.to, 'angleMark.to');
    if (!v || !f || !t) return;
    var deg = angleDeg(v[0], v[1], f[0], f[1], t[0], t[1]);
    add(cx, { a: 'angleMark', id: it.id, vx: v[0], vy: v[1], ax: f[0], ay: f[1], bx: t[0], by: t[1],
              right: near(deg, 90, 0.5), label: it.label == null ? null : cleanText(cx, it.label, 'angleMark.label') });
  }

  var ATOMS = { segment: aSegment, polygon: aPolygon, circle: aCircle, rect: aRect, text: aText, point: aPoint, angleMark: aAngleMark };

  /* ── expand: items → atoms ───────────────────────────────────────────── */

  var MACRO_ID = { triangle: 'T', numberLine: 'NL', array: 'AR' };   // the id a macro uses when none is given

  // Every macro draws around the origin; "at": [x, y] moves everything it made,
  // so several can sit side by side. Lengths, angles and counts are unchanged by
  // a move, and a number-line point's value is read relative to its own line.
  function shiftFrom(cx, from, axesBefore, dx, dy) {
    for (var i = from; i < cx.atoms.length; i++) {
      var a = cx.atoms[i];
      ['x', 'x1', 'x2', 'vx', 'ax', 'bx', 'cx'].forEach(function (k) { if (isNum(a[k])) a[k] += dx; });
      ['y', 'y1', 'y2', 'vy', 'ay', 'by', 'cy'].forEach(function (k) { if (isNum(a[k])) a[k] += dy; });
      if (a.pts) a.pts.forEach(function (p) { p.x += dx; p.y += dy; });
    }
    Object.keys(cx.axes).forEach(function (id) { if (axesBefore.indexOf(id) < 0) cx.axes[id].x0 += dx; });
  }

  function expand(v) {
    var cx = newCtx(), seen = {};
    cx.pieces = [];                               // [{ id, from, to }] — the atoms each macro made
    (Array.isArray(v && v.items) ? v.items : []).forEach(function (it, n) {
      if (!it || typeof it !== 'object') return fail(cx, 'items[' + n + '] is not an object.');
      if (it.m != null) {
        if (!has(MACROS, it.m)) return fail(cx, 'items[' + n + ']: unknown macro "' + it.m + '". Known: ' + Object.keys(MACROS).join(', ') + '.');
        // Two arrays left on their default id would merge into one group and
        // every count would quietly be wrong, so a repeated id is refused.
        var mid = it.id || MACRO_ID[it.m];
        if (has(seen, mid)) return fail(cx, 'items[' + n + ']: two pieces share the id "' + mid + '" — give each its own "id".');
        seen[mid] = true;
        var from = cx.atoms.length, axesBefore = Object.keys(cx.axes);
        MACROS[it.m](it, cx);
        if (it.at != null) {
          var o = pt(cx, it.at, 'items[' + n + '].at');
          if (o) shiftFrom(cx, from, axesBefore, o[0], o[1]);
        }
        cx.pieces.push({ id: mid, from: from, to: cx.atoms.length });
      } else if (it.a != null) {
        if (!has(ATOMS, it.a)) return fail(cx, 'items[' + n + ']: unknown atom "' + it.a + '". Known: ' + Object.keys(ATOMS).join(', ') + '.');
        ATOMS[it.a](it, cx);
      } else {
        fail(cx, 'items[' + n + '] needs "m" (a macro) or "a" (an atom).');
      }
    });
    return cx;
  }

  /* ── measure: read facts back off the atoms ──────────────────────────── */

  var MEASURES = ['length', 'sides', 'angle', 'perimeter', 'area', 'count', 'value'];

  function findSegment(cx, ref) {
    var s = cx.byId[ref];
    if (s && s.a === 'segment') return s;
    var m = /^(.+)\.(.)(.)$/.exec(ref);          // "T.AB" → also try "T.BA"
    if (m) { s = cx.byId[m[1] + '.' + m[3] + m[2]]; if (s && s.a === 'segment') return s; }
    return null;
  }
  function segLen(s) { return dist(s.x1, s.y1, s.x2, s.y2); }
  function polyArea(p) {
    var s = 0, n = p.pts.length;
    for (var i = 0; i < n; i++) { var q = p.pts[(i + 1) % n]; s += p.pts[i].x * q.y - q.x * p.pts[i].y; }
    return Math.abs(s) / 2;
  }

  // Returns { got, err }. `got` is what the SCENE says, never what was claimed.
  function measure(cx, f) {
    var ref = f.of, s, p, i;
    switch (f.measure) {
      case 'length':
        s = findSegment(cx, ref);
        return s ? { got: segLen(s) } : { err: 'no segment or edge called "' + ref + '"' };
      case 'sides':
        p = cx.byId[ref];
        if (!p || p.a !== 'polygon') return { err: 'no polygon called "' + ref + '"' };
        return { got: p.edges.map(segLen).sort(function (x, y) { return x - y; }) };
      case 'perimeter':
        p = cx.byId[ref];
        if (!p || p.a !== 'polygon') return { err: 'no polygon called "' + ref + '"' };
        return { got: p.edges.reduce(function (t, e) { return t + segLen(e); }, 0) };
      case 'area':
        p = cx.byId[ref];
        if (p && p.a === 'polygon') return { got: polyArea(p) };
        if (p && p.a === 'rect') return { got: p.w * p.h };
        return { err: 'no polygon or rect called "' + ref + '"' };
      case 'angle': {
        var at = String(ref).indexOf('@');
        if (at > 0) {
          p = cx.byId[ref.slice(0, at)];
          if (!p || p.a !== 'polygon') return { err: 'no polygon called "' + ref.slice(0, at) + '"' };
          var name = ref.slice(at + 1), n = p.pts.length;
          for (i = 0; i < n; i++) if (p.pts[i].n === name) break;
          if (i === n) return { err: 'polygon "' + p.id + '" has no vertex "' + name + '"' };
          var a = p.pts[(i + n - 1) % n], b = p.pts[(i + 1) % n], c = p.pts[i];
          return { got: angleDeg(c.x, c.y, a.x, a.y, b.x, b.y) };
        }
        var mk = cx.byId[ref];
        if (!mk || mk.a !== 'angleMark') return { err: 'no angle mark called "' + ref + '"' };
        return { got: angleDeg(mk.vx, mk.vy, mk.ax, mk.ay, mk.bx, mk.by) };
      }
      case 'count': {
        var where = f.where || {}, k = 0;
        cx.atoms.forEach(function (a) {
          if (a.group !== ref) return;
          for (var w in where) if (has(where, w) && a[w] !== where[w]) return;
          k++;
        });
        return { got: k };
      }
      case 'value': {
        p = cx.byId[ref];
        if (!p || p.a !== 'point' || !p.axis) return { err: 'no number-line point called "' + ref + '"' };
        var ax = cx.axes[p.axis];
        return { got: ax.v0 + (p.x - ax.x0) / ax.k };
      }
    }
    return { err: 'unknown measure "' + f.measure + '". Known: ' + MEASURES.join(', ') };
  }

  function tolFor(measureName, expected) {
    if (measureName === 'angle') return 0.5;
    if (measureName === 'count') return 0;
    if (measureName === 'value') return 1e-6 * Math.max(1, Math.abs(expected));
    return Math.max(0.01, 0.005 * Math.abs(expected));
  }

  function checkFact(cx, f, idx) {
    var label = 'facts[' + idx + ']';
    if (!f || typeof f !== 'object') return label + ' is not an object.';
    if (f.mustNotShow != null) return null;
    if (MEASURES.indexOf(f.measure) < 0)
      return label + ': unknown measure ' + JSON.stringify(f.measure) + '. Known: ' + MEASURES.join(', ') + '.';
    if (typeof f.of !== 'string' || !f.of) return label + ': "of" must name a piece of the scene.';
    if (f.equals == null) return label + ': needs "equals".';
    var r = measure(cx, f);
    if (r.err) return label + ': ' + r.err + '.';
    var tol = tolFor(f.measure, Array.isArray(f.equals) ? 0 : f.equals);
    if (f.measure === 'sides') {
      var want = Array.isArray(f.equals) ? f.equals.slice().sort(function (x, y) { return x - y; }) : null;
      if (!want || want.length !== r.got.length || !want.every(isNum))
        return label + ': "sides" needs a list of ' + r.got.length + ' numbers.';
      for (var i = 0; i < want.length; i++)
        if (!near(want[i], r.got[i], tolFor('length', want[i])))
          return label + ': says the sides of "' + f.of + '" are ' + want.join(', ') + ', but the picture draws ' + r.got.map(shown).join(', ') + '.';
      return null;
    }
    if (!isNum(f.equals)) return label + ': "equals" must be a number.';
    if (!near(r.got, f.equals, tol))
      return label + ': says ' + f.measure + ' of "' + f.of + '" is ' + f.equals + ', but the picture draws ' + shown(r.got) + '.';
    return null;
  }

  /* ── checking a whole scene ──────────────────────────────────────────── */

  function texts(cx) {
    return cx.atoms.filter(function (a) { return a.a === 'text'; }).map(function (a) { return a.text; })
      .concat(cx.atoms.filter(function (a) { return a.label; }).map(function (a) { return a.label; }));
  }

  // opts.claim — a teach step's `big`; cross-checked for triangle type words.
  function checkScene(v, opts) {
    opts = opts || {};
    var errors = [], warnings = [];
    if (!v || v.type !== 'scene') return { errors: ['Not a scene.'], warnings: warnings, unresolved: false };
    for (var k in v) if (has(v, k) && ['type', 'request', 'facts', 'items', 'caption'].indexOf(k) < 0)
      errors.push('Unknown key "' + k + '" on a scene. Allowed: type, request, facts, items, caption.');

    var facts = Array.isArray(v.facts) ? v.facts : null;
    if (!facts || !facts.some(function (f) { return f && f.measure; }))
      errors.push('A scene needs "facts" with at least one measurable fact (measure / of / equals) — facts are what the checker recomputes from the drawing. Without one nothing here is verified.');

    if (!Array.isArray(v.items) || !v.items.length) {
      errors.push(v.request
        ? 'This scene has a request but no items — it has not been illustrated yet.'
        : 'This scene has no items to draw.');
      return { errors: errors, warnings: warnings, unresolved: !!v.request };
    }

    var cx = expand(v);
    errors = errors.concat(cx.errors);
    if (cx.errors.length) return { errors: errors, warnings: warnings, unresolved: false };

    (facts || []).forEach(function (f, i) {
      var msg = checkFact(cx, f, i);
      if (msg) errors.push(msg);
      if (f && f.mustNotShow != null) {
        (Array.isArray(f.mustNotShow) ? f.mustNotShow : [f.mustNotShow]).forEach(function (bad) {
          texts(cx).forEach(function (t) {
            if (hasPhrase(t, bad)) errors.push('facts[' + i + ']: the picture shows "' + t + '", which must not be shown.');
          });
        });
      }
    });
    if (opts.claim) errors = errors.concat(checkClaim(cx, opts.claim));
    errors = errors.concat(layoutProblems(cx));
    warnings = warnings.concat(gapGiveaways(cx));
    return { errors: errors, warnings: warnings, unresolved: false };
  }

  // A teach step's headline names a triangle type ("isosceles"). If the scene
  // holds one triangle, its sides must actually fit. Skips anything that reads
  // as a question, a contrast or a negation — those are not claims.
  function checkClaim(cx, claim) {
    var text = String(claim || '');
    if (/\?|\bnot\b|\bno\b|\bor\b/i.test(text)) return [];
    var tris = cx.atoms.filter(function (a) { return a.a === 'polygon' && a.pts.length === 3; });
    if (tris.length !== 1) return [];
    var L = tris[0].edges.map(segLen).sort(function (x, y) { return x - y; });
    var tol = 1e-6 * Math.max(1, L[2]);
    var eq = near(L[0], L[1], tol) ? (near(L[1], L[2], tol) ? 3 : 2) : (near(L[1], L[2], tol) ? 2 : 1);
    var kinds = { equilateral: eq === 3, isosceles: eq === 2, scalene: eq === 1 };
    var named = Object.keys(kinds).filter(function (n) { return new RegExp('\\b' + n + '\\b', 'i').test(text); });
    var out = [], sidesTxt = L.map(shown).join(', ');
    if (named.length === 1 && !kinds[named[0]])
      out.push('"' + text.trim() + '" says ' + named[0] + ', but the triangle drawn has sides ' + sidesTxt + '.');
    if (/\bright[- ]?angled?\b/i.test(text)) {
      var tp = tris[0].pts, hasRight = tp.some(function (p, n) {
        var q = tp[(n + 1) % 3], s = tp[(n + 2) % 3];
        return near(angleDeg(p.x, p.y, q.x, q.y, s.x, s.y), 90, 0.01);
      });
      if (!hasRight) out.push('"' + text.trim() + '" says right-angled, but no corner of the triangle drawn is 90°.');
    }
    return out;
  }

  // Hiding one tick label so a point cannot be read from its own label leaves a
  // hole in the numbers written: "-5 -4 _ -2 -1". The child can then read the
  // answer off the gap instead of working out where the point sits — the
  // `value` fact and `mustNotShow` both pass, and the stimulus is still weak.
  // A warning (it is sometimes what a question wants); the cure is to write
  // fewer numbers, so the child has to count from one they are given.
  function gapGiveaways(cx) {
    var out = [];
    Object.keys(cx.axes).forEach(function (id) {
      var ticks = cx.atoms.filter(function (a) { return a.tick && a.id.indexOf(id + '.t') === 0; });
      var written = cx.atoms.filter(function (a) { return a.a === 'text' && a.cls === 'tick'; })
        .map(function (a) { return a.value; });
      var isWritten = function (v) { return written.some(function (w) { return near(w, v, 1e-9 * Math.max(1, Math.abs(v))); }); };
      var ax = cx.axes[id];
      cx.atoms.filter(function (a) { return a.a === 'point' && a.axis === id; }).forEach(function (p) {
        var pv = ax.v0 + (p.x - ax.x0) / ax.k, i;
        for (i = 0; i < ticks.length; i++) if (near(ticks[i].value, pv, 1e-9 * Math.max(1, Math.abs(pv)))) break;
        if (i === ticks.length || isWritten(ticks[i].value)) return;
        if (i > 0 && i < ticks.length - 1 && isWritten(ticks[i - 1].value) && isWritten(ticks[i + 1].value))
          out.push('On number line "' + id + '" the number at "' + p.id + '" is the only one missing from the numbers written, so the child can read the answer off the gap instead of working out where the point sits — write fewer numbers (labelEvery: 5, say) so they have to count from one they are given.');
      });
    });
    return out;
  }

  // For a question's own picture: does it print the answer? A warning, not an
  // error — a tick label can legitimately equal the answer — while an explicit
  // mustNotShow fact is the hard rule.
  function checkLeak(v, answer) {
    var cx = expand(v), out = [];
    if (cx.errors.length || answer == null || String(answer).trim() === '') return out;
    texts(cx).forEach(function (t) {
      if (hasPhrase(t, answer)) out.push('The picture shows "' + t + '", which is this question\'s answer.');
    });
    return out;
  }

  /* ── describe: plain words, for an agent that cannot see the picture ──── */

  function describe(v) {
    var cx = expand(v);
    if (cx.errors.length) return 'scene with errors: ' + cx.errors.join(' ');
    var out = [], g = {};
    cx.atoms.forEach(function (a) {
      if (a.a === 'polygon') {
        var L = a.edges.map(segLen), ticks = a.edges.map(function (e) { return e.ticks; });
        var line = (a.pts.length === 3 ? 'triangle ' : 'polygon ') + a.id + ' (' + a.pts.map(function (p) { return p.n; }).join('') + '): sides ' +
          a.edges.map(function (e, n) { return e.id.split('.')[1] + '=' + shown(L[n]) + (e.label ? ' [labelled "' + e.label + '"]' : ' [not labelled]'); }).join(', ');
        if (ticks.some(Boolean)) line += '; matching-side ticks on ' + a.edges.filter(function (e) { return e.ticks; }).map(function (e) { return e.id.split('.')[1] + '(' + e.ticks + ')'; }).join(', ');
        var angs = a.pts.map(function (p, n) {
          var q = a.pts[(n + 1) % a.pts.length], s = a.pts[(n + a.pts.length - 1) % a.pts.length];
          return p.n + '=' + shown(angleDeg(p.x, p.y, q.x, q.y, s.x, s.y)) + '°';
        });
        out.push(line + '; angles ' + angs.join(', '));
      } else if (a.group) {
        var e = g[a.group] || (g[a.group] = { total: 0, on: 0, rows: 0, cols: 0 });
        e.total++; if (a.on) e.on++;
        e.rows = Math.max(e.rows, a.row + 1); e.cols = Math.max(e.cols, a.col + 1);
      }
    });
    Object.keys(g).forEach(function (k) { out.push('array ' + k + ': ' + g[k].rows + ' rows × ' + g[k].cols + ' columns, ' + g[k].on + ' of ' + g[k].total + ' shaded'); });
    Object.keys(cx.axes).forEach(function (id) {
      var ticks = cx.atoms.filter(function (a) { return a.tick && a.id.indexOf(id + '.') === 0; });
      var vals = ticks.map(function (a) { return a.value; });
      var written = cx.atoms.filter(function (a) { return a.a === 'text' && a.cls === 'tick'; }).map(function (a) { return a.text; });
      var pts = cx.atoms.filter(function (a) { return a.a === 'point' && a.axis === id; })
        .map(function (a) { return a.id + '=' + shown(cx.axes[id].v0 + a.x); });
      out.push('number line ' + id + ': ' + shown(Math.min.apply(null, vals)) + ' to ' + shown(Math.max.apply(null, vals)) + ', ' + ticks.length + ' ticks; numbers written: ' + (written.join(' ') || 'none') +
        (pts.length ? '; marked points: ' + pts.join(', ') : ''));
    });
    return out.join('\n') || 'empty scene';
  }

  /* ── walking a session for scenes ────────────────────────────────────── */

  // Every scene anywhere in a session, with its path and the nearest question
  // or step text around it (the illustrator needs that context).
  function walkScenes(session) {
    var found = [];
    (function visit(node, path, ctxObj) {
      if (!node || typeof node !== 'object') return;
      if (!Array.isArray(node) && (node.ask != null || node.big != null)) ctxObj = node;
      if (!Array.isArray(node) && node.type === 'scene') {
        found.push({ path: path, visual: node, ask: ctxObj && ctxObj.ask, big: ctxObj && ctxObj.big, answer: ctxObj && ctxObj.answer });
        return;
      }
      if (Array.isArray(node)) node.forEach(function (c, i) { visit(c, path + '[' + i + ']', ctxObj); });
      else Object.keys(node).forEach(function (k) { visit(node[k], path ? path + '.' + k : k, ctxObj); });
    })(session, '', null);
    return found;
  }

  /* ── layout + SVG ────────────────────────────────────────────────────── */

  function r3(n) { return Math.round(n * 1000) / 1000; }

  var CHAR_W = 0.31;                 // half the width of one character, in font sizes
  var TEXT_SCALE = { tick: 0.9 };    // number-line numbers are a touch smaller than other labels
  // A dot array is built from a fixed unit (one dot pitch), so it must not be
  // blown up to fill the card. That does NOT hold for a number line or a
  // triangle, where "one unit" is whatever the numbers happen to be — capping
  // those shrank a 0-to-1 number line to a speck. Only pieces that set
  // cx.pxCap get a maximum size.
  var ARRAY_PX_PER_UNIT = 56;

  // The two rays of an angle mark, as unit vectors, and the way between them.
  function rays(a) {
    var ua = [a.ax - a.vx, a.ay - a.vy], ub = [a.bx - a.vx, a.by - a.vy];
    var la = Math.sqrt(ua[0] * ua[0] + ua[1] * ua[1]) || 1, lb = Math.sqrt(ub[0] * ub[0] + ub[1] * ub[1]) || 1;
    ua = [ua[0] / la, ua[1] / la]; ub = [ub[0] / lb, ub[1] / lb];
    var bis = [ua[0] + ub[0], ua[1] + ub[1]], bl = Math.sqrt(bis[0] * bis[0] + bis[1] * bis[1]);
    bis = bl < 1e-9 ? [-ua[1], ua[0]] : [bis[0] / bl, bis[1] / bl];   // straight angle: step off the line
    return { ua: ua, ub: ub, bis: bis };
  }

  // Where everything goes, worked out ONCE and used both to draw and to check.
  // The illustrator cannot see its picture, so "do two labels land on top of
  // each other" has to be something the checker can answer — and it can only
  // answer truthfully if it measures the very positions the page draws.
  function layout(cx) {
    var atoms = cx.atoms;
    var b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    function grow(x, y) {
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
    }
    atoms.forEach(function (a) {
      if (a.a === 'polygon') a.pts.forEach(function (p) { grow(p.x, p.y); });
      else if (a.a === 'segment') { grow(a.x1, a.y1); grow(a.x2, a.y2); }
      else if (a.a === 'circle') { grow(a.x - a.r, a.y - a.r); grow(a.x + a.r, a.y + a.r); }
      else if (a.a === 'rect') { grow(a.x, a.y); grow(a.x + a.w, a.y + a.h); }
      else if (a.a === 'point' || a.a === 'text') grow(a.x, a.y);
      else if (a.a === 'angleMark') grow(a.vx, a.vy);
    });
    if (!isFinite(b.x0)) return null;
    var fs = 0.055 * Math.max(b.x1 - b.x0, b.y1 - b.y0, 1e-6);

    var texts = [];
    function addText(text, x, y, anchor, cls) {
      var size = fs * (TEXT_SCALE[cls] || 1), hw = CHAR_W * size * String(text).length, hh = 0.62 * size;
      var l = anchor === 'start' ? x : anchor === 'end' ? x - 2 * hw : x - hw;
      texts.push({ text: String(text), x: x, y: y, anchor: anchor, cls: cls, size: size, l: l, r: l + 2 * hw, bt: y - hh, t: y + hh });
    }
    atoms.forEach(function (a) {
      if (a.a === 'text') {
        var d = a.dir || [0, 0], g = (a.gap || 0) * fs;
        addText(a.text, a.x + d[0] * g, a.y + d[1] * g, a.anchor || 'middle', a.cls || 'free');
      } else if (a.a === 'segment' && a.label) {
        var mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2, dx = a.x2 - a.x1, dy = a.y2 - a.y1;
        var len = Math.sqrt(dx * dx + dy * dy) || 1, ox, oy;
        if (a.cx != null) { ox = mx - a.cx; oy = my - a.cy; var ol = Math.sqrt(ox * ox + oy * oy) || 1; ox /= ol; oy /= ol; }
        else { ox = -dy / len; oy = dx / len; if (oy < 0) { ox = -ox; oy = -oy; } }
        // Stand the label off by a clear font-size from the edge whatever its
        // width and whichever way the edge leans — a fixed distance let a wide
        // label touch the equal-length ticks on a steep side.
        var hw = CHAR_W * fs * String(a.label).length, hh = 0.62 * fs;
        var off = 1.0 * fs + Math.abs(ox) * hw + Math.abs(oy) * hh;
        addText(a.label, mx + ox * off, my + oy * off, 'middle', 'side');
      } else if (a.a === 'angleMark' && a.label) {
        var rr = rays(a);
        // A fixed distance put "40°" on top of the edges of a narrow corner. Go
        // out along the bisector until the label's box fits between the two
        // edges — but never past 60% of the shorter edge, or it leaves the corner.
        var theta = Math.acos(Math.max(-1, Math.min(1, rr.ua[0] * rr.ub[0] + rr.ua[1] * rr.ub[1])));
        var lw = CHAR_W * fs * String(a.label).length;
        var fits = (lw + 0.5 * fs) / Math.max(Math.tan(theta / 2), 0.2);
        var reach = 0.6 * Math.min(dist(a.vx, a.vy, a.ax, a.ay), dist(a.vx, a.vy, a.bx, a.by));
        var away = Math.max(2.3 * fs, Math.min(fits, reach));
        if (a.right) away = Math.max(away, 3.0 * fs);   // clear the square mark, which reaches ~1.6 fs along the diagonal
        addText(a.label, a.vx + rr.bis[0] * away, a.vy + rr.bis[1] * away, 'middle', 'angle');
      }
    });
    texts.forEach(function (t) { grow(t.l, t.bt); grow(t.r, t.t); });
    atoms.forEach(function (a) { if (a.a === 'angleMark') { grow(a.vx - 1.4 * fs, a.vy - 1.4 * fs); grow(a.vx + 1.4 * fs, a.vy + 1.4 * fs); } });

    var pad = 0.8 * fs;
    return { fs: fs, texts: texts, vx: b.x0 - pad, vy: -b.y1 - pad, vw: (b.x1 - b.x0) + 2 * pad, vh: (b.y1 - b.y0) + 2 * pad };
  }

  // Labels that land on top of one another. A stimulus the child cannot read is
  // as wrong as one that is drawn wrong, and nobody who cannot see the picture
  // would otherwise know — so this blocks. Boxes are shrunk a little, so labels
  // that merely sit close together are not flagged.
  function layoutProblems(cx) {
    var L = layout(cx), out = [];
    if (!L) return out;

    // Two pieces on top of each other, or touching, with no labels to collide:
    // the text check below would pass them. Each piece's box is the shapes its
    // macro made (never its text), and they must clear each other by half a
    // font size.
    var boxes = (cx.pieces || []).map(function (pc) {
      var b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      var g = function (x, y) { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; };
      for (var i = pc.from; i < pc.to; i++) {
        var a = cx.atoms[i];
        if (a.a === 'polygon') a.pts.forEach(function (p) { g(p.x, p.y); });
        else if (a.a === 'segment') { g(a.x1, a.y1); g(a.x2, a.y2); }
        else if (a.a === 'circle') { g(a.x - a.r, a.y - a.r); g(a.x + a.r, a.y + a.r); }
        else if (a.a === 'rect') { g(a.x, a.y); g(a.x + a.w, a.y + a.h); }
        else if (a.a === 'point') g(a.x, a.y);
      }
      return { id: pc.id, b: b };
    }).filter(function (p) { return isFinite(p.b.x0); });
    var m = 0.5 * L.fs;
    for (var p1 = 0; p1 < boxes.length && out.length < 3; p1++) {
      for (var p2 = p1 + 1; p2 < boxes.length && out.length < 3; p2++) {
        var A = boxes[p1].b, B = boxes[p2].b;
        if (A.x0 - m < B.x1 && B.x0 - m < A.x1 && A.y0 - m < B.y1 && B.y0 - m < A.y1)
          out.push('The pieces "' + boxes[p1].id + '" and "' + boxes[p2].id + '" overlap or touch — move one further away with "at" (every piece is drawn around the origin until it is given a place).');
      }
    }

    var T = L.texts;
    for (var i = 0; i < T.length && out.length < 3; i++) {
      for (var j = i + 1; j < T.length && out.length < 3; j++) {
        var p = T[i], q = T[j];
        var sx = 0.1 * Math.min(p.r - p.l, q.r - q.l), sy = 0.15 * Math.min(p.t - p.bt, q.t - q.bt);
        if (Math.min(p.r, q.r) - Math.max(p.l, q.l) > sx && Math.min(p.t, q.t) - Math.max(p.bt, q.bt) > sy)
          out.push('The labels "' + p.text + '" and "' + q.text + '" would land on top of each other — drop labels (a triangle: show: { sides: false } and/or { vertices: false }; the tick marks still show which sides match), thin a number line (labelEvery), space the pieces further apart ("at"), or draw fewer in one picture.');
      }
    }
    return out;
  }

  function toSvg(cx, label) {
    var atoms = cx.atoms, Lt = layout(cx);
    if (!Lt) return '';
    var fs = Lt.fs, out = [];

    function X(x) { return r3(x); }
    function Y(y) { return r3(-y); }
    function line(cls, x1, y1, x2, y2) {
      out.push('<line class="' + cls + '" x1="' + X(x1) + '" y1="' + Y(y1) + '" x2="' + X(x2) + '" y2="' + Y(y2) + '"/>');
    }
    function head(x, y, dx, dy) {                 // arrowhead at (x,y) pointing along (dx,dy)
      var s = 0.8 * fs, px = -dy, py = dx;
      out.push('<polygon class="sc-head" points="' + X(x) + ',' + Y(y) + ' ' + X(x - dx * s + px * s * 0.38) + ',' + Y(y - dy * s + py * s * 0.38) +
        ' ' + X(x - dx * s - px * s * 0.38) + ',' + Y(y - dy * s - py * s * 0.38) + '"/>');
    }

    atoms.forEach(function (a) {                  // shapes first
      if (a.a === 'polygon')
        out.push('<polygon class="sc-poly' + (a.fill ? ' sc-poly--fill' : '') + '" points="' +
          a.pts.map(function (p) { return X(p.x) + ',' + Y(p.y); }).join(' ') + '"/>');
      else if (a.a === 'rect')
        out.push('<rect class="sc-rect' + (a.on ? ' sc-rect--on' : '') + '" x="' + X(a.x) + '" y="' + Y(a.y + a.h) + '" width="' + X(a.w) + '" height="' + X(a.h) + '"/>');
      else if (a.a === 'circle')
        out.push('<circle class="sc-dot' + (a.on ? ' sc-dot--on' : '') + '" cx="' + X(a.x) + '" cy="' + Y(a.y) + '" r="' + X(a.r) + '"/>');
    });
    atoms.forEach(function (a) {                  // then lines, ticks, marks
      if (a.a === 'segment') {
        var dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / len, uy = dy / len;
        if (!a.virtual) line(a.tick ? 'sc-tick' : 'sc-seg', a.x1, a.y1, a.x2, a.y2);
        if (a.arrow === 'both' || a.arrow === 'end' || a.arrow === true) head(a.x2, a.y2, ux, uy);
        if (a.arrow === 'both' || a.arrow === 'start') head(a.x1, a.y1, -ux, -uy);
        if (a.ticks) {                            // equal-length marks across the middle
          var mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2, nx = -uy, ny = ux, gap = 0.32 * fs;
          for (var t = 0; t < a.ticks; t++) {
            var off = (t - (a.ticks - 1) / 2) * gap;
            line('sc-eq', mx + ux * off - nx * 0.42 * fs, my + uy * off - ny * 0.42 * fs, mx + ux * off + nx * 0.42 * fs, my + uy * off + ny * 0.42 * fs);
          }
        }
      } else if (a.a === 'angleMark') {
        var rr = rays(a), r1 = 1.1 * fs, ua = rr.ua, ub = rr.ub;
        if (a.right) {
          var p1 = [a.vx + ua[0] * r1, a.vy + ua[1] * r1], p3 = [a.vx + ub[0] * r1, a.vy + ub[1] * r1], p2 = [p1[0] + ub[0] * r1, p1[1] + ub[1] * r1];
          out.push('<polyline class="sc-mark" points="' + [p1, p2, p3].map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' ') + '"/>');
        } else {
          var s1 = [a.vx + ua[0] * r1, a.vy + ua[1] * r1], s2 = [a.vx + ub[0] * r1, a.vy + ub[1] * r1];
          var ccw = (ua[0] * ub[1] - ua[1] * ub[0]) > 0;
          out.push('<path class="sc-mark" d="M' + X(s1[0]) + ' ' + Y(s1[1]) + ' A' + X(r1) + ' ' + X(r1) + ' 0 0 ' + (ccw ? 0 : 1) + ' ' + X(s2[0]) + ' ' + Y(s2[1]) + '"/>');
        }
      }
    });
    atoms.forEach(function (a) {                  // points on top of the lines
      if (a.a === 'point') out.push('<circle class="sc-pt" cx="' + X(a.x) + '" cy="' + Y(a.y) + '" r="' + r3(0.34 * fs) + '"/>');
    });
    Lt.texts.forEach(function (t) {               // text last, from the shared layout
      out.push('<text class="sc-text sc-text--' + t.cls + '" x="' + X(t.x) + '" y="' + Y(t.y) + '" font-size="' + r3(t.size) +
        '" text-anchor="' + t.anchor + '" dominant-baseline="central">' + esc(t.text) + '</text>');
    });

    return '<svg class="sc-svg" xmlns="http://www.w3.org/2000/svg" viewBox="' + [r3(Lt.vx), r3(Lt.vy), r3(Lt.vw), r3(Lt.vh)].join(' ') +
      '"' + (cx.pxCap ? ' style="max-width:' + Math.round(Lt.vw * cx.pxCap) + 'px"' : '') +
      ' role="img" aria-label="' + esc(label || 'Diagram') + '" preserveAspectRatio="xMidYMid meet">' + out.join('') + '</svg>';
  }

  // The page calls this. Anything wrong renders nothing rather than a broken
  // picture — a half-drawn diagram would teach the wrong thing.
  function html(v) {
    if (!v || v.type !== 'scene') return '';
    var cx = expand(v);
    if (cx.errors.length) return '';
    var svg = toSvg(cx, v.caption || 'Diagram');
    if (!svg) return '';
    return '<figure class="sc-figure">' + svg + (v.caption ? '<figcaption class="sc-caption">' + esc(v.caption) + '</figcaption>' : '') + '</figure>';
  }

  return {
    expand: expand, measure: measure, checkScene: checkScene, checkClaim: checkClaim, checkLeak: checkLeak,
    describe: describe, walkScenes: walkScenes, toSvg: toSvg, html: html, layoutProblems: layoutProblems, layout: layout,
    MACROS: Object.keys(MACROS), ATOMS: Object.keys(ATOMS), MEASURES: MEASURES
  };
});
