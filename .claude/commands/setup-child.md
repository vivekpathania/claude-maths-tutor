---
description: Set up a child's profile and draft a curriculum from the official board framework, for parent approval
---
Follow "Child setup & curriculum" in CLAUDE.md. The research and drafting is
the `curriculum` agent's job, not yours — you gather the inputs, relay its
report, and save once I approve. Arguments: $ARGUMENTS

1. **Ask me, in one short message** (skip anything already in the arguments):
   - child's name, age, stage/grade, board (e.g. Cambridge Primary)
   - their pronouns (he/him, she/her, they/them) — the dashboard writes a
     sentence about them on every line, and gets it wrong by default
     otherwise. If I do not answer, use they/them and say so.
   - **session length** — 15, 30, 45 or 60 minutes. Explain plainly what this
     actually is: a ceiling each session may spend, not a number of questions
     it must fill — the `grader` agent decides the real size of each session
     within it, and this can be changed anytime later from a topic's detail
     panel on the Topics tab if free time changes across the year.
   - optional: what the school is covering this month
   - **optional but worth asking for explicitly**: a syllabus URL, or the
     school's curriculum PDF/text. Say plainly why — much of a board's
     detailed framework sits behind a school login, and without a readable
     source the topic list is recalled rather than verified. If I have one,
     the agent uses it; if not, it falls back to model knowledge and says so.

2. **Launch the `curriculum` agent** with those inputs and an output path
   (`profiles/<childId>.json`). It researches the framework, drafts the
   topics, groups them into teaching families, works out the real
   prerequisite links, and proposes settings. Do not do this research
   yourself — the whole point of the agent is that the result is consistent
   every time it runs.

3. **If it came back `model-knowledge`, ask me again before showing me the
   draft.** The agent reports `TO VERIFY` — exactly what would upgrade the
   result. Relay that and ask me directly for a syllabus URL, or a path to
   the school's curriculum PDF (the agent can read a local PDF). One short
   question, not a lecture.
   - If I give you one → **re-run the agent** with it and use that result.
   - If I say I don't have one → carry on with the recalled list, and make
     sure the draft is labelled `model-knowledge` where I will see it.

   Do not skip this. A recalled topic list is the difference between
   teaching their actual syllabus and teaching a plausible guess at it, and
   the only cheap moment to fix that is before anything is saved.

4. **Launch the `curriculum-reviewer` agent** on the same file, once the
   source question in step 3 is settled. It has not seen how the graph was
   built and checks it cold: every `prereqs` link against "could a child who
   never did P still learn T?", every topic for a prerequisite it should
   have but doesn't, and every group for whether it actually reads as one
   teaching family. `save-curriculum.js` only checks structure (ids exist,
   no cycles) — this is the judgment call it cannot make.

5. **Relay both reports**, plus the draft as a readable table: group, order,
   topic, prerequisites, check-first/teach-fully. Call out the curriculum
   agent's `DOUBTS` and anything marked `ADDED (not in framework)`, whether
   research came back `verified` or `model-knowledge`, and the reviewer's
   `VERDICT`. If the reviewer came back `FAIL`, say so plainly and show its
   findings before I approve anything — it does not block you from showing
   me the draft, but I should see a flagged dependency problem before I
   sign off on it, not discover it mid-stage.

6. **Wait for me.** I will edit it ("drop X, move Y earlier, that prereq is
   wrong"). Re-run the `curriculum` agent, or patch the file directly, as
   needed — then re-run `curriculum-reviewer` on whatever changed before
   showing me again, since a patched graph deserves the same cold check as
   the original. **Nothing is written to the database until I say approve**
   — this is a hard rule, not a nicety.

7. **On approval**: `node scripts/save-curriculum.js profiles/<childId>.json --dry`
   first, then without `--dry`. Report what was saved, including any
   non-blocking warnings the validator raised.

This does not change any daily session.
