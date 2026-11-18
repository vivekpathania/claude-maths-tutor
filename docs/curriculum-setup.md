# Child setup & curriculum (`/setup-child`)

Read this when you are the `curriculum` agent, or running `/setup-child`.
Runs once per child per stage — not part of the daily loop.


The parent states board + stage; the **`curriculum` agent** researches the
OFFICIAL framework and drafts the topic list; they approve. Maths only.

**Do not do this research yourself.** It is the agent's job precisely so the
result has the same shape and the same quality bar every time it runs — see
`.claude/agents/curriculum.md`. Your job in `/setup-child` is to gather the
inputs, relay its report, and run the save script once the parent approves.

- **Ask for a source.** Much of a board's detailed framework sits behind a
  school login, so ask the parent up front whether they have a syllabus URL
  or the school's PDF. Given one, the agent reads it and the result is
  `verified`; without one it falls back to recall. Worth asking every time.
- **Honesty about sources:** `research.status` is `verified` only if an
  official page or the parent's syllabus was actually read. Otherwise
  `model-knowledge`, said plainly at the top of the draft. Never present
  recall as verified. A mixed result is normal — the agent reports which
  parts were confirmed and which were recalled.
- **Groups.** Every topic belongs to a teaching family (`groups[]` +
  `topics[].group`): "Fractions", "Place value and rounding". `strand` alone
  is far too coarse to be useful — a primary stage puts ~30 of 40 topics
  under "Number". 3-8 topics per group.
- **Prerequisites are the chain.** `prereqs` lists **direct** prerequisites
  only; the chain a parent sees ("before this topic, these should be done")
  is walked transitively, so listing grandparents makes it noisy. A
  prerequisite is a real dependency — *could a child who never did P still
  learn T?* — not merely what is taught before it. Every prerequisite must
  have a lower `order` than its dependent; `save-curriculum.js` enforces
  this and it also rules out cycles. The script additionally **warns** when
  the graph looks like a straight line (most topics with exactly one parent,
  or chained to whatever precedes them) — that is the signature of ordering
  dressed up as dependency, and it makes the chain worthless.
- If the framework assumes a skill it does not list, the agent adds it
  explicitly and flags it under `ADDED` in its report. Read those.
- Set `schoolCovered` per topic. Default `true` routes a topic through
  placement, which discovers what they already know instead of re-teaching
  it. Say plainly that it was defaulted, and that they can flip any topic to
  "Teach fully" on the dashboard's Topics tab — it is their call, not yours.
- `settings` come from the child's age with a one-line `reason`. Keep
  sessions short for younger children — fatigue and avoidance appear quickly.
- **The parent approves before anything is written.** No database writes
  while drafting. The agent writes a file; a script persists it.
- Save with `node scripts/save-curriculum.js profiles/<childId>.json` (`--dry`
  first). It writes `children/{id}` and `curriculum/{id}`, generates `topicQueue`
  from topic order, and refuses to overwrite without `--force`. Every topic
  starts with `verdict: "unassessed"`.

