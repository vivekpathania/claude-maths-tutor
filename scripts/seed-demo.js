#!/usr/bin/env node
// seed-demo.js — a demo child with a few weeks of history, so a fresh fork can
// open the dashboard and the child's page and see them working before setting
// up a real child.
//
//   node scripts/seed-demo.js              # show what it would write, write nothing
//   node scripts/seed-demo.js --force      # write it
//   node scripts/seed-demo.js --remove     # delete it again
//   node scripts/seed-demo.js --save-audio # re-record Ollie's lines (maintainers)
//
// This is demo data, not a template for real content. Sessions here were not
// written by the teacher/author agents and never went through verify-session.js
// — they exist to give the dashboard something to draw. A real child's first
// session comes from /setup-child then /next-session.
//
// Coach Ollie speaks her bank lines here with no extra setup, because
// public/audio/bank/ is committed. The pending session's own lines (her
// per-question asides and the clues) are recorded separately — see
// "demo audio" below.

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Binary } = require('mongodb');
const Speech = require('../public/speech.js');
const { sessionLines } = require('../tools/voice/lines.js');
const { getDoc, setDoc, connect, close, assertReachable } = require('./db');

const ID = 'demo-child';
const NAME = 'Sam';

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

/* ── dates ──────────────────────────────────────────────────────────────── */
// Relative to today, so the dashboard's "last 4 weeks" calendar always has
// something in it however long after seeding it is opened.
const DAY = 864e5;
function daysAgo(n) { return new Date(Date.now() - n * DAY); }
function dmy(d) {
  return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
}

/* ── curriculum ─────────────────────────────────────────────────────────── */
const GROUPS = [
  { id: 'place-value', name: 'Place value and rounding', strand: 'Number', order: 1 },
  { id: 'calculating', name: 'Calculating',              strand: 'Number', order: 2 },
  { id: 'shape',       name: 'Shape and angles',         strand: 'Geometry and measure', order: 3 },
];

const TOPICS = [
  { id: 'big-numbers',    name: 'Big numbers to a million', group: 'place-value', prereqs: [],
    description: 'Read, write and order whole numbers up to a million, knowing what each digit is worth.' },
  { id: 'decimal-place',  name: 'Decimal place value',      group: 'place-value', prereqs: ['big-numbers'],
    description: 'Understand tenths and hundredths, and what each digit after the point is worth.' },
  { id: 'rounding',       name: 'Rounding numbers',         group: 'place-value', prereqs: ['big-numbers'],
    description: 'Round whole numbers and decimals to a given place.' },
  { id: 'add-subtract',   name: 'Adding and subtracting',   group: 'calculating', prereqs: ['big-numbers'],
    description: 'Add and subtract whole numbers using a written method.' },
  { id: 'multiply-divide', name: 'Multiplying and dividing', group: 'calculating', prereqs: ['add-subtract'],
    description: 'Multiply and divide by one- and two-digit numbers.' },
  { id: 'remainders',     name: 'Division with remainders', group: 'calculating', prereqs: ['multiply-divide'],
    description: 'Divide with a remainder and say what the remainder means.' },
  { id: '2d-shapes',      name: '2D shapes and triangles',  group: 'shape',       prereqs: [],
    description: 'Name and sort 2D shapes, and sort triangles by their sides and angles.' },
  { id: 'angles',         name: 'Measuring angles',         group: 'shape',       prereqs: ['2d-shapes'],
    description: 'Measure and draw angles with a protractor.' },
  { id: 'symmetry',       name: 'Symmetry',                 group: 'shape',       prereqs: ['2d-shapes'],
    description: 'Find lines of symmetry and complete symmetrical patterns.' },
].map((t, i) => ({ ...t, strand: GROUPS.find((g) => g.id === t.group).strand, order: i + 1, sourceUrl: '', schoolCovered: false }));

