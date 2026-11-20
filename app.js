// app.js — Express app (no listen). Used by server.js (local dev) and
// netlify/functions/api.js (production). All route logic lives here.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { getDoc, connect } = require('./scripts/db');
const { SESSION_MINUTES } = require('./scripts/session-minutes');

// A "day" here is the child's day, not the server's. Netlify runs in UTC, and a
// session finished at 00:30 in India is still "yesterday" in UTC — which broke the
// streak. Set TUTOR_TZ (e.g. Asia/Kolkata) on the host; locally it defaults to this
// machine's own zone. An unusable zone falls back to UTC rather than 500ing every call.
let TZ = process.env.TUTOR_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });   // "2026-11-01"
try { dayKey(Date.now()); }
catch (e) { console.error(`TUTOR_TZ "${TZ}" is not a valid time zone — using UTC.`); TZ = 'UTC'; }

const app = express();
app.use(express.json());
// Static serving is only active in local dev (Netlify serves public/ from CDN).
app.use(express.static(path.join(__dirname, 'public')));

// ── Authentication ───────────────────────────────────────────────────────────
// Two keys, because the child's iPad holds one of them permanently. The child
// key reaches only the three routes their page actually calls; the dashboard,
// curriculum edits and deletes need the admin key. A borrowed or lost iPad
// then exposes one child's questions, not the whole database.
//
// This FAILS CLOSED. With either key unset, every /api route 503s — an unset
// environment variable must never quietly mean "open to the internet", which
// is exactly how this would otherwise go live. See docs/deploy.md.
//
// The pipeline scripts (fetch-latest, save-grading, save-session, ...) talk to
// MongoDB through scripts/db.js and never touch the API, so none of this
// affects them.

function safeEqual(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  // timingSafeEqual throws on a length mismatch, and the length of a rejected
  // key is not worth protecting — compare hashes so both sides are 32 bytes.
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return a.length > 0 && crypto.timingSafeEqual(ah, bh);
}

// req.path inside app.use('/api', ...) has the /api prefix already stripped.
const CHILD_ROUTES = [
  { method: 'GET',  re: /^\/sessions\/next\/?$/ },
  { method: 'POST', re: /^\/sessions\/[^/]+\/attempts\/?$/ },
  { method: 'POST', re: /^\/sessions\/[^/]+\/finish\/?$/ },
  { method: 'GET',  re: /^\/audio\/[0-9a-f]{14}\/?$/ },      // Ollie's recorded lines for this session
];

// ── Demo mode ────────────────────────────────────────────────────────────────
// TUTOR_DEMO=on serves a PUBLIC demo: no key is needed, and nothing is ever
// written. It exists so a stranger can play a whole session on a deployed URL
// without being handed a key, and without their play reaching any database.
//
// Reads come from the database; writes are accepted and discarded (see the
// attempts and finish routes). So the demo cannot be worn out by visitors,
// cannot be vandalised, and never needs reseeding — the pending session stays
// pending however many people play it.
//
// It fails CLOSED on the database name, and that is the whole point of the
// check below. scripts/db.js falls back to "maths-tutor" when MONGODB_DB is
// unset, so a demo deployment with a forgotten or misspelled variable would
// otherwise serve a real child's sessions to the open internet, with no key,
// looking perfectly healthy while it did. A 503 is the better failure.
const DEMO = process.env.TUTOR_DEMO === 'on';
const DEMO_DB_FALLBACK = 'maths-tutor';          // db.js's default — never a demo database
const DEMO_DB = process.env.MONGODB_DB;
const DEMO_DB_OK = !!DEMO_DB && DEMO_DB !== DEMO_DB_FALLBACK;

// What the demo may reach: the child's own routes, plus the parent dashboard,
// which is half of what there is to show. Everything else — deleting sessions,
// editing the curriculum or the child — is refused outright, so the demo needs
// no protection beyond this list.
const DEMO_ROUTES = CHILD_ROUTES.concat([
  { method: 'GET', re: /^\/dashboard\/[^/]+\/?$/ },
]);

