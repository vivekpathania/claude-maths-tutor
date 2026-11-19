#!/usr/bin/env node
// verify-ollie-lines.js — lint the line bank (public/ollie-lines.js). docs/mascot.md §8.
//
//   node scripts/verify-ollie-lines.js
//
// Cheap, and exactly the failures that would otherwise reach a child silently:
//   1. an assessment line with a {name} slot (a check never uses the name)
//   2. a line that says "Ollie" (she speaks in the first person, always)
//   3. a (register, moment) pair the page asks for that has no line
//   4. a line over 140 characters or with more than three sentences
//   5. the same line twice in one moment's list (a shuffle bag with duplicates repeats)
//   6. "the answer" outside the `revealed` bank (the bank says nothing about the maths)
// Authored session text (steps[].ollie, q.ollie) is linted by verify-session.js.

'use strict';

const { BANK } = require('../public/ollie-lines.js');

// Every moment the page asks for. Keep in step with index.html and the kit's README.
const FLOW = ['start', 'open', 'returning', 'feedback', 'feedback.item', 'feedback.done', 'warmup', 'transition',
  'fresh', 'hintNote', 'halfway', 'lastQuestion', 'celebrate', 'idle', 'break.start', 'break.resume',
  'wrong.first', 'wrong.again', 'wrong.stuck', 'right.first', 'right.recovered', 'comeback', 'streak',
  'clue.first', 'clue.last', 'showme.start', 'showme.yourTurn', 'nothingQueued', 'close'];
const TEACH = ['teach.step.first', 'teach.step.mid', 'teach.step.last', 'teach.tryIt'];
// No clues and no "show me" in an assessment: presence only (docs/mascot.md §3).
const ASSESSMENT = ['start', 'open', 'returning', 'feedback', 'warmup', 'transition', 'fresh', 'halfway', 'lastQuestion',
  'idle', 'break.start', 'break.resume', 'wrong.first', 'wrong.again', 'wrong.stuck', 'exhausted', 'moveon',
  'right.first', 'right.recovered', 'comeback', 'streak', 'nothingQueued', 'close'];
const REQUIRED = { practice: FLOW, teaching: FLOW.concat(TEACH), assessment: ASSESSMENT };

const MAX_CHARS = 140;
const MAX_SENTENCES = 3;   // was two; the bank's shortest openers ("Hello again! I saved your spot. Let's keep going.") are three
const SLOT = /\{[a-zA-Z]+\}/;

function lint(bank) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);

  Object.keys(REQUIRED).forEach((reg) => {
    REQUIRED[reg].forEach((moment) => {
      const own = bank[reg] && bank[reg][moment];
      // teaching falls back to practice for the flow moments it does not define
      const lines = own || (reg === 'teaching' && bank.practice && bank.practice[moment]);
      if (!lines || !lines.length) bad(`${reg}/${moment}`, 'no line (missing moment)');
    });
  });

  Object.keys(bank).forEach((reg) => {
    Object.keys(bank[reg]).forEach((moment) => {
      const where = `${reg}/${moment}`;
      const seen = new Set();
      bank[reg][moment].forEach((line) => {
        const text = String(line);
        if (reg === 'assessment' && SLOT.test(text)) bad(where, `assessment line has a slot: "${text}"`);
        if (/\bOllie\b/.test(text)) bad(where, `refers to Ollie in the third person: "${text}"`);
        if (text.length > MAX_CHARS) bad(where, `${text.length} chars, over ${MAX_CHARS}: "${text}"`);
        const sentences = text.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim()).length;
        if (sentences > MAX_SENTENCES) bad(where, `${sentences} sentences, max ${MAX_SENTENCES}: "${text}"`);
        if (seen.has(text)) bad(where, `duplicate line: "${text}"`);
        seen.add(text);
        if (moment !== 'revealed' && /answer is|the answer/i.test(text)) bad(where, `mentions the answer outside "revealed": "${text}"`);
      });
    });
  });
  return errors;
}

module.exports = { lint, REQUIRED };

if (require.main === module) {
  const errors = lint(BANK);
  if (errors.length) {
    errors.forEach((e) => console.error('✗ ' + e));
    console.error(`\n${errors.length} problem(s) in the line bank.`);
    process.exitCode = 1;
  } else {
    const n = Object.values(BANK).reduce((a, m) => a + Object.values(m).reduce((b, l) => b + l.length, 0), 0);
    console.log(`✓ line bank: ${n} lines, every moment present, no lint errors`);
  }
}
