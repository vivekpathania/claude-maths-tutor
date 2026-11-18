---
description: Build and queue a session without grading one first — the first session after setup, or a restart after a gap
---
Use this when there is nothing to grade but a session is needed. For the
normal daily loop use `/grade` instead, which decides and queues the next
session as part of grading.

Arguments (optional topic override): $ARGUMENTS

1. **Check nothing is already waiting.** Run `node scripts/fetch-latest.js`.
   - If a session is submitted and ungraded → stop. Tell me to run `/grade` first.
   - If a session is already pending → stop. The child has not done it yet.

2. **Decide the brief.** Launch the `grader` agent in **brief-only mode** —
   give it `childId` and an output path, no `sessionId`. It reads
   `children/{childId}` itself, walks `topicQueue` for the first unmastered
   topic, and writes `{ childId, brief }`. If there is no child document at
   all, stop and tell me to run `/setup-child`.

3. **Commit the brief.** `node scripts/save-brief.js <grader's output file>`.
   If `brief` came back `null`, every topic is mastered — stop and tell me.

4. **Build.** Branch on `brief.phase`: `"lesson"` → `teacher` agent;
   anything else → `author` agent. Give it the brief's path and an output
   path for the session file.

5. **Illustrate.** `node scripts/scene-facts.js <file> --pending`. If it
   prints `[]`, skip this step. Otherwise launch the `illustrator` agent on
   the session file — the teacher/author wrote what each diagram must show,
   it draws them. If it reports `MISSING MACRO:`, show me that line: a
   drawing no macro can make blocks the session.

6. **Verify.** `node scripts/verify-session.js <file>`, fix any blocking
   errors, then the `verifier` agent on the same file.

7. **Gate.**
   - Verifier PASS → save immediately: `node scripts/save-session.js <file>`.
     It validates (shape, pending-session conflicts) before writing anything.
   - Verifier FAIL → show me the built session, wait for my go-ahead before
     saving. This is the only hold.
