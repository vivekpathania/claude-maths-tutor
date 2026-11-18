// lines.js — every line of a session that Ollie can say aloud.
//
// This MIRRORS the page (public/index.html): it must list exactly the strings the
// page will later ask for a recording of, because the page finds a recording by the
// words it is about to show. A line missing here is a silent moment; a line listed
// here that the page never speaks is only wasted rendering. Both fail soft — but if
// you change what the page speaks, change this too. docs/voice.md.
//
// What is spoken, and where it appears on the page:
//   steps[].ollie                 Ollie narrating a teaching step
//   goldenRule.title / .body      the takeaway, said once after the last step's narration
//   q.ollie.fresh|wrong|right     a line the author wrote for one question
//   q.hints[]                     a clue, said by itself after a bank line ("Here's a clue.")
//   close.line / close.next       the end-of-session goodbye
//
// Not spoken: the question text, step headlines and notes, second-angle steps, the slip
// explanations (shown under the answer box, not said, so they cannot cut off Ollie's
// reaction to a wrong try), the revealed answer, feedback cards, and anything computed
// from the child's own answers. In a check (allowReveal false) there are no clues at all.

const SessionShape = require('../../public/session-shape.js');

function sessionLines(s) {
  const lines = [];
  const add = (text, where) => {
    const t = text == null ? '' : String(text).trim();
    if (t) lines.push({ text: t, where });
  };

  const teach = SessionShape.normalizeTeach(s);
  if (teach) {
    teach.cycles.forEach((c, ci) => {
      (c.steps || []).forEach((st, i) => add(st.ollie, `cycle ${ci + 1} step ${i + 1} narration`));
      if (c.goldenRule) {
        add(c.goldenRule.title, `cycle ${ci + 1} golden rule`);
        add(c.goldenRule.body, `cycle ${ci + 1} golden rule`);
      }
    });
  }

  const canHelp = !(s.uiMode && (s.uiMode.allowReveal === false || s.uiMode.retryPolicy === 'oneShot'));
  SessionShape.orderedQuestions(s).forEach((row) => {
    const q = row.q || {};
    if (q.ollie && typeof q.ollie === 'object') ['fresh', 'wrong', 'right'].forEach((k) => add(q.ollie[k], `${row.id} Ollie ${k}`));
    if (canHelp) (q.hints || []).forEach((h, i) => add(h, `${row.id} hint ${i + 1}`));
  });

  if (s.close) { add(s.close.line, 'close'); add(s.close.next, 'close'); }
  return lines;
}

module.exports = { sessionLines };
