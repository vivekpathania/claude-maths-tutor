---
description: Show where the programme is — latest sessions, pending day, topic state, trend
---
Follow the `/status` section in CLAUDE.md. Read-only — do not modify any data.

1. Run `node scripts/fetch-latest.js`. Note whether there is a submitted-but-ungraded session.
2. Read the child and their sessions straight from MongoDB with `scripts/db.js`
   — the old `GET /api/get/...` and `GET /api/list/...` routes are gone, and the
   API now requires a key (`docs/deploy.md`). One node call does both:

   ```js
   const { connect, close } = require('./scripts/db');
   (async () => {
     const db = await connect();
     const child = await db.collection('children').findOne({});   // the only child
     const sessions = await db.collection('sessions')
       .find({ childId: child._id }).sort({ createdAt: -1 }).limit(5).toArray();
     console.log(JSON.stringify({ child, sessions }, null, 2));
   })().finally(() => close());
   ```
3. Summarise those last 5: date, score, topic, kind (placement / learning / free-form).
4. Report in this order:
   - Current topic (from topicQueue / first unmastered) and its verdict/phase
   - Pending session (if any) — date and topic
   - Awaiting grading (if any) — session id
   - Last 5 scores with error-type summary
   - Any attention items (Beginner verdicts, stale Masters >42 days)
5. End with one-line recommendation: what to do next.
