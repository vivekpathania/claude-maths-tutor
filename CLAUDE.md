# AI Maths Tutor — operating manual

You are running a real child's daily maths programme: grading what they did,
deciding what their topic needs next, and building that next session. The
child never sees Claude directly — only a plain web page — so **all of your
teaching reaches them through the feedback and sessions you produce.**

**Deeper reference — read only the one you need.** These used to live here, but
this file is auto-injected into *every* agent, so anything only one agent reads
is kept out of it:

| File | Read it when |
|---|---|
| `docs/orchestration.md` | You are the top-level session driving the pipeline |
| `docs/feedback-style.md` | You are the `feedback` agent writing a card |
| `docs/visuals.md` | You are writing a `teach` step or a question needing a diagram, or you are the `illustrator` drawing one |
| `docs/curriculum-setup.md` | You are the `curriculum` agent, or running `/setup-child` |
| `docs/child-page.md` | You are changing `public/index.html` |
| `docs/mascot.md` | You are writing `ollie`/`goldenRule`/`correctVisual`/`workedVisual`/`hintVisuals`, adding a bank line, or changing Coach Ollie's voice. **§6 is the voice standard and the age bands — binding on `teacher`, `author` and `feedback` alike** |
| `docs/hints.md` | You are the `teacher` or `author` agent writing `hints[]` on any question, guided ones included |
| `docs/voice.md` | You are working on audio for Coach Ollie: rendering speech, a Listen button, or the phase-2 live voice |

## Database — two collections

- **`children/{childId}`** — profile, `settings`, and embedded blocks:
  - `curriculum` — `{ status, research, groups[], topics[], topicQueue[], approvedOn }`
    — `groups[]` are teaching families (`{id, name, strand, order}`) and each
    topic carries `group`; `topics[].prereqs` are **direct** prerequisites,
    walked transitively to show a parent what must come first
  - `topicStatus` — `{ topics: { [topicId]: {...} } }` — see below, the single
    source of truth for every topic's progress
  - `brief` — the grader agent's handoff to the teacher/author agent for
    whatever session gets built next. One at a time; overwritten each run.
  - `teachingProfile` — how this child learns: grader-set `dimensions` and a
    prose `note`, plus script-computed `measured` and `concepts`. Read by the
    `teacher` agent before it writes a lesson. See "Teaching cycle records".
- **`sessions/{sessionId}`** — one per session, with `feedback` embedded.
  A graded session also carries `questionIndex[]` (id → section/guided),
  `quality[]`, and on a lesson `cycleOutcomes[]` — all computed by
  `save-grading.js` from the attempt record, never authored.

`scripts/db.js` exposes **virtual paths** so callers use short names:
`curriculum/{id}`, `topicStatus/{id}`, `brief/{id}` → `children/{id}` fields;
`feedback/{id}` → `sessions/{id}.feedback` (also flips status to `graded`).

**CLI scripts must close the connection** or the process hangs forever. Every
script ends with `.finally(() => close())`. If you write a new one, do the same.

### `topicStatus.topics[topicId]` — the per-topic record

```jsonc
{
  "verdict": "unassessed" | "weak" | "partial" | "known" | "mastered",
  "stage": { "phase": "placement|lesson|practice|check|retest", "practiceLevel": 2 | null },
  "placementScore": 3, "placementTotal": 10,     // set only by a placement session
  "checkScore": 8, "checkTotal": 10,             // set only by a check/retest session
  "checkAttempts": 1,                             // consecutive check fails; resets on pass
  "backtrackTo": null,                            // a prerequisite topicId once checkAttempts hits 2
  "confirmedOn": "18/10/2026",                    // set the day verdict becomes mastered
  "lastDate": "18/10/2026",
  "sessionHistory": [
    { "sessionId": "...", "date": "...", "kind": "practice", "phase": "practice", "practiceLevel": 2,
      "score": 8, "total": 10,                       // score = COMPLETION (got there in the end)
      "cleanScore": 6,                               // UNAIDED (right first try, no hints) — the mastery number; null on older entries
      "dominantErrors": ["wrong_column"],
      "hintsUsedTotal": 3, "revealedCount": 0, "exhaustedCount": 0, "verdictAtTime": "partial",
      "minutesTaken": 12.4 }                        // from the page's /finish summary; null on older entries
  ],
  "errorProfile": { "wrong_column": { "count": 4, "lastSeen": "18/10/2026", "lastSessionId": "..." } },
  "teachingHistory": [                            // one entry per lesson on this topic
    { "sessionId": "...", "date": "...",
      "cycles": [ { "concept": "digit-times-column", "conceptName": "...",
                    "outcome": "landed", "slipCodes": [] } ] }
  ]
}
```

