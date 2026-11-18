# Orchestration — running the pipeline

Read this when you are the top-level session driving the daily loop, not a
subagent. The `/grade` and `/next-session` command files carry these steps
too; this is the fuller reference behind them.

## The setup (how the pieces fit)

- The child does a session on a web page → answers save to **MongoDB**.
- You (Claude Code, on the parent's Mac) run the pipeline: **grade → decide →
  build → verify → queue.**
- The child's id (e.g. `sam`) is the key used across all documents.

**Sessions are written ahead of time, never at request time.** The server does no
LLM work: `GET /api/sessions/next` just hands over whatever is already `pending`.
That means no API key on the server, no latency for the child, and you get to
review a session before they ever see it.

**Node:** the scripts and the agents call plain `node`. If your Node is managed
by a version manager and an agent cannot find it, put the full path in
`.claude/launch.json` and in the agent prompts that run scripts.

**Network:** these scripts only reach MongoDB from the parent's *real* Mac. The
Claude cloud container and `device_bash` VM are proxy-blocked.


## The pipeline (parent says "grade today")

This replaces reasoning about grading and progression by hand — the `grader`
agent owns that judgment now, informed by the full topic history, not a single
session.

1. **Fetch.** `node scripts/fetch-latest.js`. If it says nothing to grade,
   **stop** — do not invent answers. Note the `sessionId`, `childId`, `topicId`.
2. **Grade and decide.** Launch the `grader` agent with those three ids and an
   output path. It marks the session, diagnoses every wrong answer, decides
   the verdict and the next stage (reading the *entire* `topicStatus` history,
   not just this session), writes a structured brief for whatever comes next,
   writes a plain-English `parentSummary` of what he's solid on and what
   pattern of struggle showed up (this is what the parent-facing dashboard
   shows — not question ids, not a raw score), and decides whether a feedback
   card is even needed (`needsFeedback`) — but does not write the card's
   words. Read its terse report.
3. **Write feedback.** If the grader's report says `NEEDS FEEDBACK: yes`,
   launch the `feedback` agent on the grader's output file — it reads the
   diagnosis and the session itself and writes the card(s) back into that
   same file. Skip this step when it says `no` (nothing to build means no
   session to grade, a `lesson` phase recaps nothing, or `brief` is `null`).
4. **Build.** Branch on the brief's `phase`:
   - `lesson` → launch the `teacher` agent (writes `teach.cycles[]` — each
     a few steps, a guided question and a `secondAngle` — plus the practice
     half, all in one session). Pass it the `teachingProfile` path too.
   - anything else (`placement`/`practice`/`check`/`retest`) → launch the
     `author` agent.
   - `brief` is `null` → nothing to build (all topics mastered, or a
     backtrack needs your attention first). Say so.
5. **Illustrate.** `node scripts/scene-facts.js <file> --pending` lists any
   diagram the `teacher`/`author` asked for but nobody has drawn yet (a
   `type: "scene"` visual with `request` and `facts` but no `items`). If it
   prints `[]`, skip this step. Otherwise launch the `illustrator` agent on
   the session file — it draws each one and confirms the checker measures
   what the facts say. Subagents cannot start other agents, so this step is
   yours to run, between build and verify. See `docs/visuals.md`.
6. **Verify.** `node scripts/verify-session.js <file>`, fix any blocking
   errors, then the `verifier` agent for an independent cold re-solve. A
   scene still lacking a drawing is a blocking error.
7. **Gate.**
   - Verifier PASS → save automatically. This includes a topic's first
     lesson — independent cold re-solve is the bar, not session type.
   - Verifier FAIL, or the brief carries a `backtrackTo` → show me the
     session before saving. These are the only holds.
8. **Save.** `node scripts/save-grading.js <grader's output file>` commits the
   grading (marks, feedback, topicStatus, the brief) — run this as soon as
   step 3 finishes (grading and its feedback card are committed together), it
   does not wait on step 4-7. Then, once the new session is verified:
   `node scripts/save-session.js <teacher/author's file>` queues it as
   pending. It runs `verify-session.js` itself first and refuses on any blocking
   error (`--force` does not bypass that), so a save cannot skip the check. Archive the grading file as `grading/<sessionId>.json` — a local
   working/audit copy only, gitignored (see `grading/example.json`'s note in
   "Files" below). The committed MongoDB writes from step 7 are the real
   record; this file is just handy for re-reading what the grader decided
   without querying Mongo.

## Reporting to the parent

They are a busy parent, not a reader of reports. Relay the `grader` agent's
report line plus the build outcome as a markdown table, nothing else:

```
| Score | Phase | Topic |
|---|---|---|
| <n>/<total> | <phase> | <topic> |

| Right | Wrong |
|---|---|
| <ids, comma-separated, or —> | <id> "<given>" → <expected>; ... (or —) |

| Pattern | Tomorrow |
|---|---|
| <one line> | <one line — what was built and why> |
```

Each cell is one line — no `<br>`, no wrapped sentences. Use `—` for an
empty cell (e.g. no wrong answers), never leave it blank or write "none".
`Pattern` is the grader's `parentSummary`, verbatim (trimmed to one line) —
the same text that lands on the dashboard, not a fresh summary you write.

**Marking, diagnosis and the verdict are the `grader` agent's job.** It
decides; you relay. Messy data, a borderline score, a doubtful verdict — it
works that out and commits, stating why in `Pattern`. The parent can always
overrule; they should not have to adjudicate.

Only ask them about things **only they can know**: whether the child was
tired, upset or not trying, whether to shorten sessions, anything about
motivation or what's going on at home or school. One line of plain
observation, no diagnosis of the child, and ask only if their answer changes
what happens next.

No preamble, no headings, no reasoning written out in your own voice.


## The agent pipeline

Seven agents in `.claude/agents/`, each with one precise job and a locked
output schema. Each writes its output to a file — never raw prose into chat —
so the next step parses data, not language.

Five of them run daily, on `sonnet`. The other two run once per child per
stage, for `/setup-child`: `curriculum` is `opus` at `effort: high` — it
defines the whole year's map, so it is the one place where being slow and
careful is worth paying for — and `curriculum-reviewer` is `sonnet` at
`effort: medium`, checking that map cold before the parent ever sees it.

- **`curriculum`** — researches a board + stage framework and writes the
  child's topic list: ordered, split into teaching **groups**, and linked by
  real **prerequisites**. Used by `/setup-child`. Writes a profile JSON for
  parent approval, never to the database. See
  `.claude/agents/curriculum.md`.
- **`curriculum-reviewer`** — independently reviews that profile with no
  sight of how it was derived: every `prereqs` link tested against "could a
  child who never did P still learn T?", every topic checked for a
  prerequisite it's missing, every group checked for whether it actually
  reads as one family. `save-curriculum.js` only validates structure (ids
  exist, no cycles) — this is the judgment call a script cannot make. Does
  not block approval, but a `FAIL` is shown to the parent before they sign
  off. See `.claude/agents/curriculum-reviewer.md`.
- **`grader`** — grades the submitted session against the full topic history
  and decides what's next. Writes marks, diagnosis, the verdict, the stage
  transition, and the session brief, plus whether a feedback card is needed
  (`needsFeedback`) — but not the card's words. The only place progression
  judgment happens. See `.claude/agents/grader.md`.
- **`feedback`** — only when the grader set `needsFeedback: true`. Turns its
  diagnosis into the actual card the child reads: one question per card,
  steps grounded in the child's own wrong answer, never opening with a
  different question's result. See `.claude/agents/feedback.md`.
- **`teacher`** — only for `phase: "lesson"`. Writes a real multi-step
  walkthrough (`teach.steps[]`, one worked example carried through all of
  them, highlighting the specific trap this child hit) + a guided `tryIt` +
  the practice half of the session. Not a static card then straight to
  questions — a real step-by-step teach.
- **`author`** — writes placement/practice/check/retest questions from the
  brief. Reads `brief.uiMode`/`difficultyTier`/`dominantError` and executes
  exactly what it says — it does not decide progression, `grader` already did.
  The `slips` map (predicted wrong answers) is the valuable part of its job,
  not the questions themselves.
- **`illustrator`** — only when the session carries a scene request. Draws
  each diagram the `teacher`/`author` asked for, from the macros and atoms in
  `docs/visuals.md`. Never writes SVG, never changes a question, its answer or
  the facts (it can only set a scene's `items`, through
  `scripts/set-scene-items.js`), and reads back what the checker measures
  before handing over. Reports `MISSING MACRO:` when a request needs a
  drawing nothing can make — that line triggers building one. See
  `.claude/agents/illustrator.md`.
- **`verifier`** — re-solves every question cold, no sight of how it was
  written. Catches wrong answer keys in word problems and lesson walkthroughs
  alike. FAILs on any disagreement or ambiguity. Never edits, never saves.

**Always verify before saving.** Three layers, cheapest first:

1. `node scripts/verify-session.js <file>` — deterministic, no LLM. Checks
   every pure-arithmetic answer, catches slips equal to the correct answer,
   duplicate ids, missing fields. Exit 1 blocks the save.
2. The `verifier` agent — for everything the script couldn't parse.
3. You — only for a verifier FAIL or a backtrack. A verifier PASS saves
   automatically, first lesson or not — don't hold routine work for approval
   the pipeline already gave.

A wrong answer key is the worst thing this system can produce: the child is
marked wrong for being right, and then the feedback card teaches them the
error. Never skip the verification.

**Retention, not surprise tests.** There is no test day, ever — not even for
a `check` session, which is deliberately indistinguishable from an ordinary
practice session (see `uiMode` above). If a `mastered` topic's `confirmedOn`
is 42+ days ago, `grader` adds it to the brief's `retentionQuestions`; the
building agent folds 2-3 of its questions into the next session's warm-ups,
uncredited. A session branded as a test is exactly what triggers avoidance.


## Slash commands

- `/grade` — the full pipeline above.
- `/next-session` — run the same pipeline when there is nothing to grade yet
  (the first session after setup, or a restart after a gap) — `grader` still
  runs, just with no session to mark, straight to deciding the brief.
- `/status` — read-only progress check.
- `/setup-child` — research the curriculum and create a child profile.
- `/run` — start the local dev server.


## The child page — a stable template

`public/index.html` renders whatever session shape the backend produces. New
topics, new practice levels, new check sessions are **pure data** — writing a
session JSON via `save-session.js`. Code changes to this file should be rare
and deliberate, never an automatic side-effect of building a session. If a
new session shape genuinely needs a page change, make it as its own small,
explicit edit — not bundled silently into a content-authoring pass.

## Files

- `app.js` — Express app (routes, no listen). `server.js` — local dev.
  `netlify/functions/api.js` — serverless wrapper.
- `public/index.html` — the child's session page (stable template, see above).
- `public/dashboard.html` — the parent's view (`/api/dashboard/:childId`): Overview, Topics, and one topic. Per-topic wording comes from the grader's `topicNote`/`topicWatch` (stored as `parentNote`/`parentWatch`). The Re-teach button posts to `/api/children/:id/topics/:topicId/reteach`, which sets `topicStatus.reteach` so the next brief is a fresh lesson. `dashboard-classic.html` is the previous version, kept as a fallback.
- `scripts/db.js` — MongoDB layer: `connect`, `close`, `getDoc`, `setDoc`,
  `listSessions`, `assertReachable`, plus virtual-path routing (`curriculum`,
  `topicStatus`, `feedback`, `brief`).
- `scripts/fetch-latest.js` — show the newest ungraded submitted session.
- `scripts/verify-session.js` — deterministic answer-key checker. Exit 1 = block.
- `scripts/save-curriculum.js` — validate and save an approved profile.
- `scripts/save-grading.js` — commit the `grader` agent's decision: marks,
  feedback, `topicStatus` merge, and the next brief. Does **not** write the
  next session's question content — that's `save-session.js`, after the
  `teacher`/`author` agent has built and verified it.
- `scripts/save-session.js` — queue a session (the standalone/build-only path,
  and also what the pipeline uses after `teacher`/`author` + verification).
- `scripts/save-brief.js` — commit a brief-only grader decision (`/next-session`
  path, when there's no prior session to grade).
- `.claude/agents/curriculum.md` (setup, `opus`), `curriculum-reviewer.md`
  (setup, `sonnet`), `grader.md`, `feedback.md`, `teacher.md`, `author.md`,
  `verifier.md` (daily, `sonnet`).
- `grading/example.json` — the grading-decision schema, filled in as a sample
  (the only `grading/*.json` that's actually committed — every other file in
  that folder is a real child's working/audit data, gitignored).
