#!/usr/bin/env node
// save-brief.js — commit a brief-only grader decision (no session to mark).
//
//   node save-brief.js <brief-decision.json>
//
// Used by /next-session: there is nothing submitted to grade, so the grader
// agent only decides what topic/phase comes next and writes { childId, brief }.
// The normal day-to-day path writes the brief as part of save-grading.js
// instead — this script exists only for the no-prior-session case.

'use strict';

const fs = require('fs');
const path = require('path');
const { getDoc, setDoc, assertReachable, close } = require('./db');
const { SESSION_MINUTES } = require('./session-minutes');

const PHASES = ['placement', 'lesson', 'practice', 'check', 'retest'];

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function validateBrief(b) {
  if (!b) return; // null is valid — every topic mastered
  if (!b.topicId || !b.topicName) fail('brief.topicId and brief.topicName are required.');
  if (!PHASES.includes(b.phase)) fail(`brief.phase must be one of: ${PHASES.join(', ')} (got "${b.phase}")`);
  const u = b.uiMode;
  if (!u) fail('brief.uiMode is required.');
  if (typeof u.hintsMax !== 'number' || u.hintsMax < 0) fail('brief.uiMode.hintsMax must be a number >= 0.');
  if (typeof u.allowReveal !== 'boolean') fail('brief.uiMode.allowReveal must be a boolean.');
  if (typeof u.showScore !== 'boolean') fail('brief.uiMode.showScore must be a boolean.');
  if (!['multi', 'oneShot'].includes(u.retryPolicy)) fail('brief.uiMode.retryPolicy must be "multi" or "oneShot".');
  if (!b.ageStageContext || typeof b.ageStageContext.age !== 'number')
    fail('brief.ageStageContext.age is required.');
  // The grader decides the session's size itself (see grader.md "Session
  // size") — a budget it spends, not a number it must hit. Missing either
  // field means that judgment call was skipped, not just left at a default.
  if (!Number.isInteger(b.questionCount) || b.questionCount <= 0)
    fail('brief.questionCount must be a positive whole number — the grader\'s session-size decision.');
  if (!SESSION_MINUTES.includes(b.sessionMinutes))
    fail(`brief.sessionMinutes must be one of ${SESSION_MINUTES.join(', ')} (got ${b.sessionMinutes}).`);
}

async function main() {
  const file = process.argv[2];
  if (!file) fail('Usage: node save-brief.js <brief-decision.json>');
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail(`File not found: ${full}`);

  let g;
  try { g = JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (e) { fail(`Could not parse JSON: ${e.message}`); }

  if (!g.childId) fail('childId is required.');
  validateBrief(g.brief);

  await assertReachable();

  const child = await getDoc(`children/${g.childId}`);
  if (!child) fail(`children/${g.childId} does not exist. Run /setup-child first.`);

  await setDoc(`brief/${g.childId}`, g.brief ? { ...g.brief, generatedAt: new Date().toISOString(), generatedBySession: null } : null);

  if (g.brief) console.log(`✓ brief/${g.childId} — ${g.brief.topicName} [${g.brief.phase}]`);
  else console.log(`• brief/${g.childId} cleared — every topic mastered.`);
}

main()
  .catch((e) => { console.error('✗ save-brief failed:', e.message); process.exitCode = 1; })
  .finally(() => close());