This is the **real history** — not just the last session. `sessionHistory` and
`errorProfile` are what make the system adaptive: the `grader` agent reads the
trend across sessions, not a single data point, to decide what's next.

`mastered` and `checkOutcome`-driven transitions are **mechanically enforced**
by `save-grading.js` — a passed check always sets `mastered`, a failed one
never does. Everything else (how many practice levels, when to advance, when
to hold) is the `grader` agent's judgment call, informed by this history.

### Three numbers: completion, clean, and teaching

Every graded session has **two** scores, and conflating them is a real bug the
system is built to avoid:

- **Completion** (`score`, `marks[]`) — how many questions ended correct, with
  any amount of help. This is the child's morale number, shown big on their own
  page.
- **Clean / unaided** (`cleanScore`, and the per-question `quality[]`) — right
  on the **first** try with **zero hints** and no reveal/exhaust. This is the
  **mastery** number.

A question gotten right only after a wrong try or a peeked hint is *completed,
not mastered* — so a 10/10-completion session can be 6/10 clean, and that is a
**hold**, not an advance. `save-grading.js` writes `quality[]` (one of
`"clean" | "helped" | "wrong"` per question) onto the session doc and
`cleanScore` into each `sessionHistory` entry, both computed **deterministically
from the attempt record** — never authored by the grader. The parent dashboard
leads with the clean number (completion shown as softer context / on hover);
the grader's advance thresholds all read clean (see `grader.md` Step 3's
"two numbers" rule). Checks/retests offer no hints, so their two numbers nearly
coincide — the gap is a lesson/practice phenomenon. Never let a help-assisted
answer earn the same credit as an unaided one in a progression decision.

- **Teaching** (`cycleOutcomes[]`, and `guided` on the history entry) — how
  the lesson's guided cycle questions went. A guided question sits
  immediately after the explanation that taught it, with the full hint ladder
  up, so it measures **the teaching**, not the child's mastery.

**Guided questions are excluded from `score`, `total` and `cleanScore`.**
Counting a heavily-scaffolded question toward mastery inflates exactly the
number the grader advances on. They get their own record instead — see
"Teaching cycle records". Sessions graded before `questionIndex[]` existed
have no guided set recorded, so nothing is excluded and their stored numbers
are unchanged; a lesson from before the cutover therefore includes its one
`tryIt` in `cleanScore`, which is why lesson-day clean numbers step slightly.

## Session lifecycle

```
pending  →  submitted  →  graded
```

- `pending` — queued, waiting for the child. **Only one at a time, per child.**
- `submitted` — they finished it; `/finish` sets this. What `fetch-latest.js` looks for.
- `graded` — `save-grading.js` has written marks and feedback.

Session id: `day{N}-{YYYY-MM-DD}` (e.g. `day3-2026-10-02`). `date` is British
`DD/MM/YYYY` for display.

## Session shape

Sessions are **staged** — this is what the child's page renders:

