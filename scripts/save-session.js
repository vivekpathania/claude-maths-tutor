#!/usr/bin/env node
// save-session.js — queue a standalone session as "pending".
//
// Used when there is nothing to grade first: the very first session after
// /setup-child, or a re-run after a gap. For the normal daily loop the next
// session is queued by save-grading.js instead (the `next` block).
//
//   node scripts/save-session.js <session.json> [--dry] [--force] [--no-voice]
//
// Refuses to queue a second pending session for the same child — only one
// session may be pending at a time (CLAUDE.md guardrail).

'use strict';

const fs = require('fs');
const path = require('path');
const { getDoc, setDoc, listSessions, assertReachable, close } = require('./db');

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function isStaged(s) {
  return !!(s && (s.warmup || s.practice || s.teach));
}

const { countQuestions, countBudgetedQuestions, orderedQuestions,
        normalizeTeach } = require('../public/session-shape.js');
const { spawnSync } = require('child_process');

// How the session's questions break down, for the messages below.
function breakdown(s) {
  const rows = orderedQuestions(s);
  const n = (sec) => rows.filter((r) => r.section === sec).length;
  const parts = [];
  if (n('warmup')) parts.push(`${n('warmup')} warm-up`);
  if (n('guided')) parts.push(`${n('guided')} guided`);
  parts.push(`${n('practice')} practice`);
  return parts.join(' + ');
}