/* ── question pools ─────────────────────────────────────────────────────── */
// Small and deliberately plain. Every answer here is correct if you read it —
// demo data that lies would be worse than no demo data.
const POOLS = {
  'big-numbers': [
    ['What is the value of the 7 in 472,310?', '70000',
     ['Find the 7, then name its column: ones, tens, hundreds, thousands...',
      'Multiply the digit by what its column is worth.'],
     { '7': { code: 'face_value', say: 'That is the digit itself. We want what it is worth in its column.' },
       '7000': { code: 'wrong_column', say: 'One column out. Count again from the right.' } }],
    ['Which is bigger, 48,210 or 48,120?', '48210',
     ['Both start with 48. Compare the next digit along.',
      'Work left to right and stop at the first column where they differ. That column decides it.'],
     { '48120': { code: 'wrong_column', say: 'Check the hundreds digit — 2 beats 1.' } }],
    ['Write 306,004 in digits after adding 10,000.', '316004',
     ['Only one column changes. Which one?',
      'Add one to the ten thousands digit and leave every other digit exactly as it was.'],
     { '406004': { code: 'wrong_column', say: 'That added a hundred thousand, not ten thousand.' } }],
    ['How many thousands are in 52,800?', '52',
     ['Cover the last three digits with your finger. What is left?',
      'The whole thousands are everything to the left of those last three digits.'],
     { '528': { code: 'wrong_column', say: 'Cover three digits, not two — thousands end after 800.' } }],
    ['What is 1,000 more than 249,500?', '250500',
     ['Add 1 to the thousands column, and watch for a carry.',
      'Add one to the thousands digit, carrying into the next column if it rolls past 9.'],
     { '249600': { code: 'wrong_column', say: 'That added a hundred, not a thousand.' } }],
    ['Round 638,200 to the nearest hundred thousand.', '600000',
     ['Which two hundred thousands is it between?',
      'Check whether the rest is past half way: if it is, round up, if not, round down.'],
     { '700000': { code: 'rounded_up', say: 'Not quite half way to 700,000 yet, so it rounds down.' },
       '640000': { code: 'wrong_column', say: 'That rounded to the nearest ten thousand.' } }],
    ['What is the value of the 9 in 905,130?', '900000',
     ['The 9 is the first digit. Name its column.',
      'Multiply the digit by what its column is worth.'],
     { '9': { code: 'face_value', say: 'That is the digit itself, not what it is worth.' } }],
    ['Which is smaller, 120,045 or 120,450?', '120045',
     ['They match for three digits. Keep going to the first that differs.',
      'Compare column by column from the left. The first difference decides which is smaller.'],
     { '120450': { code: 'wrong_column', say: 'Compare the hundreds — 0 is less than 4.' } }],
  ],
  'decimal-place': [
    ['What is the value of the 4 in 3.47?', '0.4',
     ['The first place after the point is tenths.',
      'Write zero for the whole ones, then put the digit in the tenths place.'],
     { '4': { code: 'face_value', say: 'That is the digit. We want what it is worth.' },
       '0.04': { code: 'wrong_column', say: 'That is hundredths. The 4 is only one place after the point.' } }],
    ['Write 6 tenths as a decimal.', '0.6',
     ['Tenths go in the first place after the point.',
      'Write a zero for the whole ones, then the digit straight after the point.'],
     { '6': { code: 'face_value', say: 'Six on its own is six whole ones, not six tenths.' },
       '0.06': { code: 'wrong_column', say: 'That is 6 hundredths. Tenths come first.' } }],
    ['Which is bigger, 0.7 or 0.65?', '0.7',
     ['Compare the tenths first, not how many digits there are.',
      'Compare the tenths digit of each. What comes after it does not change which is bigger.'],
     { '0.65': { code: 'longer_is_bigger', say: 'A longer decimal is not automatically bigger. Compare tenths first.' } }],
    ['What is 0.3 + 0.4?', '0.7',
     ['Add the tenths: 3 and 4.',
      'Add the tenths digits as if they were whole numbers, then write the total back in the tenths place.'],
     { '0.07': { code: 'wrong_column', say: 'Those are tenths, so the answer is in tenths too.' } }],
    ['How many hundredths are in 0.25?', '25',
     ['0.25 is 2 tenths and 5 hundredths. Count them all as hundredths.',
      'Turn the tenths into hundredths by multiplying by ten, then add on the hundredths already there.'],
     { '5': { code: 'stopped-early', say: 'That is only the hundredths digit. The tenths count too.' } }],
    ['What is 2.5 + 0.1?', '2.6',
     ['Only the tenths change here.',
      '0.1 is one tenth, so add one to the tenths digit and leave the whole number alone.'],
     { '3.5': { code: 'wrong_column', say: '0.1 is one tenth, not one whole.' },
       '2.51': { code: 'wrong_column', say: '0.1 is one tenth, not one hundredth.' } }],
    ['Write 0.08 as a fraction over 100.', '8',
     ['How many hundredths is 0.08?',
      'Read the digits after the point as a count of hundredths. That count goes on top of the 100.'],
     { '80': { code: 'wrong_column', say: 'That would be 0.80. Count the hundredths in 0.08.' } }],
    ['Which is smaller, 1.09 or 1.9?', '1.09',
     ['Line up the tenths: 0 against 9.',
      'Compare the tenths digit first. Fewer tenths means the smaller number.'],
     { '1.9': { code: 'longer_is_bigger', say: 'More digits does not mean bigger. 1.09 has 0 tenths.' } }],
  ],
  '2d-shapes-a': [
    ['A triangle has sides 5 cm, 5 cm and 5 cm. Is it equilateral, isosceles or scalene? Type the word.', 'equilateral',
     ['Count how many of the three sides match.',
      'All three sides the same is one name, exactly two the same is another, and none matching is the third. Match your count to the name.'],
     { 'isosceles': { code: 'two_vs_three', say: 'Isosceles is exactly two matching. Here all three match.' },
       'scalene': { code: 'no_match', say: 'Scalene means no two match, but these are all the same.' } }],
    ['How many sides does a hexagon have?', '6',
     ['The start of the word is a number word.',
      'Hex is the Greek number word. It tells you the side count directly.'],
     { '5': { code: 'calc-slip', say: 'Five sides is a pentagon.' } }],
    ['A triangle has sides 6 cm, 6 cm and 9 cm. Is it equilateral, isosceles or scalene? Type the word.', 'isosceles',
     ['How many of the three sides match?',
      'All three sides the same is one name, exactly two the same is another, and none matching is the third. Match your count to the name.'],
     { 'scalene': { code: 'no_match', say: 'Scalene means no two sides match, but two of these do.' },
       'equilateral': { code: 'two_vs_three', say: 'Equilateral needs all three the same. The 9 is the odd one.' } }],
    ['How many degrees is a right angle? Type just the number.', '90',
     ['It is the square corner — a quarter of a full turn.',
      'A full turn is 360 degrees. Divide it by four.'],
     { '180': { code: 'wrong_angle', say: '180 is a straight line, not a corner.' },
       '360': { code: 'wrong_angle', say: '360 is a whole turn. A right angle is a quarter of it.' } }],
    ['A triangle has sides 4 cm, 5 cm and 7 cm. Is it equilateral, isosceles or scalene? Type the word.', 'scalene',
     ['Do any two of the sides match?',
      'All three sides the same is one name, exactly two the same is another, and none matching is the third. Match your count to the name.'],
     { 'isosceles': { code: 'two_vs_three', say: 'Isosceles needs two matching sides. These are all different.' } }],
    ['How many sides does a quadrilateral have?', '4',
     ['The start of the word is a number word.',
      'Quad is the Latin number word. It tells you the side count directly.'],
     { '3': { code: 'calc-slip', say: 'Three sides is a triangle.' } }],
    ['Two corners of a triangle are 60° and 70°. What is the third corner? Type just the number.', '50',
     ['The three corners always add up to 180.',
      'Add the two corners you were given, then take that total away from 180.'],
     { '130': { code: 'stopped-early', say: 'That is the two you were given added up. Take it away from 180.' } }],
    ['How many degrees do the corners of a triangle add up to? Type just the number.', '180',
     ['Imagine tearing the three corners off and putting them side by side.',
      'They line up into a straight line, so use the number of degrees in a straight line.'],
     { '360': { code: 'wrong_angle', say: '360 is a full turn, and the total for a quadrilateral.' },
       '90': { code: 'wrong_angle', say: '90 is one right angle, not the whole triangle.' } }],
  ],
  '2d-shapes-b': [
    ['A triangle has sides 8 cm, 8 cm and 5 cm. Is it equilateral, isosceles or scalene? Type the word.', 'isosceles',
     ['Count how many of the three sides match.',
      'All three sides the same is one name, exactly two the same is another, and none matching is the third. Match your count to the name.'],
     { 'scalene': { code: 'no_match', say: 'Scalene means no two match, but the two 8s do.' },
       'equilateral': { code: 'two_vs_three', say: 'Equilateral needs all three the same. The 5 is different.' } }],
    ['Two corners of a triangle are 90° and 35°. What is the third corner? Type just the number.', '55',
     ['Start from 180, the total for every triangle.',
      'Add the two corners you were given, then take that total away from 180.'],
     { '125': { code: 'stopped-early', say: 'That is the two corners added. Take it away from 180.' } }],
    ['A triangle has sides 3 cm, 4 cm and 5 cm. Is it equilateral, isosceles or scalene? Type the word.', 'scalene',
     ['Do any two sides match?',
      'All three sides the same is one name, exactly two the same is another, and none matching is the third. Match your count to the name.'],
     { 'isosceles': { code: 'two_vs_three', say: 'Isosceles needs two the same. These are all different.' } }],
    ['Two corners of a triangle are 50° and 50°. What is the third corner? Type just the number.', '80',
     ['The three corners add up to 180.',
      'Add the two corners you were given, then take that total away from 180.'],
     { '100': { code: 'stopped-early', say: 'That is the two corners added. Take it away from 180.' } }],
    ['How many lines of symmetry does an equilateral triangle have?', '3',
     ['Imagine folding it so the two halves land exactly on each other.',
      'Each fold runs from a corner to the middle of the opposite side. Count the corners.'],
     { '1': { code: 'stopped-early', say: 'There is a fold through every corner, not just one.' } }],
    ['A triangle has sides 7 cm, 7 cm and 7 cm. Is it equilateral, isosceles or scalene? Type the word.', 'equilateral',
     ['How many of the sides match?',
      'All three sides the same is one name, exactly two the same is another, and none matching is the third. Match your count to the name.'],
     { 'isosceles': { code: 'two_vs_three', say: 'Isosceles is exactly two matching. Here all three do.' } }],
    ['Two corners of a triangle are 65° and 48°. What is the third corner? Type just the number.', '67',
     ['Add the two you know, then take that from 180.',
      'Do it in two steps: add the pair first, then subtract that total from 180.'],
     { '113': { code: 'stopped-early', say: 'That is the two corners added. One step still to go.' } }],
    ['How many right angles can a triangle have? Type just the number.', '1',
     ['Two right angles would already use up 180. What is left for the third corner?',
      'Two of them use the whole 180 on their own, leaving a third corner impossible. Count how many fit.'],
     { '2': { code: 'wrong_angle', say: 'Two right angles make 180 on their own, leaving nothing for the third corner.' },
       '3': { code: 'wrong_angle', say: 'That would be 270, far past a triangle total of 180.' } }],
  ],
};

