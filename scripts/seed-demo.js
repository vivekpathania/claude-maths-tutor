#!/usr/bin/env node
// seed-demo.js — a demo child with a few weeks of history, so a fresh fork can
// open the dashboard and the child's page and see them working before setting
// up a real child.
//
//   node scripts/seed-demo.js            # show what it would write, write nothing
//   node scripts/seed-demo.js --force    # write it
//   node scripts/seed-demo.js --remove   # delete it again
//
// This is demo data, not a template for real content. Sessions here were not
// written by the teacher/author agents and never went through verify-session.js
// — they exist to give the dashboard something to draw. A real child's first
// session comes from /setup-child then /next-session.
//
// The demo has no rendered audio, so Coach Ollie shows his speech bubble
// without sound. That is the same fallback a real session gets before
// `node tools/voice/render.js` has run (docs/voice.md).

'use strict';

require('dotenv').config();
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
    ['What is the value of the 7 in 472,310?', '70000'],
    ['Which is bigger, 48,210 or 48,120?', '48210'],
    ['Write 306,004 in digits after adding 10,000.', '316004'],
    ['How many thousands are in 52,800?', '52'],
    ['What is 1,000 more than 249,500?', '250500'],
    ['Round 638,200 to the nearest hundred thousand.', '600000'],
    ['What is the value of the 9 in 905,130?', '900000'],
    ['Which is smaller, 120,045 or 120,450?', '120045'],
  ],
  'decimal-place': [
    ['What is the value of the 4 in 3.47?', '0.4'],
    ['Write 6 tenths as a decimal.', '0.6'],
    ['Which is bigger, 0.7 or 0.65?', '0.7'],
    ['What is 0.3 + 0.4?', '0.7'],
    ['How many hundredths are in 0.25?', '25'],
    ['What is 2.5 + 0.1?', '2.6'],
    ['Write 0.08 as a fraction over 100.', '8'],
    ['Which is smaller, 1.09 or 1.9?', '1.09'],
  ],
  '2d-shapes-a': [
    ['A triangle has sides 5 cm, 5 cm and 5 cm. Is it equilateral, isosceles or scalene? Type the word.', 'equilateral'],
    ['How many sides does a hexagon have?', '6'],
    ['A triangle has sides 6 cm, 6 cm and 9 cm. Is it equilateral, isosceles or scalene? Type the word.', 'isosceles'],
    ['How many degrees is a right angle? Type just the number.', '90'],
    ['A triangle has sides 4 cm, 5 cm and 7 cm. Is it equilateral, isosceles or scalene? Type the word.', 'scalene'],
    ['How many sides does a quadrilateral have?', '4'],
    ['Two corners of a triangle are 60° and 70°. What is the third corner? Type just the number.', '50'],
    ['How many degrees do the corners of a triangle add up to? Type just the number.', '180'],
  ],
  '2d-shapes-b': [
    ['A triangle has sides 8 cm, 8 cm and 5 cm. Is it equilateral, isosceles or scalene? Type the word.', 'isosceles'],
    ['Two corners of a triangle are 90° and 35°. What is the third corner? Type just the number.', '55'],
    ['A triangle has sides 3 cm, 4 cm and 5 cm. Is it equilateral, isosceles or scalene? Type the word.', 'scalene'],
    ['Two corners of a triangle are 50° and 50°. What is the third corner? Type just the number.', '80'],
    ['How many lines of symmetry does an equilateral triangle have?', '3'],
    ['A triangle has sides 7 cm, 7 cm and 7 cm. Is it equilateral, isosceles or scalene? Type the word.', 'equilateral'],
    ['Two corners of a triangle are 65° and 48°. What is the third corner? Type just the number.', '67'],
    ['How many right angles can a triangle have? Type just the number.', '1'],
  ],
};

function question(pool, i, prefix) {
  const [ask, answer] = POOLS[pool][i];
  return {
    id: prefix + '_' + (i + 1), ask, answer,
    hints: ['Read it once more, slowly. What is the question actually asking for?',
            'Work out the one step you are sure of first, then look again.'],
    slips: {},
  };
}

/* ── sessions ───────────────────────────────────────────────────────────── */
// quality[] drives the dashboard's "right first time"; marks[] drives
// completion. Both are normally computed by save-grading.js from attempts[],
// so they are built from the same spec here rather than written by hand.
function buildSession(spec) {
  const { id, topicId, topicName, kind, pool, dayOffset, clean, shown, minutes, parentSummary, status } = spec;
  const total = 8;
  const when = daysAgo(dayOffset);

  const items = [];
  for (let i = 0; i < total; i++) items.push(question(pool, i, i < 3 ? 'w' : 'p'));

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
    blurb: 'A few warm-ups, then some practice.',
    goal: TOPICS.find((t) => t.id === topicId).description,
    warmup: { from: 'last time', items: items.slice(0, 3) },
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
  { id: 'demo-5', topicId: '2d-shapes', topicName: '2D shapes and triangles', kind: 'practice',
    pool: '2d-shapes-a', dayOffset: -1, clean: 8, shown: 0, minutes: 0, status: 'pending' },
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

/* ── write ──────────────────────────────────────────────────────────────── */
async function remove() {
  const db = await connect();
  const c = await db.collection('children').deleteOne({ _id: ID });
  const s = await db.collection('sessions').deleteMany({ childId: ID });
  console.log(`✓ removed ${c.deletedCount} child and ${s.deletedCount} session(s) for "${ID}".`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => !['--force', '--remove'].includes(a)))
    fail('Usage: node scripts/seed-demo.js [--force] [--remove]');

  await assertReachable();
  const db = await connect();

  if (args.includes('--remove')) return remove();

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

  console.log('\n✓ written. Start the server (npm start) and open:');
  console.log('    http://localhost:3000/dashboard.html   the parent dashboard');
  console.log('    http://localhost:3000/                 the child\'s page (the pending session)');
  console.log('\n  Remove it again with: node scripts/seed-demo.js --remove');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => close());