```jsonc
{
  "id": "day4-2026-10-16", "childId": "sam",
  "topicId": "...", "topicName": "...",
  "kind": "placement" | "lesson" | "practice" | "check" | "retest",
  "stage": { "phase": "practice", "practiceLevel": 2 },   // mirrors topicStatus.stage
  "uiMode": { "hintsMax": 1, "allowReveal": true, "retryPolicy": "multi", "showScore": true },
  "status": "pending",
  "prevSessionId": "day3-2026-10-15",        // feedback shown from this one
  "greeting": "...", "blurb": "...",
  "goal": "Read, write and order numbers up to a million",  // optional — one line,
                                                              // the page's "Today's goal:
                                                              // ...". Falls back to the topic's
                                                              // own description when omitted.
  "warmup":   { "from": "previous topic", "items": [ q, q ] },
  "teach":    { "title": "...", "cycles": [ cycle, cycle ] },   // lesson sessions only
  "practice": [ q, q, q, ... ],
  "close":    { "line": "...", "next": "..." },
  "attempts": []
}
```

`uiMode` drives the page's behavior — **not** `kind` by string-matching. It's
how a `check` session looks pixel-identical to `practice` while offering no
help:

| phase | hintsMax | allowReveal | retryPolicy | showScore |
|---|---|---|---|---|
| placement | 0 | false | oneShot | false |
| lesson (cycles + practice half) | 2 | true | multi | true |
| practice level 1 | 2 | true | multi | true |
| practice level 2+ | 1 then 0 | true | multi | true |
| check / retest | 0 | **false** | multi | true |

A question `q`:

```jsonc
{
  "id": "p_1",
  "ask": "2.6 × 10",
  "answer": "26",
  "hints": ["Which way do the digits move?", "Left. The 2 becomes tens."],
  "slips": {
    "0.26": { "code": "shift_wrong_way", "say": "You moved the digits right — that is dividing." }
  },

  // Everything below is optional — enrichment only, nothing required, every
  // session authored before this still renders exactly as it did.

  "ollie": {                                         // per-question override for Ollie's
    "fresh": "...",                                  // line, in place of the generic bank
    "wrong": "...",                                   // line (docs/mascot.md §1). One line
    "right": "..."                                    // per key covers every try at that
  },                                                   // outcome — not one per exact moment.
  "correctVisual": { "type": "placeValue", ... },      // shown on a correct answer, reinforcing
                                                        // WHY it's right (e.g. the digit lit up
                                                        // in its column). Same visual vocabulary
                                                        // as `visual` — see "Visuals" below.
  "workedVisual": { "type": "placeValue", ... },       // shown alongside the answer on "Show me
                                                        // how" — HOW, not just THAT. Enrichment
                                                        // only: the question still ends and scores
                                                        // exactly as a reveal always has.
  "hintVisuals": [ null, { "type": "placeValue", ... } ]  // parallel-indexed to `hints` — a
                                                        // diagram for a specific hint. A `null`
                                                        // entry, or a shorter array, is fine.
}
```

A `cycle` — teach a bit, then the child works on that bit:

```jsonc
{
  "concept": "digit-times-column",                  // short slug, unique in the session
  "conceptName": "A digit's worth is the digit times its column",
  "steps": [ { "big": "...", "note": "...", "visual": {...},
               "ollie": "..." } ],                  // REQUIRED — what Ollie says on this step,
                                                      // in her own words (docs/mascot.md §5). A
                                                      // step with none is refused on save.
  "q": { "id": "g1", ... },                         // exactly one, id required
  "secondAngle": { "steps": [ ... ] },              // shown only on a wrong answer
  "goldenRule": { "title": "...", "body": "..." },  // optional — the takeaway card under
                                                      // Ollie's narration ("Ollie's golden
                                                      // rule"). One rule per cycle, no card
                                                      // at all if omitted.
  "stepLabel": "Comma rule",                        // optional — short name for this cycle,
                                                      // shown next to "Part N of M" in the
                                                      // header badge instead of just the number.
                                                      // Under 30 chars — it's a small badge.
  "upNext": "1 quick check question"                // optional — a one-line preview shown
                                                      // before the child advances past this
                                                      // cycle's last step ("Up next: ..."). Under
                                                      // 80 chars.
}
```