if (DEMO && DEMO_DB_OK) console.warn(`▸ DEMO MODE — no key required, nothing is written, database "${DEMO_DB}".`);
if (DEMO && !DEMO_DB_OK) console.error(`✗ TUTOR_DEMO=on but MONGODB_DB is ${DEMO_DB ? `"${DEMO_DB}"` : 'unset'} — refusing every request rather than risk publishing a real child's data. Set MONGODB_DB to a demo database.`);

// Authentication is ON. TUTOR_AUTH=off is an explicit, noisy escape hatch for local work
// only; leave it unset everywhere else.
const AUTH_ON = process.env.TUTOR_AUTH !== 'off';
// Not in demo mode: there the demo contract is what applies, and this line
// would claim writes are open when they are refused.
if (!AUTH_ON && !DEMO) console.warn('⚠ API authentication is OFF (TUTOR_AUTH=off) — anyone who can reach this server can read and write everything.');

app.use('/api', (req, res, next) => {
  // Demo mode outranks both the key check and TUTOR_AUTH: it is its own, far
  // narrower, contract.
  if (DEMO) {
    if (!DEMO_DB_OK) return res.status(503).json({ error: 'Demo is not configured: MONGODB_DB must name a demo database.' });
    if (DEMO_ROUTES.some((r) => r.method === req.method && r.re.test(req.path))) return next();
    return res.status(403).json({ error: 'This is a read-only demo.' });
  }
  if (!AUTH_ON) return next();
  const adminKey = process.env.TUTOR_ADMIN_KEY;
  const childKey = process.env.TUTOR_CHILD_KEY;

  if (!adminKey || !childKey) {
    console.error('TUTOR_ADMIN_KEY / TUTOR_CHILD_KEY are not set — refusing all API requests.');
    return res.status(503).json({
      error: 'Server is not configured: TUTOR_ADMIN_KEY and TUTOR_CHILD_KEY must be set. See docs/deploy.md.'
    });
  }

  const given = req.get('x-tutor-key');
  if (safeEqual(given, adminKey)) return next();

  const childRoute = CHILD_ROUTES.some(r => r.method === req.method && r.re.test(req.path));
  if (childRoute && safeEqual(given, childKey)) return next();

  res.status(401).json({ error: 'Unauthorized' });
});

// One child per deployment, so the pages never need to carry the child's name or
// id (both are public files): "me", or nothing, means the only child.
// shortcut: the first child found — with more than one, key each child separately.
async function resolveChildId(db, given) {
  if (given && given !== 'me') return given;
  const c = await db.collection('children').findOne({}, { projection: { _id: 1 } });
  return c ? String(c._id) : 'demo';
}

// ── Dashboard aggregation ─────────────────────────────────────────────────────
// Single endpoint: full child doc + all their sessions. Dashboard computes
// topic states, error taxonomy, and charts entirely client-side from this.