/* ── diagrams ───────────────────────────────────────────────────────────── */
// Kept out of POOLS above so the question table stays readable. Keyed
// "pool:index". Everything here is optional enrichment the child's page already
// knows how to draw (docs/visuals.md) — nothing new was added to render it.
//
// Where each kind goes, and why:
//   visual         the stimulus, when the picture IS the question (a triangle to
//                  classify). Never on a question whose point is the word itself:
//                  drawing a hexagon turns "how many sides does a hexagon have?"
//                  from vocabulary into counting.
//   hintVisuals    a scaffold, shown only once the child asks for a clue. The
//                  EMPTY place-value columns, never the filled ones — a picture
//                  of the finished working on rung 1 is a giveaway (docs/hints.md).
//   correctVisual  the why, shown after a right answer: the digit lit up in the
//                  column that earned it.

const PV_WHOLE = ['ones', 'tens', 'hundreds', 'thousands', 'ten-thousands', 'hundred-thousands'];
const PV_DEC = ['tenths', 'hundredths', 'thousandths'];

// Place-value columns for a number written as digits ("472,310", "3.47"), in
// display order left to right.
function pvCols(numStr) {
  const [whole, dec] = String(numStr).replace(/,/g, '').split('.');
  const cols = [];
  for (let i = 0; i < whole.length; i++) cols.push([PV_WHOLE[whole.length - 1 - i], whole[i]]);
  for (let i = 0; i < (dec || '').length; i++) cols.push([PV_DEC[i], dec[i]]);
  return cols;
}
// The number as a place-value figure, lighting the named columns. With digits in
// it the page also offers "Show place value chart" under the question.
function pv(numStr, ...litLabels) {
  const cols = pvCols(numStr);
  return { type: 'placeValue', cols,
           lit: litLabels.map((l) => cols.findIndex((c) => c[0] === l)).filter((i) => i >= 0) };
}
// The same columns with no digits in them — the page draws just the column
// names, which is the blank grid a clue wants.
function pvBlank(numStr) {
  return { type: 'placeValue', cols: pvCols(numStr).map((c) => [c[0], '']), lit: [] };
}