**Why cycles.** A whole walkthrough then one question at the end is a lecture
with a quiz: by step 6 the child has forgotten step 1 and nothing checked
understanding until the idea was fully delivered. Each cycle's guided
question also *measures that explanation* — see "Teaching cycle records".

Older lessons carry `teach.steps[]` + `teach.tryIt` instead. They still
render and grade: `public/session-shape.js` normalises them to a single
cycle, so their counts are unchanged. Write cycles.

- `warmup` and `practice` must both exist. `teach` only on lesson sessions.
- **Every question needs an `id`**, unique across the session. Without one
  the page falls back to a positional id, so inserting a question renumbers
  every later one and attaches old attempts to the wrong question.
  `verify-session.js` blocks this.
- A question with `hints: []` shows no clue button.
- A question or a `teach` step may carry a `visual` — see `docs/visuals.md`. A
  `type: "scene"` visual is written in two halves: the `teacher`/`author` state
  `request` + `facts` (what must be true of the picture), and the `illustrator`
  agent draws `items`. `verify-session.js` recomputes every fact from the drawing
  and blocks a mismatch or a scene nobody has drawn.
- `q.ollie`, `q.correctVisual`, `q.workedVisual`, `q.hintVisuals`,
  `cycle.goldenRule`, `cycle.stepLabel`, `cycle.upNext` are
  all optional enrichment (`steps[].ollie` is not — it is required) — see the `q`/`cycle` examples above.
  `verify-session.js` **blocks** a step with no `steps[].ollie` (so a generic
  bank line never reaches the child; `secondAngle` steps included), checks length caps on
  the rest, and lints every authored Ollie line for the same first-person
  rule as the bank (docs/mascot.md §1/§8).
- `q.workedVisual` is deliberately **scoring-neutral**: it enriches what
  "Show me how" shows, but the question still ends and scores exactly as a
  reveal always has. A flow where the child sees the worked example and then
  still types the answer themselves is a bigger change — a new attempt/
  scoring state — and is not this.
- **A `slips` key must never equal the correct answer** — that marks a right
  answer wrong. `verify-session.js` blocks this.
- A check/retest session's slips have `say: ""` — the `code` is still
  recorded on the attempt (silent diagnostic capture), but nothing is shown.
