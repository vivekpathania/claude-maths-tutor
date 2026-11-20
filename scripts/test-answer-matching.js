// test-answer-matching.js — marking is the one thing the child feels directly.
// Mark a right answer wrong and they stop; mark a wrong one right and the
// grader advances them on something they cannot do.
//
//   node scripts/test-answer-matching.js
//
// Plain node, no framework, no database. public/answer.js is the module the
// child's page uses, loaded here as-is.

const A = require('../public/answer.js');

let pass = 0, fails = 0;
const failed = [];
function t(name, fn) {
  try { fn(); pass++; console.log('ok    ' + name); }
  catch (e) { fails++; failed.push(name); console.log('FAIL  ' + name + '\n        ' + e.message); }
}
const yes = (given, expected, slips, why) => {
  if (!A.correct(given, expected, slips || [])) throw new Error(`"${given}" should be accepted for "${expected}"${why ? ' — ' + why : ''}`);
};
const no = (given, expected, slips, why) => {
  if (A.correct(given, expected, slips || [])) throw new Error(`"${given}" should be REFUSED for "${expected}"${why ? ' — ' + why : ''}`);
};

const TRI = ['isosceles', 'scalene', 'equilateral'];

/* ── the case this exists for ─────────────────────────────────────────────── */
t('the misspelling that ended a real session is accepted', () => {
  yes('iscoseles', 'isosceles', TRI);
});

t('ordinary near-misses on long words are accepted', () => {
  yes('isoceles', 'isosceles', TRI);
  yes('equilateal', 'equilateral', TRI);
  yes('scalane', 'scalene', TRI);
});

t('exact answers are still exact answers', () => {
  ['isosceles', 'scalene', 'equilateral', '90', '0.4', '26'].forEach((w) => yes(w, w));
});

/* ── and the ways it must not go wrong ────────────────────────────────────── */
// 0.4 and 0.5 are one edit apart, and which one you meant is the question.
t('numbers are never nearly right', () => {
  no('0.4', '0.5');
  no('26', '25');
  no('90', '80');
  no('100', '180', [], 'a whole turn is not a straight line');
  no('7', '1');
});

t('short words must be exact, because almost anything is one edit from them', () => {
  no('cone', 'cube');
  no('tens', 'tenth');
  no('6', '5');
});

// The author predicted this wrong answer. A near-miss must never overrule it.
t('a predicted wrong answer is never rewritten into the right one', () => {
  no('scalene', 'isosceles', TRI, 'a different valid triangle name');
  no('equilateral', 'isosceles', TRI);
  no('hundredths', 'hundreds', ['hundredths'], 'the slip key itself');
});

t('a genuinely wrong word is still wrong', () => {
  no('asfsfsdf', 'equilateral', TRI, 'the keyboard mash from the real session');
  no('triangle', 'isosceles', TRI);
  no('', 'isosceles', TRI);
  no('   ', 'isosceles', TRI);
});

/* ── normalisation the page already relied on ─────────────────────────────── */
t('numbers normalise the way they always did', () => {
  yes('.4', '0.4');
  yes('0.40', '0.4');
  yes('1,000', '1000');
  yes(' 26 ', '26');
});

t('an empty answer is never correct', () => {
  if (A.normalise('') !== null) throw new Error('empty should normalise to null');
  no('', '0');
});

/* ── the tolerance ladder itself ──────────────────────────────────────────── */
t('tolerance grows with length, and never applies below five letters', () => {
  const eq = (got, want, what) => { if (got !== want) throw new Error(`${what}: expected ${want}, got ${got}`); };
  eq(A.spellingTolerance('cube'), 0, '4 letters');
  eq(A.spellingTolerance('scalene'), 1, '7 letters');
  eq(A.spellingTolerance('isosceles'), 2, '9 letters');
});

t('the distance cap gives up rather than counting past it', () => {
  const eq = (got, want, what) => { if (got !== want) throw new Error(`${what}: expected ${want}, got ${got}`); };
  eq(A.editDistance('abc', 'abc', 2), 0, 'identical');
  eq(A.editDistance('abc', 'abd', 2), 1, 'one substitution');
  if (A.editDistance('abc', 'xyz', 2) <= 2) throw new Error('three edits should exceed a cap of 2');
});

console.log(fails ? `\n${fails} FAILED: ${failed.join(', ')}` : `\n${pass} passed`);
process.exitCode = fails ? 1 : 0;