// A triangle the child reads. The side lengths stay in the question text and
// `show.sides` is off on purpose: the macro works the matching tick marks out
// from the numbers, and three side labels plus vertex letters collide
// (docs/visuals.md). `mustNotShow` keeps the picture from printing the answer.
function triSides(sides, hide) {
  return { type: 'scene',
    request: 'A triangle the child can classify from its side lengths',
    facts: [{ measure: 'sides', of: 'T', equals: sides },
            { mustNotShow: hide || ['equilateral', 'isosceles', 'scalene'] }],
    items: [{ m: 'triangle', id: 'T', sides, show: { sides: false } }] };
}

const EXTRAS = {
  // ── place value ──
  'big-numbers:0': { visual: pv('472,310'),
                     hintVisuals: [pvBlank('472,310'), null],
                     correctVisual: pv('472,310', 'ten-thousands') },
  'big-numbers:2': { visual: pv('306,004'),
                     correctVisual: pv('316,004', 'ten-thousands') },
  'big-numbers:3': { visual: pv('52,800'),
                     correctVisual: pv('52,800', 'ten-thousands', 'thousands') },
  'big-numbers:4': { visual: pv('249,500'),
                     correctVisual: pv('250,500', 'thousands') },
  'big-numbers:5': { visual: pv('638,200'),
                     correctVisual: pv('600,000', 'hundred-thousands') },
  'big-numbers:6': { visual: pv('905,130'),
                     hintVisuals: [pvBlank('905,130'), null],
                     correctVisual: pv('905,130', 'hundred-thousands') },

  'decimal-place:0': { visual: pv('3.47'),
                       hintVisuals: [pvBlank('3.47'), null],
                       correctVisual: pv('3.47', 'tenths'),
    ollie: { fresh: 'The columns after the point have names too. Which one is the 4 sitting in?',
             wrong: 'Not that one. Count the places after the point — the first one along is tenths.',
             right: 'Four tenths. You named the column, and the column is what gives a digit its worth.' } },
  'decimal-place:1': { hintVisuals: [pvBlank('0.6'), null],
                       correctVisual: pv('0.6', 'tenths'),
    ollie: { fresh: 'Tenths have a place of their own. Where does it go?',
             wrong: 'Have another go. Tenths sit in the first place after the point.',
             right: '0.6. That zero in front is doing real work — it holds the ones place.' } },
  'decimal-place:3': { correctVisual: pv('0.7', 'tenths') },
  'decimal-place:4': { visual: pv('0.25'),
                       correctVisual: pv('0.25', 'tenths', 'hundredths') },
  'decimal-place:5': { visual: pv('2.5'),
                       correctVisual: pv('2.6', 'tenths') },
  'decimal-place:6': { visual: pv('0.08'),
                       correctVisual: pv('0.08', 'hundredths') },

  'decimal-place:2': {
    ollie: { fresh: 'Careful with this one. More digits does not mean more.',
             wrong: 'Look at the tenths first — 7 against 6. Whatever comes after that cannot change it.',
             right: '0.7. Seven tenths beats six tenths, however many digits follow.' } },

  // ── triangles ──
  // These four are the pending session, so they are what a stranger sees first.
  '2d-shapes-a:0': { visual: triSides([5, 5, 5]),
    ollie: { fresh: 'Have a proper look at those three side lengths before you pick a word.',
             wrong: 'Not that one. Count how many of the three sides are the same length — that count is what picks the name.',
             right: 'Yes. All three the same, so equilateral.' } },
  '2d-shapes-a:1': {
    ollie: { fresh: 'This one is about the word itself, not the picture.',
             wrong: 'Have another go. The start of the word is a number word in disguise.',
             right: 'Six it is. Hex was telling you all along.' } },
  '2d-shapes-a:2': { visual: triSides([6, 6, 9]),
    ollie: { fresh: 'Two of these match and one does not. See which.',
             wrong: 'Go back to the side lengths and count the matching pair, then pick the word that means exactly that many.',
             right: 'That is it. Exactly two matching sides.' } },
  '2d-shapes-a:3': { visual: { type: 'scene',
      request: 'A right-angled triangle, so the child sees the square corner the question names',
      facts: [{ measure: 'angle', of: 'T@A', equals: 90 }, { mustNotShow: ['90'] }],
      items: [{ m: 'triangle', id: 'T', angles: [90, 45, 45], show: { angles: false } }] },
    ollie: { fresh: 'That square corner in the picture is the one I am asking about.',
             wrong: 'Think about a whole turn all the way round, then take a quarter of it.',
             right: 'Ninety degrees. You will spot that corner everywhere now.' } },
  '2d-shapes-a:4': { visual: triSides([4, 5, 7]),
    ollie: { fresh: 'Check the sides against each other. Do any two match?',
             wrong: 'Back to the lengths. If no two of them match at all, there is a word for exactly that.',
             right: 'Right — nothing matches, so scalene.' } },
  '2d-shapes-a:5': {
    ollie: { fresh: 'Another word one. Listen to how it starts.',
             wrong: 'Try again. Quad is the number word hiding at the front.',
             right: 'Four. Quad always means four.' } },
  '2d-shapes-a:6': {
    ollie: { fresh: 'Two corners are given, and all three always add to the same total.',
             wrong: 'Adding the two is only half of it. Something still has to come off 180.',
             right: 'Fifty. Add the pair, take it off 180 — that is the whole method.' } },
  '2d-shapes-a:7': {
    ollie: { fresh: 'Picture tearing the three corners off and lining them up.',
             wrong: 'They line up into a straight line. How many degrees is a straight line?',
             right: '180, for every triangle there is.' } },

  '2d-shapes-b:0': { visual: triSides([8, 8, 5]) },
  '2d-shapes-b:2': { visual: triSides([3, 4, 5]) },
  '2d-shapes-b:4': { visual: { type: 'scene',
      request: 'An equilateral triangle for the child to count folding lines on',
      facts: [{ measure: 'sides', of: 'T', equals: [6, 6, 6] }, { mustNotShow: ['3'] }],
      items: [{ m: 'triangle', id: 'T', sides: [6, 6, 6], show: { sides: false } }] } },
  '2d-shapes-b:5': { visual: triSides([7, 7, 7]) },
};