app.get('/api/dashboard/:childId', async (req, res) => {
  try {
    const db = await connect();
    const childId = await resolveChildId(db, req.params.childId);
    const [child, sessions] = await Promise.all([
      db.collection('children').findOne({ _id: childId }),
      db.collection('sessions').find({ childId }).sort({ createdAt: 1 }).toArray()
    ]);
    if (!child) return res.status(404).json({ error: 'Child not found' });
    const { _id: cid, ...childRest } = child;
    res.json({
      child: { id: String(cid), ...childRest },
      sessions: sessions.map(({ _id, ...s }) => ({ id: String(_id), ...s }))
    });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── Curriculum editing (the parent's controls on the Plan tab) ───────────────

// PATCH /api/curriculum/:childId
// Body: { topicQueue?: [id,...], topicUpdates?: { [topicId]: { schoolCovered } } }
// Read-modify-write: the curriculum doc holds topics[] too and must not be lost.
app.patch('/api/curriculum/:childId', async (req, res) => {
  try {
    const db = await connect();
    const childId = await resolveChildId(db, req.params.childId);
    const child = await db.collection('children').findOne({ _id: childId });
    if (!child || !child.curriculum) return res.status(404).json({ error: 'No curriculum for this child' });

    const curr = child.curriculum;
    const topics = (curr.topics || []).map((t) => ({ ...t }));
    const byId = new Map(topics.map((t) => [t.id, t]));

    if (req.body.topicUpdates && typeof req.body.topicUpdates === 'object') {
      const status = (child.topicStatus && child.topicStatus.topics) || {};
      for (const [id, patch] of Object.entries(req.body.topicUpdates)) {
        const t = byId.get(id);
        if (!t) return res.status(400).json({ error: `Unknown topic: ${id}` });
        if (typeof patch.schoolCovered === 'boolean') {
          // schoolCovered only picks the FIRST session's type. Once the topic
          // has a verdict that route is already taken and changing it is a no-op.
          if (status[id] && status[id].verdict)
            return res.status(409).json({
              error: `"${t.name}" has already started (${status[id].verdict}). Check-first vs teach-fully only applies before the first session.` });
          t.schoolCovered = patch.schoolCovered;
        }
      }
    }

    const prevQueue = curr.topicQueue || [];
    let topicQueue = prevQueue;
    if (Array.isArray(req.body.topicQueue)) {
      const unknown = req.body.topicQueue.filter((id) => !byId.has(id));
      if (unknown.length) return res.status(400).json({ error: `Unknown topic ids: ${unknown.join(', ')}` });
      if (new Set(req.body.topicQueue).size !== req.body.topicQueue.length)
        return res.status(400).json({ error: 'Queue contains duplicates' });

      // HARD RULE: a topic with work waiting to be graded is frozen in place.
      // Its grade decides what happens next, so nothing may move it, pause it,
      // or jump ahead of it. Checking the index covers all three.
      const ungraded = await db.collection('sessions')
        .find({ childId, status: 'submitted' }).toArray();
      const blocked = [...new Set(ungraded.map((s) => s.topicId).filter(Boolean))];

      for (const id of blocked) {
        const was = prevQueue.indexOf(id);
        const now = req.body.topicQueue.indexOf(id);
        const name = byId.has(id) ? byId.get(id).name : id;
        if (now === -1)
          return res.status(409).json({ error: `"${name}" is waiting to be graded and cannot be paused. Run /grade first.` });
        if (was !== -1 && now !== was)
          return res.status(409).json({ error: `"${name}" is waiting to be graded, so it cannot be moved and nothing can go ahead of it. Run /grade first.` });
      }

      topicQueue = req.body.topicQueue;
    }

    // Warn, do not block: the parent may know something we do not.
    const pos = new Map(topicQueue.map((id, i) => [id, i]));
    const warnings = [];
    for (const id of topicQueue) {
      for (const pre of (byId.get(id).prereqs || [])) {
        if (pos.has(pre) && pos.get(pre) > pos.get(id))
          warnings.push(`${byId.get(id).name} comes before its prerequisite ${byId.get(pre).name}`);
      }
    }

    await db.collection('children').updateOne(
      { _id: childId },
      { $set: { 'curriculum.topics': topics, 'curriculum.topicQueue': topicQueue,
                'curriculum.editedOn': dayKey(Date.now()) } }
    );
    res.json({ ok: true, topicQueue, warnings });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// PATCH /api/children/:childId
// Body: { settings: { sessionMinutes } }
// A narrow settings write — only sessionMinutes, only one of the four fixed
// choices. Not a general child-document editor: that is what the unsafe
// POST /api/set/:col/:id would be, which is exactly why this exists instead.
// Takes effect for the NEXT session the grader builds — a session already
// queued was sized when it was generated; discard and rebuild it to apply
// a new budget immediately (the existing Pause/Start flow already does this).
app.patch('/api/children/:childId', async (req, res) => {
  try {
    const db = await connect();
    const childId = await resolveChildId(db, req.params.childId);
    const child = await db.collection('children').findOne({ _id: childId });
    if (!child) return res.status(404).json({ error: 'Child not found' });

    const s = req.body.settings;
    if (!s || typeof s !== 'object') return res.status(400).json({ error: 'Body must be { settings: {...} }' });
    if (!SESSION_MINUTES.includes(s.sessionMinutes))
      return res.status(400).json({ error: `settings.sessionMinutes must be one of ${SESSION_MINUTES.join(', ')} (got ${s.sessionMinutes}).` });

    await db.collection('children').updateOne(
      { _id: childId },
      { $set: { 'settings.sessionMinutes': s.sessionMinutes } }
    );
    res.json({ ok: true, sessionMinutes: s.sessionMinutes });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// DELETE /api/sessions/:id — throw away a session that is still queued.
// Only ever a pending one: submitted work holds the child's answers and graded
// work is the record, so neither may be deleted here.
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const db = await connect();
    const s = await db.collection('sessions').findOne({ _id: req.params.id });
    if (!s) return res.status(404).json({ error: 'No such session' });
    if (s.status !== 'pending')
      return res.status(409).json({
        error: `That session is "${s.status}", not queued. Only a session they have not done yet can be discarded.` });
    await db.collection('sessions').deleteOne({ _id: req.params.id });
    res.json({ ok: true, discarded: req.params.id, topicId: s.topicId || null });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// POST /api/children/:childId/topics/:topicId/reteach — the parent asks for a fresh lesson.
// Marks the topic (topicStatus.reteach, which the grader reads and which a graded lesson
// clears), puts it first in the queue and throws away the session queued for them, since
// that one was built for the old plan. Refused while anything is waiting to be graded:
// the grade decides what comes next (same rule as the queue).
app.post('/api/children/:childId/topics/:topicId/reteach', async (req, res) => {
  try {
    const db = await connect();
    const childId = await resolveChildId(db, req.params.childId);
    const child = await db.collection('children').findOne({ _id: childId });
    if (!child || !child.curriculum) return res.status(404).json({ error: 'No curriculum for this child' });
    const id = req.params.topicId;
    const topic = (child.curriculum.topics || []).find((t) => t.id === id);
    if (!topic) return res.status(404).json({ error: `Unknown topic: ${id}` });
    if (!(child.topicStatus && child.topicStatus.topics && child.topicStatus.topics[id]))
      return res.status(409).json({ error: `"${topic.name}" has not been started yet, so there is nothing to re-teach. Use Start instead.` });
    const waiting = await db.collection('sessions').findOne({ childId, status: 'submitted' });
    if (waiting)
      return res.status(409).json({ error: 'A session is waiting to be graded. Run /grade first.' });
    const dropped = await db.collection('sessions').deleteMany({ childId, status: 'pending' });
    const queue = (child.curriculum.topicQueue || []).filter((q) => q !== id);
    queue.unshift(id);
    await db.collection('children').updateOne({ _id: childId }, { $set: {
      'curriculum.topicQueue': queue,
      'curriculum.editedOn': dayKey(Date.now()),
      [`topicStatus.topics.${id}.reteach`]: dayKey(Date.now())
    } });
    res.json({ ok: true, topicQueue: queue, discarded: dropped.deletedCount });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── Session API ───────────────────────────────────────────────────────────────
// Hand-crafted session for now (build order step 2).
// Step 9: replace buildDemoSession with LLM generation once the shape is proven.

function buildDemoSession(childId) {
  return {
    _id: 'sess_' + Date.now(),
    childId,
    topicId: 'decimal-place-value',
    topicName: 'Tenths and hundredths',
    status: 'pending',
    createdAt: new Date().toISOString(),
    greeting: 'Ready for today?',
    blurb: 'Two quick warm-ups, one new idea, then some practice. About 15 minutes.',
    warmup: {
      from: 'Multiply whole numbers up to 1000',
      items: [
        { id: 'wu_1', ask: '24 × 10', answer: '240',
          hints: ['A zero joins the end when you times by ten.'] },
        { id: 'wu_2', ask: '7 × 100', answer: '700',
          hints: ['Two zeros for a hundred.'] }
      ]
    },
    // Interleaved: teach a bit, work on that bit, teach the next bit. The demo
    // runs the CYCLES path deliberately — it is the no-profile entry point, so
    // it should exercise the shape real sessions use, not the legacy one.
    teach: {
      title: 'Times by 10 — everything shifts left',
      cycles: [
        {
          concept: 'place-value-columns',
          conceptName: 'Each column is worth ten times the one on its right',
          steps: [
            { big: '3.4', note: 'Three ones, and four tenths.',
              pv: [['Tens',''],['Ones','3'],['Tenths','4'],['Hundredths','']], lit: [1,2] }
          ],
          q: { id: 'tt_1', ask: 'In 3.4, which digit is in the tenths column?', answer: '4',
               hints: ['Tenths sit just after the decimal point.'] },
          secondAngle: { steps: [
            { big: 'ones . tenths',
              note: 'Read it aloud: three point four. The part after the point is the tenths.' }
          ] }
        },
        {
          concept: 'times-ten-shifts-left',
          conceptName: 'Multiplying by 10 moves every digit one column left',
          steps: [
            { big: 'Every digit moves one place LEFT',
              note: 'That is all multiplying by 10 does. The digits move — the decimal point stays put.',
              pv: [['Tens','3'],['Ones','4'],['Tenths',''],['Hundredths','']], lit: [0,1] },
            { big: '3.4 × 10 = 34',
              note: 'The 4 used to be tenths. Now it is ones.',
              pv: [['Tens','3'],['Ones','4'],['Tenths','0'],['Hundredths','']], lit: [0,1] }
          ],
          q: { id: 'tt_2', ask: '5.2 × 10', answer: '52',
               hints: ['Move each digit one place to the left.', 'The 5 becomes tens, the 2 becomes ones.'] },
          secondAngle: { steps: [
            { big: '0.7 × 10 = 7',
              note: 'Seven tenths becomes seven ones. Ten lots of a tenth is a whole one.' }
          ] }
        }
      ]
    },
    practice: [
      { id: 'p_1', ask: '2.6 × 10', answer: '26',
        hints: ['Which way do the digits move?', 'Left. The 2 becomes tens.'],
        slips: {
          '0.26': { code: 'shift_wrong_way', say: 'You moved the digits right — that is dividing. Times by 10 moves them left.' },
          '2.6':  { code: 'no_shift',        say: 'Close — but that is still 2.6. The digits need to move.' }
        }},
      { id: 'p_2', ask: '0.8 × 10', answer: '8',
        hints: ['The 8 is in the tenths place. Where does it go?'],
        slips: {
          '0.08': { code: 'shift_wrong_way', say: 'That moved right instead of left.' },
          '80':   { code: 'over_shift',      say: 'That is times 100, one step too far.' }
        }},
      { id: 'p_3', ask: '4.5 × 100', answer: '450',
        hints: ['A hundred is two moves, not one.'],
        slips: {
          '45':  { code: 'under_shift', say: 'That is only one move — times 10. A hundred is two.' },
          '4.5': { code: 'no_shift',    say: 'The digits did not move at all.' }
        }},
      { id: 'p_4', ask: '36 ÷ 10', answer: '3.6',
        hints: ['Dividing goes the other way.', 'Digits move one place right.'],
        slips: {
          '360':  { code: 'shift_wrong_way', say: 'You went left. Dividing moves digits right.' },
          '0.36': { code: 'over_shift',      say: 'That is dividing by 100, two places. ÷10 is only one.' }
        }},
      { id: 'p_5', ask: '0.07 × 10', answer: '0.7',
        hints: ['The 7 is in hundredths. One move left makes it…'],
        slips: {
          '0.007': { code: 'shift_wrong_way', say: 'That moved the wrong way.' },
          '7':     { code: 'over_shift',      say: 'That is two moves. Times 10 is only one.' }
        }},
      { id: 'p_6', ask: '9.4 × 100', answer: '940',
        hints: ['A hundred is two moves left.', 'You may need a zero to hold a place.'],
        slips: {
          '94':  { code: 'under_shift', say: 'One move short — that is only times 10.' },
          '9.4': { code: 'no_shift',    say: 'The digits did not actually move.' }
        }}
    ],
    close: {
      line: 'You got every "times by 100" one right today — that was the hard bit.',
      next: 'Tomorrow: dividing by 10 and 100.'
    },
    attempts: []
  };
}

// Monday-start week, same UTC day keys as the streak. done = a finished
// session that day, today = today with none yet, missed = a past empty
// day, later = still to come. Nothing here is filled in from a design mock.
function streakWeek(days) {
  const todayStr = dayKey(Date.now());
  const today = new Date(todayStr + 'T00:00:00Z');
  const dow = today.getUTCDay();
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    let state = 'later';
    if (days.has(key)) state = 'done';
    else if (key === todayStr) state = 'today';
    else if (key < todayStr) state = 'missed';
    week.push({ label: labels[i], state, today: key === todayStr });
  }
  return week;
}

// Consecutive calendar days (UTC) with at least one FINISHED session, counted
// back from today. A day with no session yet doesn't break yesterday's
// streak until the day actually ends — so the header can show "4-day
// streak" all day today even before today's session is done.
async function computeStreak(db, childId) {
  const sessions = await db.collection('sessions')
    .find({ childId, finishedAt: { $exists: true } }, { projection: { finishedAt: 1 } })
    .toArray();
  const days = new Set(sessions.map((s) => dayKey(s.finishedAt)));
  const week = streakWeek(days);
  if (!days.size) return { streak: 0, week };

  const todayStr = dayKey(Date.now());
  const cursor = new Date(todayStr + 'T00:00:00Z');
  if (!days.has(todayStr)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { streak, week };
}

// GET /api/sessions/next — serve whatever is already queued.
// Sessions are authored ahead of time by `/grade` on the parent's machine;
// nothing is generated at request time.
app.get('/api/sessions/next', async (req, res) => {
  try {
    const db = await connect();
    const childId = await resolveChildId(db, req.query.childId);

    const active = await db.collection('sessions').findOne({
      childId, status: 'pending', warmup: { $exists: true }
    });
    if (active) {
      const { _id, ...rest } = active;
      // Attach the previous session's feedback so the child reads it before starting.
      let feedback = null;
      if (rest.prevSessionId) {
        const prev = await db.collection('sessions').findOne({ _id: rest.prevSessionId });
        if (prev && prev.feedback && Array.isArray(prev.feedback.items) && prev.feedback.items.length)
          feedback = prev.feedback.items;
      }
      // A one-line "what this topic is" for the session header — cheap lookup,
      // keyed off the child's own curriculum rather than re-authored per session.
      // Child's own name/age/stage and streak for the header chrome — same
      // child lookup both the greeting and the streak piggyback on, one query.
      let topicDescription = null;
      const child = await db.collection('children').findOne(
        { _id: childId }, { projection: { 'curriculum.topics': 1, 'curriculum.groups': 1, name: 1, age: 1, stage: 1, 'settings.sessionMinutes': 1 } }
      );
      const topic = child?.curriculum?.topics?.find(t => t.id === rest.topicId);
      if (topic && topic.description) topicDescription = topic.description;
      const group = topic && child?.curriculum?.groups?.find(g => g.id === topic.group);
      const topicGroup = group && group.name ? group.name : null;
      const { streak, week } = await computeStreak(db, childId);
      return res.json({
        id: String(_id), ...rest, feedback, topicDescription, topicGroup,
        childName: child?.name || null, childAge: child?.age || null, childStage: child?.stage || null,
        sessionMinutes: child?.settings?.sessionMinutes || null,
        streak, week
      });
    }

    // No session waiting. If the child exists, say so honestly rather than
    // serving fake work.
    const child = await db.collection('children').findOne({ _id: childId });
    if (child) return res.json({ nothingQueued: true, childName: child.name || null });

    // No child profile at all — demo mode, never persisted.
    const session = buildDemoSession(childId);
    res.json({ id: session._id, ...session, demo: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// After an update matched nothing: is the session missing, or just not open?
async function sessionStatus(db, id) {
  const x = await db.collection('sessions').findOne({ _id: id }, { projection: { status: 1 } });
  return x ? x.status : null;
}

// POST /api/sessions/:id/attempts — record one attempt.
// Body: { clientId, questionId, given, correct, tries, hintsUsed, slipCode, msTaken }
//
// Only a PENDING session takes answers: a graded or submitted one is the record,
// and a stray write there would change what the grader already decided on.
//
// The page keeps an attempt until the server confirms it and re-sends if it never
// heard back, so the same attempt can arrive twice. `clientId` makes that
// harmless — a second copy is acknowledged and not stored again.
app.post('/api/sessions/:id/attempts', async (req, res) => {
  // In the demo the answer is accepted and thrown away: the page's retry queue
  // is satisfied, the visitor's play stays in their own browser, and the
  // session they are playing stays pending for the next person.
  if (DEMO) return res.json({ ok: true, demo: true });
  try {
    const db = await connect();
    const id = req.params.id, body = req.body || {};
    const filter = { _id: id, status: 'pending' };
    if (body.clientId) filter['attempts.clientId'] = { $ne: body.clientId };
    const r = await db.collection('sessions').updateOne(
      filter, { $push: { attempts: { ...body, recordedAt: new Date().toISOString() } } });
    if (r.matchedCount) return res.json({ ok: true });

    const status = await sessionStatus(db, id);
    if (status === null) return res.status(404).json({ error: 'No such session' });
    if (status === 'pending') return res.json({ ok: true, duplicate: true });    // already holds this clientId
    res.status(409).json({ error: `That session is "${status}", so it is not taking answers.` });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// POST /api/sessions/:id/finish — hand the session over for grading.
// status becomes "submitted" (the state fetch-latest.js looks for).
//
// Only a pending session can be finished. Finishing a GRADED one used to flip it
// back to "submitted", and the Plan tab then refused to move or pause its topic as
// "waiting to be graded". A finish that already landed is acknowledged, not an
// error, so the page can safely retry one whose reply it never saw.
app.post('/api/sessions/:id/finish', async (req, res) => {
  // Never flip the demo session to "submitted" — the first visitor to finish
  // would otherwise leave every later one staring at the empty state.
  if (DEMO) return res.json({ ok: true, demo: true });
  try {
    const db = await connect();
    const id = req.params.id;
    const r = await db.collection('sessions').updateOne(
      { _id: id, status: 'pending' },
      { $set: { status: 'submitted', finishedAt: new Date().toISOString(), summary: req.body } }
    );
    if (r.matchedCount) return res.json({ ok: true });

    const status = await sessionStatus(db, id);
    if (status === null) return res.status(404).json({ error: 'No such session' });
    if (status === 'submitted') return res.json({ ok: true, already: true });
    res.status(409).json({ error: `That session is "${status}", so it cannot be finished.` });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/audio/:key — one recording from the keyed store (tools/voice/render.js
// session). A session's own lines live here rather than in public/audio, which is
// served to anyone with no key.
//
// The key is a hash of the words and the voice, so a key never changes what it plays
// and the browser may keep it forever. "private" rather than "public": this route
// needs a key, and a shared cache must not hand a clip to someone who has none.
app.get('/api/audio/:key', async (req, res) => {
  try {
    if (!/^[0-9a-f]{14}$/.test(req.params.key)) return res.status(404).json({ error: 'No such clip' });
    const db = await connect();
    const doc = await db.collection('audio').findOne({ _id: req.params.key }, { projection: { bytes: 1 } });
    if (!doc || !doc.bytes) return res.status(404).json({ error: 'No such clip' });
    res.set({ 'Content-Type': 'audio/mp4', 'Cache-Control': 'private, max-age=31536000, immutable' });
    res.send(Buffer.from(doc.bytes.buffer));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

module.exports = app;