async function main() {
  const args  = process.argv.slice(2);
  const dry   = args.includes('--dry');
  const force = args.includes('--force');
  const file  = args.find((a) => !a.startsWith('--'));

  if (!file) fail('Usage: node scripts/save-session.js <session.json> [--dry] [--force] [--no-voice]');
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail(`File not found: ${full}`);

  let s;
  try { s = JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (e) { fail(`Could not parse JSON: ${e.message}`); }

  if (!s.id)      fail('session.id is required (e.g. day1-2026-10-16).');
  if (!s.childId) fail('session.childId is required.');

  const staged = isStaged(s);
  const nq = countQuestions(s);
  if (!nq) fail('Session has no questions.');

  // "Never save a session that fails verify-session.js" used to live only in
  // CLAUDE.md — in whoever happened to remember it. A slip equal to the correct
  // answer (which marks a RIGHT answer wrong), or a picture that contradicts its
  // own facts, saved with exit 0 if that step was skipped. So the save runs the
  // real checker itself, before touching the database, and cannot skip it.
  // --force does not bypass this: it exists for queue conflicts, not wrong keys.
  const v = spawnSync(process.execPath, [path.join(__dirname, 'verify-session.js'), full], { encoding: 'utf8' });
  if (v.status !== 0) {
    process.stdout.write(v.stdout || '');
    process.stderr.write(v.stderr || '');
    fail('verify-session.js blocked this session — fix the errors above, then save again.');
  }
  console.log('✓ verify-session: no blocking errors');

  if (!staged) {
    if (s.tips && s.tips.length !== nq) fail(`tips length (${s.tips.length}) != questions (${nq}).`);
    if (s.tags && s.tags.length !== nq) fail(`tags length (${s.tags.length}) != questions (${nq}).`);
  }

  await assertReachable();

  const child = await getDoc(`children/${s.childId}`);
  if (!child) fail(`children/${s.childId} does not exist. Run /setup-child first.`);

  // Guardrail: never leave two sessions pending for one child.
  const all = await listSessions();
  const pending = all.filter((x) => x.childId === s.childId && x.status === 'pending' && x.id !== s.id);
  if (pending.length && !force)
    fail(`${s.childId} already has a pending session: ${pending.map((p) => p.id).join(', ')}.\n` +
         '  The child would never see this one. Grade that session first, or pass --force to replace it.');

  const existing = await getDoc(`sessions/${s.id}`);
  if (existing && existing.status === 'graded' && !force)
    fail(`sessions/${s.id} is already graded. Use a new id, or pass --force.`);

  // Mechanical check on the grader's own session-size decision (see
  // grader.md "Session size") — an agent that writes a different count than
  // the brief asked for should be caught here, not trusted. Only enforced
  // when there is an actual brief to check against, for this topic, with a
  // count set — a hand-built or legacy session with no brief is not blocked.
  if (s.topicId) {
    const brief = await getDoc(`brief/${s.childId}`);
    if (brief && brief.topicId === s.topicId && Number.isInteger(brief.questionCount)) {
      const budgeted = countBudgetedQuestions(s);
      if (s.kind === 'lesson') {
        // A lesson's teaching cycles are the teacher agent's pedagogical
        // call, not something the grader's time budget caps — so the gate
        // measures the practice half only, and never blocks. It still
        // complains: dropping the check entirely is how a 40-question
        // practice half eventually ships with nothing saying a word.
        if (Math.abs(budgeted - brief.questionCount) > 2)
          console.warn(`⚠ Lesson has ${budgeted} budgeted questions (${breakdown(s)}), but the brief ` +
                       `asked for ${brief.questionCount}.\n` +
                       `  Guided cycle questions are unbudgeted, so only warm-up + practice count here.\n` +
                       `  Proceeding — but check this was deliberate.`);
      } else if (budgeted !== brief.questionCount && !force) {
        fail(`Session has ${budgeted} budgeted questions (${breakdown(s)}), but the brief ` +
             `asked for ${brief.questionCount} ` +
             `(grader's session-size decision for "${brief.topicName || s.topicId}").\n` +
             '  questionCount budgets warm-up + practice. A lesson\'s guided cycle\n' +
             '  questions are exempt; this session is not a lesson.\n' +
             '  Fix the session, or pass --force if this is deliberate.');
      }
    }
  }

  const common = {
    childId:        s.childId,
    date:           s.date           || '',
    dayLabel:       s.dayLabel       || '',
    weekLabel:      s.weekLabel      || '',
    theme:          s.theme          || '',
    status:         'pending',
    createdAt:      new Date().toISOString(),
    showRecallFrom: typeof s.showRecallFrom === 'number' ? s.showRecallFrom : 999,
    recallText:     s.recallText     || '',
    ...(s.prevSessionId ? { prevSessionId: s.prevSessionId } : {}),
    ...(s.topicId       ? { topicId:       s.topicId       } : {}),
    ...(s.topicName     ? { topicName:     s.topicName     } : {}),
    ...(s.kind          ? { kind:          s.kind          } : {}),
    ...(s.sessionTopics ? { sessionTopics: s.sessionTopics } : {}),
    ...(s.lessonContent ? { lessonContent: s.lessonContent } : {}),
    ...(s.uiMode        ? { uiMode:        s.uiMode        } : {}),
    ...(s.stage         ? { stage:         s.stage         } : {}),
    // `goal` is the page footer's "Today's goal" line (CLAUDE.md "Session
    // shape"). It was missing from this list, so every goal the teacher and
    // author agents wrote was silently dropped here and the footer always
    // fell back to the topic description. This list is an allowlist: a new
    // documented field has to be added here or it never reaches the child.
    ...(s.goal          ? { goal:          s.goal          } : {}),
  };

  const doc = staged
    ? { ...common,
        greeting: s.greeting || 'Ready for today?',
        blurb:    s.blurb    || '',
        ...(s.warmup   ? { warmup:   s.warmup   } : {}),
        ...(s.teach    ? { teach:    s.teach    } : {}),
        ...(s.practice ? { practice: s.practice } : {}),
        ...(s.close    ? { close:    s.close    } : {}),
        attempts: [] }
    : { ...common,
        questions: s.questions,
        tips:      s.tips || [],
        tags:      s.tags || [] };

  const kindLabel = s.kind ? ` [${s.kind}]` : '';
  if (dry) {
    console.log(`\n[dry run] would write sessions/${s.id}`);
    console.log(`  child:     ${s.childId}`);
    console.log(`  topic:     ${s.topicName || s.topicId || '(none)'}`);
    console.log(`  kind:      ${s.kind || '(free-form)'}`);
    console.log(`  shape:     ${staged ? 'staged' : 'legacy'}`);
    const teach = normalizeTeach(s);
    console.log(`  questions: ${nq}${staged ? ` (${breakdown(s)})` : ''}`);
    console.log(`  budgeted:  ${countBudgetedQuestions(s)} (warm-up + practice)`);
    console.log(`  teach:     ${teach
      ? `${teach.cycles.length} cycle(s), ${teach.cycles.reduce((a, c) => a + (c.steps || []).length, 0)} steps, ` +
        `${teach.cycles.filter((c) => c.secondAngle).length} second angle(s)`
      : s.lessonContent ? 'legacy lessonContent' : 'none'}`);
    if (pending.length) console.log(`  NOTE: would replace pending ${pending.map((p) => p.id).join(', ')}`);
    console.log('\nNothing written. Re-run without --dry to save.\n');
    return;
  }

  await setDoc(`sessions/${s.id}`, doc);
  console.log(`✓ sessions/${s.id} queued as pending${kindLabel} (${nq} questions, ${staged ? 'staged' : 'legacy'} shape)`);

  // Record Ollie's voice for this session's own lines (tools/voice, docs/voice.md): the
  // narration, hints and slip explanations only exist in this session, so they cannot be
  // recorded ahead of time like the bank. It never blocks the save — a lesson works
  // without audio, and a failed render must not lose a queued session. Skip it with
  // --no-voice. The first run of a session takes a couple of minutes.
  if (!args.includes('--no-voice')) {
    const voiceDir = path.join(__dirname, '..', 'tools', 'voice');
    if (!fs.existsSync(path.join(voiceDir, 'node_modules'))) {
      console.log('\n• Voice: tools/voice is not installed, so this session will be text-only.  (cd tools/voice && npm install)');
    } else {
      console.log('\nRecording Ollie\'s lines for this session…');
      const r = spawnSync(process.execPath, [path.join(voiceDir, 'render.js'), 'session', full], { stdio: 'inherit' });
      if (r.status !== 0)
        console.warn(`\n⚠ The voice step failed. The session IS saved and works — Ollie just will not speak its own lines.\n  Try again: node tools/voice/render.js session ${file}`);
    }
  }
  console.log(`\nDone. ${child.name || s.childId} will see this next time they open their page.`);
}

main()
  .catch((e) => { console.error('✗ save-session failed:', e.message); process.exitCode = 1; })
  .finally(() => close());
