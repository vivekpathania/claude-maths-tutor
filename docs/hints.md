# Hints — the thinking ladder

Read this when you are the `author` or `teacher` agent writing `hints[]` on any
question. It is the standard for every hint in the system, guided questions
included.

**A hint is a question the child answers, not an answer the child reads.** The
whole point of the help ladder is that the child arrives at it themselves one
notch later than they would have unaided. A hint that completes the thinking
has not helped them — it has finished the question for them and left the mark
looking like progress.

This matters mechanically, not just pedagogically. A hinted answer counts as
`helped`, never `clean` (CLAUDE.md, "Three numbers"), so a session full of
giveaway hints produces a high completion score and a low clean score, which
the grader correctly reads as a **hold**. Hints that hand it over make the
child's week longer, not shorter.

## The ladder has three rungs, and they are different in kind

The page surfaces hints automatically — first hint after the second wrong try,
next after the third — so the child meets them in order, already stuck, having
read the question at least twice. Write for that reader.

| Rung | What it does | Form |
|---|---|---|
| **1** | Points attention at the thing they skipped. Assumes they know the method and misread or rushed. | **A question.** Nearly always. |
| **2** | Names the method or rule — but not applied to these numbers. | A statement of the rule, then a question that applies it. |
| **3 (last)** | The method as a procedure to carry out, stopping before the result. | Imperative. "Write the columns out, move each digit one left, then read it off." |

Rung 1 being a question is the rule most often broken. "Which way do the digits
move?" makes the child decide. "The digits move left" does the deciding for
them, at the first sign of difficulty, which is the worst possible moment to
take over.

## The last hint is also the reveal's explanation

"Show me how" renders as `answer + the last hint`:

```js
var steer = (q.hints||[]).slice(-1)[0] || '';
// → "The answer is 26. <steer>"
```

So the last hint carries a double load: it is the final rung of the ladder
**and** the method a child reads once the answer is already on screen. That is
why the last hint must stand alone — and it is also why the old rule ("concrete
enough to stand alone as the explanation") kept producing giveaways. Both jobs
are satisfied by the same thing:

**State the method, never the result.** A hint that explains *how to get there*
works as a reveal explanation and still leaves the arithmetic to the child. A
hint that states an intermediate value from which the answer can only be read
off has given the answer away in two steps.

```jsonc
// 2.6 × 10, answer "26"

// WRONG — rung 1 states instead of asks; rung 2 leaves only reading-off
"hints": [
  "The digits move left.",
  "Left. The 2 becomes tens."
]

// RIGHT — decide, then rule, then procedure
"hints": [
  "Times 10 makes it bigger. So which way do the digits have to move?",
  "Left, one column each. The 2 is sitting in the ones — which column does it land in?",
  "Write out the columns: tens, ones, tenths. Shift the 2 and the 6 one column left each, then read the number off."
]
```

The third hint is a complete method. Nowhere does it say 26.

## Hard rules

- **Never state the answer**, and never state a value from which the answer is
  a single trivial read-off. `verify-session.js` cannot catch this — check it
  yourself by asking: *could a child who understood nothing copy the answer out
  of this hint?*
- **Never more than one new idea per hint.** A hint that names the rule and
  works an example is two hints.
- **Hints get shorter as they go, not longer.** By rung 3 the child has been
  stuck for a while; a paragraph is the last thing they will read.
- **A hint never scolds or references the wrong answer.** That is the `slips`
  map's job, and it has already fired by the time hint 1 appears — a hint that
  also says "you divided instead" says it twice.
- **At least `brief.uiMode.hintsMax` hints**, never fewer than 2 unless the
  brief explicitly sets `hintsMax` lower. `hints: []` on placement, check and
  retest — see the table in `author.md`.

## Pitch the rung to the age

The ladder shape is fixed; how much is left to the child is not. Read
`brief.ageStageContext.age` and see `docs/mascot.md` §6 for the full bands.

- **Younger (7-9)** — rung 1 can be a question with the choice named inside it
  ("left or right?"). A bare open question strands them.
- **Middle (10-11)** — the default the examples above are written at.
- **Older (12-14)** — rung 1 can be genuinely open ("What happens to each
  digit's column?"), and rung 2 can name the rule by its proper term and expect
  the child to apply it. Over-scaffolding reads as being talked down to, and
  they will stop reading hints at all.

## `hintVisuals` — a picture on a rung

A hint may carry a diagram, parallel-indexed to `hints[]` (`null` for a hint
with no picture). The same rule applies: a visual on rung 1 that shows the
completed working is a giveaway with extra steps. Show the empty columns, not
the filled ones.