function question(pool, i, prefix) {
  const [ask, answer, hints, slips] = POOLS[pool][i];
  return {
    id: prefix + '_' + (i + 1), ask, answer,
    // Each question carries its own ladder: the first hint points at the method,
    // the second works it through. The demo is the first thing a stranger sees,
    // so generic filler here would misrepresent what a real session looks like.
    hints: hints || ['Read it once more, slowly. What is the question actually asking for?',
                     'Work out the one step you are sure of first, then look again.'],
    slips: slips || {},
    ...(EXTRAS[pool + ':' + i] || {}),
  };
}

/* ── sessions ───────────────────────────────────────────────────────────── */
// quality[] drives the dashboard's "right first time"; marks[] drives
// completion. Both are normally computed by save-grading.js from attempts[],
// so they are built from the same spec here rather than written by hand.
function buildSession(spec) {
  const { id, topicId, topicName, kind, pool, warmupPool, warmupFrom, blurb, dayOffset, clean, shown, minutes, parentSummary, status } = spec;
  const total = 8;
  const when = daysAgo(dayOffset);

  // The first three are the warm-up. A session may warm up on the PREVIOUS
  // topic rather than its own (CLAUDE.md: warmup.from "previous topic"), which
  // is why the pool is separable — the ids stay unique either way, w_ vs p_.
  const items = [];
  for (let i = 0; i < 3; i++) items.push(question(warmupPool || pool, i, 'w'));
  for (let i = 3; i < total; i++) items.push(question(pool, i, 'p'));

  const quality = [], marks = [], attempts = [];
  for (let i = 0; i < total; i++) {
    const q = items[i];
    // First `clean` questions right first time; the last `shown` needed the answer
    // shown; anything between took a second try.
    const isClean = i < clean;
    const isShown = i >= total - shown;
    quality.push(isClean ? 'clean' : isShown ? 'wrong' : 'helped');
    marks.push(isShown ? 'wrong' : 'correct');
    const at = new Date(when.getTime() + i * 45000).toISOString();
    if (isClean) {
      attempts.push({ questionId: q.id, given: q.answer, correct: true, tries: 1, hintsUsed: 0, slipCode: null, msTaken: 24000, at });
    } else if (isShown) {
      attempts.push({ questionId: q.id, given: '', correct: false, tries: 1, hintsUsed: 0, slipCode: null, msTaken: 31000, at });
      attempts.push({ questionId: q.id, given: q.answer, correct: false, tries: 2, hintsUsed: 2, slipCode: 'needed-showing', revealed: true, usedHelp: true, msTaken: 12000, at });
    } else {
      attempts.push({ questionId: q.id, given: '', correct: false, tries: 1, hintsUsed: 0, slipCode: null, msTaken: 27000, at });
      attempts.push({ questionId: q.id, given: q.answer, correct: true, tries: 2, hintsUsed: 1, slipCode: null, usedHelp: true, msTaken: 19000, at });
    }
  }

  const base = {
    id, childId: ID, topicId, topicName, kind,
    stage: { phase: kind === 'check' ? 'check' : kind === 'lesson' ? 'lesson' : 'practice', practiceLevel: kind === 'practice' ? 2 : null },
    uiMode: kind === 'check'
      ? { hintsMax: 0, allowReveal: false, retryPolicy: 'multi', showScore: true }
      : { hintsMax: 2, allowReveal: true, retryPolicy: 'multi', showScore: true },
    status, date: dmy(when), createdAt: daysAgo(dayOffset + 1).toISOString(),
    greeting: `Ready when you are, ${NAME}.`,
    // The page does not badge warm-up questions, so when they come from another
    // topic the start screen is the only place that says so.
    blurb: blurb || 'A few warm-ups, then some practice.',
    goal: TOPICS.find((t) => t.id === topicId).description,
    warmup: { from: warmupFrom || 'last time', items: items.slice(0, 3) },
    practice: items.slice(3),
    close: { line: 'Good work today.', next: 'More on this next time.' },
    attempts: status === 'pending' ? [] : attempts,
  };
  if (status === 'pending') { base.attempts = []; return base; }
  return {
    ...base,
    finishedAt: when.toISOString(),
    marks, quality,
    questionIndex: items.map((q, i) => ({ id: q.id, section: i < 3 ? 'warmup' : 'practice', guided: false })),
    parentSummary,
    summary: { msTaken: minutes * 60000 },
    feedback: { items: [] },
  };
}

