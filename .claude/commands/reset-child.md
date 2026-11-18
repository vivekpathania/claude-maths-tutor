---
description: Wipe a child's sessions and progress for a clean re-test, keeping the approved topic list
---
Dev/testing reset tool — not part of the daily pipeline. Arguments: childId (required). $ARGUMENTS

This deletes real data. Always:

1. Run `node scripts/reset-child.js <childId>` (no `--force`) first and show
   me the plan — session count, topicStatus entries, brief state.
2. Wait for my explicit go-ahead in chat before re-running with `--force`.
   Never add `--force` on your own initiative.
3. After it runs, report what was deleted and confirm the curriculum/topic
   list was left untouched.
