/* answer.js — the ONE definition of "is this answer right?".
 *
 * Loaded two ways, deliberately the same physical file:
 *   browser — <script src="/answer.js"></script>  → window.Answer
 *   node    — require('../public/answer.js')      → module.exports
 *
 * Why it exists: a 10-year-old typed "iscoseles" for "isosceles", was marked
 * wrong three times, and abandoned the session three questions in. He knew the
 * answer. The maths was never the problem — he got "scalene" right, first try,
 * two questions later.
 *
 * So a word answer is marked on the maths, not the spelling. Three rules stop
 * that from marking genuinely wrong answers right:
 *
 *   1. Numbers are never "nearly right". 0.4 and 0.5 are one edit apart, and
 *      the whole point of a place-value question is which one you meant.
 *   2. Short words must be exact. On a four-letter word almost everything is
 *      within one edit of something else.
 *   3. A predicted wrong answer — a `slips` key — that is just as close wins.
 *      That is the mistake the author expected, not a typo for the answer.
 *
 * It lives here rather than in the page so it can be tested
 * (scripts/test-answer-matching.js); marking is not something to leave to a
 * function nothing can reach.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Answer = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Trim, lower-case, strip spaces and thousands commas, normalise the decimal
  // point, and drop the filler a child types around a word answer ("the tens
  // column" → "ten"). A number comes back as a canonical number string so
  // "0.40", ".4" and "0.4" are one answer.
  function normalise(s) {
    var v = String(s).trim().toLowerCase()
      .replace(/\s+/g, '').replace(/[·•]/g, '.').replace(/,/g, '').replace(/^\+/, '')
      .replace(/(?!^)-/g, '');
    if (v === '') return null;
    if (/^\.\d+$/.test(v)) v = '0' + v;
    if (!/^-?\d*\.?\d+$/.test(v)) return v.replace(/^the/, '').replace(/column$/, '').replace(/s$/, '');
    var n = parseFloat(v);
    if (isNaN(n)) return v;
    return String(parseFloat(n.toFixed(6)));
  }

  function isNumeric(v) { return /^-?\d*\.?\d+$/.test(v); }

  // Levenshtein, abandoned as soon as it cannot come in at or under `cap` — we
  // only ever ask "is it within 2?", never "how far is it?".
  function editDistance(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var best = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                          prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // How far off a spelling may be, by the length of the right answer.
  function spellingTolerance(word) {
    if (word.length <= 4) return 0;
    if (word.length <= 7) return 1;
    return 2;
  }

  // Right answer, wrong spelling? `slipKeys` are the author's predicted wrong
  // answers; pass them so a near-miss can never overrule one.
  function nearSpelling(given, expected, slipKeys) {
    var g = normalise(given), e = normalise(expected);
    if (g === null || e === null || g === e) return false;
    if (isNumeric(g) || isNumeric(e)) return false;
    var tol = spellingTolerance(e);
    if (tol === 0) return false;
    var d = editDistance(g, e, tol);
    if (d > tol) return false;
    for (var i = 0; i < (slipKeys || []).length; i++) {
      var k = normalise(slipKeys[i]);
      // A slip key should never be the right answer (verify-session.js blocks
      // that), but if one ever is, it is not evidence against itself.
      if (!k || k === e || isNumeric(k)) continue;
      if (editDistance(g, k, d) <= d) return false;
    }
    return true;
  }

  function correct(given, expected, slipKeys) {
    var g = normalise(given);
    if (g === null) return false;
    if (g === normalise(expected)) return true;
    return nearSpelling(given, expected, slipKeys);
  }

  return {
    normalise: normalise,
    correct: correct,
    nearSpelling: nearSpelling,
    editDistance: editDistance,
    spellingTolerance: spellingTolerance,
  };
});