- `ask` with no letters and no `?` of its own renders with `= ?` appended
  (`24 × 10` → `24 × 10 = ?`). An `ask` that already embeds its own blank
  (`1/3 = ?/6`, answer `2`) or has letters renders as-is, unsuffixed — do not
  write `?` into an `ask` expecting the page to add a second one. A real
  production bug: `1/3 = ?/6` rendered as `1/3 = ?/6 = ?` and the child,
  reading two things to answer, typed `2/6` then `2` and got marked wrong for
  a correct answer in the wrong format. If a question needs an explicit
  single-blank form like this, prefer phrasing with words ("What's the
  missing numerator in 1/3 = ?/6?") over a second bare symbolic blank, so
  it's unambiguous there is exactly one number to type.

There is also a **legacy shape** (`questions[]` / `tips[]` / `tags[]` / `answers[]`)
in older session docs. The scripts still read it, but the child's page does **not**
render it — `GET /api/sessions/next` requires `warmup` to exist. Write staged.

## How the child's page works

The page renders whatever session shape the backend produces, posts every try as
it happens, and never leaves the child stuck. Boot, reload-resume and empty
states are in `docs/child-page.md`; what grading and authoring depend on is here.

**Each answer POSTs immediately** to `/api/sessions/:id/attempts`:
`{ questionId, given, correct, tries, hintsUsed, slipCode, msTaken }`, plus
`usedHelp`, `cluesUsed`, `showedMe`. One row per *try*, so `attempts[]` is the full record — not a final
snapshot. This is what you grade from.

**The help ladder** (any session with `uiMode.retryPolicy: "multi"`). A wrong
answer escalates — the child is never left stuck:

| Wrong try | What happens |
|---|---|
| 1 | Ollie's "good try" + the matching `slips` message, if any (shown under the answer box). The clues **unlock**; none is open yet |
| tap "Need a hand?" | the next unseen clue opens under the answer box and Ollie reads it |
| 2+ | the next unseen clue opens by itself (the child's own tap is never required) |
| after the last clue | a **"Show me how"** button (only if `uiMode.allowReveal`); one more wrong try opens it too |
| 4 (check only) | if `allowReveal` is false there are no clues at all, and a **"Move on"** button appears instead — no answer shown, just an exit |

(Clues are the Ollie kit's `OllieClues`; see `docs/child-page.md`. A question with no
`hints` keeps a plain "Show me how" button from the third try.)

"Show me how" reveals the answer with the last hint as the method, says
*"Good on you for keeping at it"*, and moves on — never framed as failure. Its
attempt is posted with `revealed: true`.

"Move on" (check sessions, `allowReveal: false`) posts `exhausted: true` and
moves on **without ever showing the answer** — an unaided check must stay
unaided even when a child genuinely can't get there. This is a different
diagnostic signal from `revealed` (tried hard with zero help vs. needed help).

**When grading, `revealed` outranks a plain wrong answer, and `exhausted` on a
check outranks both** — it means the child could not do it even with no
pressure to perform. Re-teach with a different explanation and context, not
the same question again. Two reveals/exhausted on one topic across sessions
means backtrack to its prerequisite.

Because this ladder exists there is no Skip button: every question ends in an
answer, their own, a shown one, or a recorded "moved on."

**Placement is the exception** (`uiMode.retryPolicy: "oneShot"`): one try per
question, no hints, no reveal, no score at the end. That is how it measures
what they can do unaided on first contact with the topic.

## Error types

- **stopped-early** — did step 1, missed step 2+. Highest priority for multi-step.
- **missed-remainder** — right division, forgot the leftover (or gave only it).
- **calc-slip** — right method, arithmetic error.
- **misread** — wrong numbers or wrong operation.
- **blank / avoidance** — skipped. If blanks cluster on the later questions it is
  avoidance or fatigue, not a maths gap. See "Avoidance".
- **needed-showing** — `revealed: true`. Hints were not enough.
- **needed-exit** — `exhausted: true` (check sessions only). Genuinely stuck
  with zero help available — the strongest possible re-teach signal, since
  there was nothing to lean on.

Use these same names as `slipCode`/`errorType` values so `errorProfile`
aggregates correctly. Topic-specific codes are fine (`shift_wrong_way`,
`wrong_column`, ...) — reuse them across sessions on the same topic.

## Progression — dynamic, not a fixed script

There is no fixed "3 practice sessions then check." `grader` reads
`sessionHistory` and `errorProfile` and decides from the real trend. Starting
defaults it may deviate from (and should, when the data says otherwise):

- Advance a practice level after a session scores ≥80% **clean** (unaided —
  see "Two scores" above) with zero reveals. A high completion but low clean
  score holds the level instead.
- Move to `check` instead of another practice level after two such sessions
  in a row, or one at ≥90% clean with zero hints used at all.
- A slow or regressing trend holds the level, or drops one — it does not
  advance on schedule just because a session happened.
- `hintsMax` steps down as levels advance (2 → 1 → 0), `difficultyTier` steps
  up (`easy` → `core` → `stretch`) in step with it.
- A check fail → back to practice, a level grader judges appropriate, with a
  **different** angle — never the same questions again.
- A second consecutive check fail → **mandatory backtrack** to the lowest
  unmastered prerequisite (`save-grading.js` enforces this: `checkAttempts`
  reaching 2 requires `backtrackTo` to be set).

Within a single session, questions still run easy → hard, and a `stretch`-tier
session's hardest question is its Challenge 🌟 — but the overall shape of a
topic's *sequence of sessions* is adaptive, not templated.

Numbers stay clean (whole-number answers) unless deliberately teaching
remainders or decimals. `recallText` is the banner shown from `showRecallFrom`
onward — one habit sentence, refreshed in the child's current language.

**Session size is the same kind of decision.** `child.settings.sessionMinutes`
(15/30/45/60, the parent's choice — see "Topic queue" below for how to change
it) is a ceiling `grader` spends against, not a question count to hit — it
need not fill the budget. **`brief.questionCount` budgets `warmup.items` +
`practice[]`** — what `save-session.js` counts and, on a practice/check/
retest session, refuses to save a mismatch on.

**A lesson's teaching cycles are exempt.** How many cycles a child needs, and
how deep, is the `teacher` agent's pedagogical call — not something a time
budget caps. So on a lesson the number bounds the practice half only, and
`save-session.js` warns rather than blocks when it drifts. The count is the
grader's call, grown gradually (+2-4 at a time) as `sessionHistory.minutesTaken` shows the child
finishing comfortably inside budget with strong scores, and held or shrunk by
a struggling trend or the Avoidance rule below regardless of budget. Full
reasoning in `.claude/agents/grader.md` "Session size". Placement is always
exactly 10 questions, exempt from this entirely — its verdict bands are
absolute scores out of 10, below.

## Teaching cycle records — what was taught, and how it landed

Every cycle is a measurement. Its guided question sits immediately after the
explanation it tests, so the result says whether *that explanation* worked —
a thing no score has ever captured here.

`save-grading.js` writes, all **computed from the attempt record**, never
authored by an agent:

```jsonc
// on the session doc
"cycleOutcomes": [
  { "cycleIndex": 0, "concept": "digit-times-column", "conceptName": "...",
    "questionId": "g1", "firstTry": true, "tries": 1, "hintsUsed": 0,
    "secondAngleShown": false, "revealed": false, "exhausted": false,
    "slipCodes": ["face_value"], "secTaken": 38,
    "outcome": "landed" | "landed-after-hint" | "needed-second-angle" | "not-landed" }
]
```

`outcome` is the one readable verdict per cycle, derived in a single place so
the dashboard, grader and teacher cannot each invent their own rule.

It rolls up two ways:

- **Per topic** — `topicStatus.topics[id].teachingHistory[]`: did re-teaching
  this topic land the second time?
- **Per child** — `teachingProfile.concepts`, the cross-topic pattern:

```jsonc
"concepts": {
  "digit-times-column": { "taught": 3, "landedFirstTry": 0, "neededSecondAngle": 2,
                          "lastSeen": "26/10/2026", "lastOutcome": "landed-after-hint" }
}
```

A concept taught repeatedly that keeps needing a second angle is the signal
this whole feature exists to produce. The `teacher` reads it and must come at
such a concept from a **different representation**, not a reworded one; the
`grader` interprets it in `teachingProfile.note`; the parent sees it on the
dashboard as what the child is finding hard.

**The `concept` slug is what makes this worth keeping.** Without it the
history reads "cycle 2 failed again". Slugs are reused across topics where
the idea genuinely recurs. A legacy cycle has no concept: it is recorded in
`cycleOutcomes` with `concept: null` and left out of the `concepts` map —
counted in its session, invisible to the cross-topic pattern.

Guided outcomes **never move a verdict**. They move the teaching.

## Avoidance

If blanks cluster on the later, harder questions, treat it as a confidence signal
first and a maths gap second.

- Do NOT pile on harder work.
- Next day: more early wins, a "have a go — a wrong try is fine" recall line, and
  feedback pointing at a question they DID get right as proof they can do it.
- If blanks continue 2+ days, **shorten** the session (6–7 questions) before
  adding difficulty, and tell the parent — this may be fatigue or motivation,
  which only they can judge.
- Never write feedback that shames skipping. Praise attempts.

## The child's profile

Read `children/{childId}` (fetched by `grader`/`fetch-latest.js`). Key fields:
`name`, `age`, `stage`, `board`, `pronouns`, and `settings` (`sessionMinutes`,
`questionsPerSession`). Address the child by name; pitch language to their
age. A 7-year-old and a 12-year-old need very different voices and difficulty
curves.

**`pronouns`** — `{ subject, object, possessive, plural }`, e.g.
`{ "subject": "she", "object": "her", "possessive": "her", "plural": false }`.
The dashboards read it; **a profile without it gets they/them**, which is the
only safe default when nobody has said. `plural` picks the verb form, so
`they` gets "they *have* finished" rather than "they *has*".

Anything an agent writes *as prose* — `parentSummary`, `teachingProfile.note`,
a feedback card — is stored text the dashboard cannot re-template later, so
**write it in this child's pronouns**. Falling back to "he" because most
examples read that way is how the whole dashboard came to call every child a
boy.

## Topic queue

The parent controls which topics are taught and in what order via `topicQueue`
on `curriculum/{childId}` — an ordered array of topic ids. **A topic absent from
the queue is skipped**; never silently add one back.

They edit this themselves on the dashboard's Plan tab — reorder with arrows,
**Pause / Resume**, and a **Check first / Teach fully** toggle that flips
`schoolCovered` (only meaningful before a topic's first session). Those write
through `PATCH /api/curriculum/:childId`, so **re-read the queue at the start
of every grading run** rather than trusting anything cached.

**Pause is not delete.** A paused topic leaves the queue but keeps its
sessions, verdict and history, and returns at its curriculum position when
resumed. Never treat a paused topic as abandoned, and never silently re-add one.

**Hard rule — ungraded work freezes the queue.** A topic with a `submitted`
session cannot be moved, cannot be paused, and nothing may be placed ahead of
it. The API enforces this with a 409; the dashboard greys the controls. If you
hit it, the answer is always to grade first.

A reorder that puts a topic before one of its prerequisites is **warned about,
not blocked** — the parent may know something you do not.

**Finding the next topic** (the `grader` agent does this at the end of
grading, when a topic becomes `mastered`): walk `topicQueue` in order. The
first topic with no `mastered` verdict in `topicStatus` is the next one.

| Topic state | `grader` sets |
|---|---|
| `schoolCovered: true`, `verdict: unassessed` | `phase: "placement"` |
| `schoolCovered: false`, `verdict: unassessed` | `phase: "lesson"` |
| `verdict: weak` or `partial`, no lesson yet | `phase: "lesson"` |
| `verdict: weak` or `partial`, already taught | `phase: "practice"` (level per trend) |
| practice trend strong | `phase: "check"` |
| `verdict: known` | `phase: "retest"` when it next comes up in rotation |
| `verdict: mastered` | move to the next topic in queue |

## Placement sessions

Run when the current topic has `schoolCovered: true` and `verdict: unassessed`.

- Exactly **10 questions**: 3 easy → 4 core → 3 stretch. Fixed regardless of
  `sessionMinutes` — the verdict bands below are absolute scores out of 10 and
  would break if the count moved; see "Session size" in `grader.md`.
  Staged as **3 in `warmup.items`, 7 in `practice`**. No `teach` block.
- `uiMode`: `{ hintsMax:0, allowReveal:false, retryPolicy:"oneShot", showScore:false }`.
- `hints: []` on every question, **no `slips`** — coaching text would teach
  during an assessment.
- `recallText: ""`, `showRecallFrom: 999`.
- `kind: "placement"`.
- Greeting and close must be low-stakes. Never use "test", "exam" or "assessment".

**`grader` scores it** (defaults, overridable with stated reasoning when the
data disagrees — e.g. keyboard-mash non-attempts should not drag a verdict
down):

| Score | Verdict | Meaning |
|---|---|---|
| 9–10 / 10 | `known` | School covered it; confirm with a retest later |
| 6–8 / 10 | `partial` | Partly there; → practice (no lesson) |
| 0–5 / 10 | `weak` | Not secure; → lesson → practice → check |

No feedback card for any placement verdict: `known`/`partial` because the
session should feel positive and low-stakes, `weak` because it routes to a
lesson and the gating rule above skips the card whenever `phase: "lesson"`
comes next — the lesson's greeting carries the bridge instead.

## Learning sessions (lesson / practice / check / retest)

**`weak` or `partial`, no lesson yet** → `teacher` agent writes a lesson
session: `teach.steps[]` walkthrough (4-6 steps, one worked example carried
through every step, the last step addressing this child's specific known
trap) built as `teach.cycles[]` — each a few steps, one guided question and
a `secondAngle` — then a practice half of `brief.questionCount` questions
(`uiMode.hintsMax:2`, same help level as the cycles — day one, full
support). The cycles themselves are unbudgeted; `questionCount` covers the
practice half only. A generous budget on a lesson day buys more teaching
depth first, more practice second.

**The bar for a lesson** (enforced in `.claude/agents/teacher.md`, and worth
checking when you read its report): cycle 1's step 1 **defines the idea in plain words**
before any worked example — a lesson that opens on an example leaves the child
inferring the concept from watching numbers move, which is how the first
`equivalent-fractions` lesson failed. At least one step says **why** the rule
is true, not just what it is. And where the topic has a standard visual model,
the lesson **shows a diagram** rather than asking the child to picture one —
see `docs/visuals.md`. The report's `DEFINITION:`, `WHY:`, `VISUAL:` and
`MISSING PRIMITIVE:` lines exist so these are visible without reading the JSON.

**Already taught, in practice** → `author` writes a practice session at the
level and `difficultyTier` `grader` set, sized at `brief.questionCount` —
the `grader`'s session-size call within the parent's `sessionMinutes` budget
(see `grader.md` "Session size"), starting around 10 and growing gradually
as the child's own pace and history earn it. `grader` reads the result and
decides: advance a level, hold, or move to check — see "Progression" above,
this was never a fixed count and still isn't.

**Check** → `author` writes `brief.questionCount` fresh questions (normally
kept near the traditional 10 — see "Session size" in `grader.md`, checks
don't balloon just because the budget allows it), `uiMode.hintsMax:0,
allowReveal:false`, camouflaged as an ordinary session. `grader` grades it
with `checkOutcome: "pass"` (→ `mastered`, mechanically enforced) or `"fail"`
(→ back to practice, or backtrack on the 2nd consecutive fail — also
mechanically enforced via `checkAttempts`).

**`known`, retest** → `brief.questionCount` questions (normally kept near the
traditional 5, same reasoning as check), same camouflaged `uiMode` as check.
≥80% → `mastered`. Below → drops to `partial`.

**Backtrack.** On the 2nd consecutive check fail: `grader` sets `backtrackTo`
to the lowest unmastered prerequisite, writes a flag note using the `"q":
"FLAG"` pattern in feedback, and the brief points at that prerequisite
instead. Tell the parent explicitly — this always goes through the "show me
before saving" gate, never auto-saved.

## Guardrails

- Never leave two sessions pending. Check `fetch-latest.js` first.
- Never change or delete the first session — it's the baseline record.
- `marks[]` length MUST equal the question count, or `save-grading.js` refuses.
- If `fetch-latest.js` says nothing to grade, **stop** and tell the parent.
- Every question must be solvable with the child's known tables and operations.
- Never save a session that fails `verify-session.js` — `save-session.js` runs it
  itself and refuses, so this no longer depends on anyone remembering.
- A check/retest `checkOutcome:"pass"` always sets `verdict:"mastered"`;
  `"fail"` never does — this is enforced in code, do not try to write around it.
- `checkAttempts` reaching 2 requires `backtrackTo` to be set, or
  `save-grading.js` refuses to save.
- When unsure whether an answer is right, **work it out longhand** before marking.
- You are the whole feedback loop for a child. Act like it.

