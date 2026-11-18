---
description: Grade the latest submitted session and build what's next — grader agent decides, teacher/author builds, verifier gates
---
Follow the "The pipeline" section in CLAUDE.md exactly. Arguments (if any): $ARGUMENTS

1. **Fetch.** Run `node scripts/fetch-latest.js`. If it says "nothing to
   grade", stop and tell me — do not invent answers. Note `sessionId`,
   `childId`, `topicId` from the output.

2. **Grade and decide.** Launch the `grader` agent with those three ids and
   an output path (e.g. `grading/decision-<sessionId>.json`). It fetches
   everything else itself (the session's attempts, the child's full
   `topicStatus` history) — do not paste prose context into its prompt beyond
   the ids and the path. It decides `needsFeedback` but does not write the
   card itself.

3. **Write feedback.** If the grader's report says `NEEDS FEEDBACK: yes`,
   launch the `feedback` agent with the same output path — it reads the
   diagnosis and the session, then writes the card(s) back into that file in
   place. Skip this step when it says `no`.

4. **Relay the result.** Print the grader's report translated into a markdown
   table, nothing else:

   ```
   | Score | Phase | Topic |
   |---|---|---|
   | <n>/<total> | <phase> | <topic> |

   | Right | Wrong |
   |---|---|
   | <ids, comma-separated, or —> | <id> "<given>" → <expected>; ... (or —) |

   | Pattern | Tomorrow |
   |---|---|
   | <grader's PARENT SUMMARY line, verbatim, plus any verdict override and why> | <one line — what's being built> |
   ```

   Each cell is one line, no wrapping, `—` for an empty cell. No preamble, no
   headings outside the tables, no reasoning in your own words. If the
   grader's report mentions an engagement concern (non-attempts, rushed
   timing), fold it into `Pattern` as plain observation — do not editorialize.

5. **Save the grading immediately.** `node scripts/save-grading.js
   <grader's output file>`. This commits marks, feedback, the `topicStatus`
   merge, and the brief — independent of whether building the next session
   succeeds. If it fails (e.g. `checkAttempts` hit 2 with no `backtrackTo`),
   stop and tell me; do not try to patch around a validation failure.
   If it refuses because the session is **already in `topicStatus`'s history**,
   an earlier run got that far and stopped partway — tell me. Re-running it
   as-is would count the session twice; `--resume` finishes the writes that are
   still missing without recounting.

6. **Read the brief.** `node -e` a quick `getDoc('brief/<childId>')`, or just
   use the file `save-grading.js` read from. If `brief` is `null`, stop here
   — say why (all topics mastered, or a backtrack needs my attention) and
   skip the rest.

7. **Build.** Branch on `brief.phase`:
   - `"lesson"` → launch the `teacher` agent with the brief's path and an
     output path for the session file.
   - anything else → launch the `author` agent, same inputs.

8. **Illustrate.** `node scripts/scene-facts.js <file> --pending`. If it
   prints `[]`, skip this step. Otherwise launch the `illustrator` agent on
   the session file — the teacher/author wrote what each diagram must show,
   it draws them. If it reports `MISSING MACRO:`, show me that line: a
   drawing no macro can make blocks the session, and the line is what causes
   one to be built.

9. **Verify.** `node scripts/verify-session.js <file>`, fix any blocking
   errors, then launch the `verifier` agent on the same file.

10. **Gate.**
   - Verifier PASS → save automatically, regardless of `brief.phase`. A
     first lesson is not a reason to hold it — the verifier's independent
     re-solve is the bar.
   - Verifier FAIL, or `brief` carries a `backtrackTo` (check `topicStatus`
     after step 6) → show me the built session before saving, wait for my
     go-ahead. These are the only two holds.

11. **Queue it.** `node scripts/save-session.js <built file>`, then archive
    the grader's decision file as `grading/<sessionId>.json`.

12. **Report:** the step-4 summary, plus what got built for next time and
    whether anything needs my attention (backtrack, parent-only questions
    from the grader, an unusually long pipeline run).