const SESSIONS = [
  { id: 'demo-1', topicId: 'big-numbers', topicName: 'Big numbers to a million', kind: 'check',
    pool: 'big-numbers', dayOffset: 18, clean: 7, shown: 0, minutes: 9, status: 'graded',
    parentSummary: 'He read and ordered six-digit numbers confidently, including the ones with a zero in the middle, which trip most children up. This was his check-up session and he passed it comfortably.' },
  { id: 'demo-2', topicId: 'decimal-place', topicName: 'Decimal place value', kind: 'lesson',
    pool: 'decimal-place', dayOffset: 11, clean: 3, shown: 2, minutes: 16, status: 'graded',
    parentSummary: 'The lesson did not land. He is reading the digits after the point as if they were whole numbers, so he thinks 0.65 is bigger than 0.7. Worth another lesson that shows tenths and hundredths side by side.' },
  { id: 'demo-3', topicId: '2d-shapes', topicName: '2D shapes and triangles', kind: 'lesson',
    pool: '2d-shapes-a', dayOffset: 5, clean: 4, shown: 1, minutes: 14, status: 'graded',
    parentSummary: 'He can name a triangle from its side lengths once he settles to it. The corner rule was new and he needed it shown once, which is normal on a first lesson.' },
  { id: 'demo-4', topicId: '2d-shapes', topicName: '2D shapes and triangles', kind: 'practice',
    pool: '2d-shapes-b', dayOffset: 2, clean: 7, shown: 0, minutes: 8, status: 'graded',
    parentSummary: 'A much better session. He used the 180 degree rule on his own three times and only slipped once, on the triangle where the right angle was not listed first.' },
  // The pending one — what the child's page opens on. It warms up on decimal
  // place value, the topic still marked weak, before its own practice.
  { id: 'demo-5', topicId: '2d-shapes', topicName: '2D shapes and triangles', kind: 'practice',
    pool: '2d-shapes-a', warmupPool: 'decimal-place', warmupFrom: 'Decimal place value',
    blurb: 'Three decimal warm-ups to keep them fresh, then back to triangles.',
    dayOffset: -1, clean: 8, shown: 0, minutes: 0, status: 'pending' },
];

/* ── topicStatus ────────────────────────────────────────────────────────── */
function historyEntry(s) {
  const total = 8, clean = s.clean, correct = total - s.shown;
  return {
    sessionId: s.id, date: dmy(daysAgo(s.dayOffset)), kind: s.kind,
    phase: s.kind === 'check' ? 'check' : s.kind === 'lesson' ? 'lesson' : 'practice',
    practiceLevel: s.kind === 'practice' ? 2 : null,
    score: correct, total, cleanScore: clean,
    dominantErrors: s.shown ? ['needed-showing'] : [],
    hintsUsedTotal: (total - clean - s.shown) + s.shown * 2,
    revealedCount: s.shown, exhaustedCount: 0,
    verdictAtTime: 'partial', minutesTaken: s.minutes, guided: null,
  };
}
const byTopic = (id) => SESSIONS.filter((s) => s.topicId === id && s.status === 'graded');

