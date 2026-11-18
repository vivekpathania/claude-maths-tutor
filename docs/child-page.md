# The child's page — mechanics

Implementation detail of `public/index.html`. The parts a grading or authoring
agent actually needs (the help ladder, `revealed`/`exhausted`, the placement
exception) stay in CLAUDE.md; this is the rest.

## How the page runs a session

1. Fetches `/api/sessions/next`. If a session is pending, it also gets the
   previous session's `feedback.items`.
2. **Feedback cards come first.** Every card needs a "Got it!" tap before Start
   unlocks. This is the only teaching they get outside a lesson, so it is not
   skippable.
3. For a lesson session: warm-up (if any) → then, for **each cycle**, that
   cycle's teach steps followed by its one guided question → then `practice`.
   A wrong guided answer reveals that cycle's `secondAngle` inline, once, and
   every later attempt on it posts `secondAngleShown: true`. For everything
   else: warm-up → `practice` → close. A legacy lesson (`teach.steps` +
   `teach.tryIt`) normalises to one cycle and renders as it always did.
4. **Each answer POSTs immediately** to `/api/sessions/:id/attempts`:
   `{ questionId, given, correct, tries, hintsUsed, slipCode, msTaken }`, plus
   `usedHelp`, `cluesUsed`, `showedMe` (the grader's and the next look-back's view of
   how much help a question took; extra fields are stored as sent).
   One row per *try*, so `attempts[]` is the full record — not a final
   snapshot. This is what you grade from.
5. Finishing POSTs `/finish` → `status: "submitted"`.

**A reload resumes, it does not restart.** On boot the page reads `SESSION.attempts[]`
and resumes at the first question with no resolving attempt — never from question
1. For a one-shot session (placement) any attempt resolves a question, right or
wrong; for a retryable one, only `correct`/`revealed`/`exhausted` resolves it.
Without this, a reload would re-ask every question from the start, which for a
one-shot placement means free unlimited retries — it would quietly defeat the
whole point of measuring unaided first contact. Never remove this without
replacing it with something equivalent.

At a teach block the page decides "was this walkthrough seen?" by asking
whether the question **immediately after it** has an attempt. With cycles
that runs per cycle, and it is correct only because "every teach block is
followed by its own guided question with a distinct id" is a schema
invariant `verify-session.js` enforces — `buildSteps()` re-checks it and
logs loudly if a hand-edited session breaks it.

**Known gap:** the page reads `uiMode.allowReveal` and
`uiMode.retryPolicy`, but **not `uiMode.hintsMax`** — the hint ladder is
bounded by however many hints the question actually carries. `hintsMax` is
an authoring contract enforced upstream, not a page behaviour.

## Empty states

**No child profile?** The server serves a hardcoded demo session flagged
`demo: true`, never persisted, with a visible banner. It disappears once
`/setup-child` has run.

**Nothing queued?** The page says so honestly and offers to redo the last session.
It does not invent work.

## Where Ollie lives, and the clues

One layout at every width: a single centred column (`main.ollie-content`, at most 1000px)
and nothing fixed to the bottom except the Ollie **dock** (`public/ollie-kit`, mounted once
in `mountOllie()`; wide screens leave a 340px rail for him, narrower ones a strip along
the bottom). Today's goal sits at the top of the content, not in a footer. Toasts, if any
are added, go top-centre. `#stage-action` is always nested under `#stage-head`, so the
question card holds the title, the answer box and the clues; `#stage-side` holds only
what is left (second angle, golden rule, today-so-far, week).

**Clues** are the kit's `OllieClues`, one track per question (`trackFor()`), kept across
redraws of the same question and destroyed on the next. They sit under the answer box:
locked until the first wrong try, then "Need a hand?" opens the next unseen clue (and a
further wrong try opens the next one itself); when none are left, "Show me how" — which
here shows the answer and ends the question, scored as a reveal exactly as before.
`hintsUsed` is read from the track at POST time. Limit: a question with no
`hints` skips the track and keeps a plain "Show me how" button from the third try.
A reload mid-question replays the recorded tries and clues into the new track silently. `hintVisuals[i]` is added under clue `i` by a small observer in `trackFor()`.
