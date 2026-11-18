#!/usr/bin/env node
// reset-child.js — wipe a child's sessions + progress, keep the topic list.
//
//   node scripts/reset-child.js <childId> [--force]
//
// Without --force this only PRINTS what it would do — nothing is written.
// Pass --force to actually run it.
//
// Deletes:
//   - every doc in `sessions` for this childId (all history, all feedback)
//   - `children/{childId}.topicStatus` → reset to { topics: {} }
//   - `children/{childId}.brief` → cleared to null
//
// Keeps untouched:
//   - `children/{childId}.curriculum` (topics[], topicQueue[], research, approvedOn)
//   - the child's profile fields (name, age, stage, board, settings)
//
// This is a dev/testing reset tool, not part of the daily pipeline — it
// directly contradicts CLAUDE.md's "never delete the first session"
// guardrail on purpose, so it only ever runs on an explicit --force.

'use strict';

const { getDoc, setDoc, assertReachable, connect, close } = require('./db');

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const childId = args.find((a) => !a.startsWith('--'));

  if (!childId) fail('Usage: node scripts/reset-child.js <childId> [--force]');

  await assertReachable();

  const child = await getDoc(`children/${childId}`);
  if (!child) fail(`children/${childId} does not exist — nothing to reset.`);

  const db = await connect();
  const sessionCount = await db.collection('sessions').countDocuments({ childId });
  const topicStatusCount = Object.keys(child.topicStatus?.topics || {}).length;
  const topicListCount = (child.curriculum?.topics || []).length;
  const hasBrief = !!child.brief;

  console.log(`${child.name || childId} (${childId})`);
  console.log(`  sessions to delete:        ${sessionCount}`);
  console.log(`  topicStatus entries reset: ${topicStatusCount} → 0`);
  console.log(`  brief cleared:             ${hasBrief ? 'yes' : 'already empty'}`);
  console.log(`  curriculum kept untouched: ${topicListCount} topics, topicQueue unchanged`);

  if (!force) {
    console.log('\n• dry run: nothing written. Re-run with --force to actually wipe.');
    return;
  }

  const { deletedCount } = await db.collection('sessions').deleteMany({ childId });
  await setDoc(`topicStatus/${childId}`, { topics: {} });
  await setDoc(`brief/${childId}`, null);

  console.log(`\n✓ deleted ${deletedCount} session(s)`);
  console.log(`✓ topicStatus/${childId} reset to { topics: {} }`);
  console.log(`✓ brief/${childId} cleared`);
  console.log('\nDone. The curriculum/topic list was not touched — next /next-session starts fresh from the first topic in topicQueue.');
}

main()
  .catch((e) => { console.error('✗ reset-child failed:', e.message); process.exitCode = 1; })
  .finally(() => close());