const TOPIC_STATUS = {
  'big-numbers': {
    verdict: 'mastered', stage: { phase: 'check', practiceLevel: null },
    checkScore: 8, checkTotal: 8, checkAttempts: 0, backtrackTo: null,
    confirmedOn: dmy(daysAgo(18)), lastDate: dmy(daysAgo(18)),
    sessionHistory: byTopic('big-numbers').map(historyEntry), teachingHistory: [], errorProfile: {},
    parentNote: 'He passed his check-up on this first time, with no help.',
    parentWatch: '',
  },
  'decimal-place': {
    verdict: 'weak', stage: { phase: 'lesson', practiceLevel: null },
    checkAttempts: 0, backtrackTo: null, lastDate: dmy(daysAgo(11)),
    sessionHistory: byTopic('decimal-place').map(historyEntry), teachingHistory: [],
    errorProfile: { 'needed-showing': { count: 2, lastSeen: dmy(daysAgo(11)), lastSessionId: 'demo-2' } },
    parentNote: 'He finished the lesson with 3 out of 8 and needed Ollie to show him 2 answers.',
    parentWatch: 'He reads the digits after the point as a whole number, so he thinks 0.65 is bigger than 0.7.',
  },
  '2d-shapes': {
    verdict: 'partial', stage: { phase: 'practice', practiceLevel: 2 },
    checkAttempts: 0, backtrackTo: null, lastDate: dmy(daysAgo(2)),
    sessionHistory: byTopic('2d-shapes').map(historyEntry), teachingHistory: [],
    errorProfile: { 'needed-showing': { count: 1, lastSeen: dmy(daysAgo(5)), lastSessionId: 'demo-3' } },
    parentNote: 'He found the first lesson hard, then got nearly every practice question right first time.',
    parentWatch: 'Checking sides and corners as two separate things on the same triangle.',
  },
};

/* ── demo audio ─────────────────────────────────────────────────────────── */
// Coach Ollie speaks her BANK lines (public/audio/bank/) with no setup at all,
// because those are committed static files. A session's OWN lines are
// different: the clues she reads aloud, her per-question asides and the
// goodbye are rendered per session into Mongo by tools/voice, which pulls in a
// ~500 MB text-to-speech toolchain. Nobody is going to install that to look
// around, and a demo where the coach goes quiet exactly when she starts
// teaching misrepresents the thing. So the pending session's clips are
// committed in public/demo-audio/ and loaded straight in.
//
// They sit under public/ so the hosted demo can serve them as ordinary static
// files off the CDN. Through /api/audio/:key they were one serverless function
// call each: 58 a visitor, which exhausts Netlify's free monthly quota in about
// 2,000 visits. They are the demo child's lines, so nothing personal is served
// openly - the same reasoning that already puts the bank in public/audio/.
//
// They are content-addressed on the words, so editing a hint or an Ollie line
// above orphans its clip and that line would go quiet. Seeding warns when that
// has happened; re-record with:
//
//     cd tools/voice && npm install        # once, ~400 MB, gitignored
//     node scripts/seed-demo.js --save-audio
//
// manifest.json next to the clips says what each one says, so 58 opaque audio
// files in a public repo can be read without playing them.
const AUDIO_DIR = path.join(__dirname, '..', 'public', 'demo-audio');
const AUDIO_MANIFEST = path.join(AUDIO_DIR, 'manifest.json');
const PENDING = 'demo-5';

// The bank's voice, so a session clip can never be rendered in a different one
// than the reactions it is chained with.
function bankVoice() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'audio', 'manifest.json'), 'utf8')).voice;
  } catch (e) { return 'af_heart'; }
}

// Load the committed clips into the `audio` collection and link them to the
// pending session — the same two writes tools/voice/render.js makes.
async function loadAudio(db, session) {
  let files = [];
  try { files = fs.readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.m4a')); } catch (e) { /* none committed */ }
  if (!files.length) {
    console.log('  no demo audio committed — Ollie speaks her bank lines only');
    return;
  }
  let said = {};
  try { said = JSON.parse(fs.readFileSync(AUDIO_MANIFEST, 'utf8')).clips || {}; } catch (e) { /* older checkout */ }

  const voice = bankVoice();
  const audio = db.collection('audio');
  // Only the pending session's clips are kept, exactly as render.js does it,
  // so seeding twice does not pile up storage.
  await audio.deleteMany({ sessionId: PENDING });
  const keys = files.map((f) => f.slice(0, -4)).sort();
  for (const f of files) {
    const key = f.slice(0, -4);
    await audio.replaceOne({ _id: key }, {
      _id: key, bytes: new Binary(fs.readFileSync(path.join(AUDIO_DIR, f))),
      text: said[key], voice, sessionId: PENDING, createdAt: new Date().toISOString(),
    }, { upsert: true });
  }
  // The page ignores the lot if `version` does not match its own speech.js, so
  // it is read from there rather than written down.
  await db.collection('sessions').updateOne({ _id: PENDING },
    { $set: { audio: { voice, version: Speech.VERSION, clips: keys } } });

  // A clip is named on its words, so an edited line above quietly loses its
  // recording and Ollie goes silent on it. Say so rather than ship it mute.
  const have = new Set(keys);
  const missing = sessionLines(session)
    .filter((l) => { const k = Speech.clipKey(l.text, voice); return k && !have.has(k); });
  console.log(`  ${keys.length} voice clip(s) loaded for ${PENDING}`);
  if (missing.length)
    console.log(`  ⚠ ${missing.length} line(s) have no recording (${missing[0].where}, ...) — ` +
                're-record with: node scripts/seed-demo.js --save-audio');
}

// Maintainers only: render the pending session's lines and write them back
// into public/demo-audio/ to be committed.
async function saveAudio(db) {
  const s = await db.collection('sessions').findOne({ _id: PENDING });
  if (!s) fail(`${PENDING} is not in database "${db.databaseName}" — run --force first.`);
  const renderer = path.join(__dirname, '..', 'tools', 'voice', 'render.js');
  if (!fs.existsSync(path.join(__dirname, '..', 'tools', 'voice', 'node_modules')))
    fail('tools/voice is not installed. Run: cd tools/voice && npm install');

  const tmp = path.join(require('os').tmpdir(), `${PENDING}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ ...s, id: PENDING }));
  try {
    execFileSync('node', [renderer, 'session', tmp], { stdio: 'inherit', cwd: path.dirname(renderer) });
  } finally { fs.unlinkSync(tmp); }

  const docs = await db.collection('audio').find({ sessionId: PENDING }).toArray();
  if (!docs.length) fail('the renderer stored no clips.');
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  for (const f of fs.readdirSync(AUDIO_DIR)) if (f.endsWith('.m4a')) fs.unlinkSync(path.join(AUDIO_DIR, f));
  let bytes = 0;
  const clips = {};
  for (const d of docs) {
    const buf = Buffer.from(d.bytes.buffer || d.bytes);
    bytes += buf.length;
    clips[d._id] = d.text;
    fs.writeFileSync(path.join(AUDIO_DIR, d._id + '.m4a'), buf);
  }
  fs.writeFileSync(AUDIO_MANIFEST,
    JSON.stringify({ voice: bankVoice(), version: Speech.VERSION, clips }, null, 1));
  console.log(`\n✓ ${docs.length} clip(s), ${(bytes / 1048576).toFixed(1)} MB, written to public/demo-audio/ — commit them.`);
}

/* ── write ──────────────────────────────────────────────────────────────── */
async function remove() {
  const db = await connect();
  const c = await db.collection('children').deleteOne({ _id: ID });
  const s = await db.collection('sessions').deleteMany({ childId: ID });
  console.log(`✓ removed ${c.deletedCount} child and ${s.deletedCount} session(s) for "${ID}".`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => !['--force', '--remove', '--save-audio'].includes(a)))
    fail('Usage: node scripts/seed-demo.js [--force] [--remove] [--save-audio]');

  await assertReachable();
  const db = await connect();

  if (args.includes('--remove')) return remove();
  if (args.includes('--save-audio')) return saveAudio(db);

  // The API resolves "me" with findOne({}), so a second child makes the
  // dashboard show an arbitrary one. Refuse rather than quietly break it.
  const others = await db.collection('children').find({ _id: { $ne: ID } }, { projection: { _id: 1 } }).toArray();
  if (others.length)
    fail(`this database already has a child (${others.map((o) => o._id).join(', ')}).\n` +
         '  The app assumes one child, so adding a demo one would make the dashboard pick\n' +
         '  between them at random. To preview the demo instead, point MONGODB_DB at a\n' +
         '  throwaway database:\n\n    MONGODB_DB=maths-tutor-demo node scripts/seed-demo.js --force\n');

  const exists = await getDoc(`children/${ID}`);
  if (exists && !args.includes('--force'))
    fail(`children/${ID} already exists. Re-run with --force to replace it, or --remove to delete it.`);

  console.log(`Demo child "${NAME}" (${ID}) in database "${process.env.MONGODB_DB || 'maths-tutor'}":`);
  console.log(`  ${TOPICS.length} topics in ${GROUPS.length} groups`);
  console.log(`  ${Object.keys(TOPIC_STATUS).length} topics with progress ` +
              `(${Object.entries(TOPIC_STATUS).map(([k, v]) => k + ':' + v.verdict).join(', ')})`);
  SESSIONS.forEach((s) => console.log(`  ${s.status.padEnd(7)} ${s.id}  ${s.kind.padEnd(8)} ${s.topicName}`));

  if (!args.includes('--force')) {
    console.log('\n• Nothing written. Re-run with --force to write it.');
    return;
  }

  await setDoc(`children/${ID}`, {
    id: ID, name: NAME, age: 10, stage: 'Stage 5', board: 'Example board',
    // Optional. Left off a profile, the dashboard says they/them, which is the
    // only safe default when nobody has said.
    pronouns: { subject: 'he', object: 'him', possessive: 'his', plural: false },
    settings: { sessionMinutes: 30, questionsPerSession: 8 },
    schoolFocus: '',
  });
  await setDoc(`curriculum/${ID}`, {
    childId: ID, status: 'approved',
    research: { status: 'demo', notes: 'Invented topics for the demo — not a real curriculum.' },
    groups: GROUPS, topics: TOPICS, topicQueue: TOPICS.map((t) => t.id),
    approvedOn: new Date().toLocaleDateString('en-CA'),
  });
  await setDoc(`topicStatus/${ID}`, { childId: ID, lastUpdated: new Date().toISOString(), topics: TOPIC_STATUS });
  for (const spec of SESSIONS) await setDoc(`sessions/${spec.id}`, buildSession(spec));
  await loadAudio(db, buildSession(SESSIONS.find((x) => x.id === PENDING)));

  console.log('\n✓ written. Start the server (npm start) and open:');
  console.log('    http://localhost:3000/dashboard.html   the parent dashboard');
  console.log('    http://localhost:3000/                 the child\'s page (the pending session)');
  console.log('\n  Remove it again with: node scripts/seed-demo.js --remove');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => close());
