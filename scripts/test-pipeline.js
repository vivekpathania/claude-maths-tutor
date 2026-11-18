// test-pipeline.js — regression tests for the places where a mistake silently
// corrupts a child's record: what gets saved, what gets graded, and what the
// server will accept.
//
//   node scripts/test-pipeline.js
//
// Plain node, no framework, same as test-scene.js. Needs MongoDB reachable
// (MONGODB_URI from .env) because most of these are about what ends up IN the
// database — but never YOUR database: everything runs in its own database,
// `maths-tutor-test`, on the same cluster, and drops it when done. It refuses to
// run against any other name. It sets its own fake API keys, so the real ones in
// .env are never read or used.

// Set before anything loads db.js. dotenv never overrides a variable that is already
// set, so these win over whatever is in .env.
process.env.MONGODB_DB = 'maths-tutor-test';
process.env.TUTOR_ADMIN_KEY = 'test-admin-key-not-a-real-key';
process.env.TUTOR_CHILD_KEY = 'test-child-key-not-a-real-key';
process.env.TUTOR_TZ = 'Asia/Kolkata';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { connect, close } = require('./db');
const grading = require('./save-grading.js');

let pass = 0, fails = 0;
const failed = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('ok    ' + name); }
  catch (e) { fails++; failed.push(name); console.log('FAIL  ' + name + '\n        ' + e.message); }
}
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what || 'value'}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const truthy = (v, msg) => { if (!v) throw new Error(msg); };
// save-session also exits 1 for unrelated reasons (an unknown child, a pending
// session), so "it refused" proves nothing — it has to have been refused BY the check.
const blockedByVerify = (r) => {
  eq(r.code, 1, 'exit code');
  truthy(/verify-session\.js blocked/.test(r.out), 'refused, but not by verify-session: ' + r.out.slice(0, 160));
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tutor-test-'));
const write = (name, obj) => { const p = path.join(TMP, name); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); return p; };
// The real scripts, as a child process, exactly as the pipeline runs them.
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8', env: process.env });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

/* ── a small valid session, to break in different ways ───────────────────── */
const goodSession = () => ({
  id: 'test-day1', childId: 'testchild', kind: 'practice', topicId: 't1', topicName: 'Test topic',
  date: '01/11/2026', goal: 'Test goal',
  uiMode: { hintsMax: 2, allowReveal: true, retryPolicy: 'multi', showScore: true },
  stage: { phase: 'practice', practiceLevel: 1 },
  greeting: 'Hi', blurb: 'x',
  warmup: { from: '', items: [] },
  practice: [
    { id: 'p_1', ask: '2 + 2', answer: '4', hints: ['What is two and two?', 'Count on.'], slips: { '5': { code: 'calc_slip', say: 'Close.' } } },
    { id: 'p_2', ask: '3 + 3', answer: '6', hints: ['What is three and three?', 'Count on.'], slips: { '7': { code: 'calc_slip', say: 'Close.' } } },
  ],
  close: { line: 'Done', next: 'More' }, attempts: [],
});
const sceneQuestion = (facts, items) => ({
  id: 'p_3', ask: 'Look at the triangle. How many sides match? Type just the number.', answer: '2',
  hints: ['Look at the tick marks.', 'Count the ticked sides.'], slips: { '3': { code: 'misread', say: 'Check the ticks.' } },
  visual: Object.assign({ type: 'scene', request: 'a triangle', facts }, items ? { items } : {}),
});
const goodFacts = [{ measure: 'sides', of: 'T', equals: [8, 8, 5] }];
const goodItems = [{ m: 'triangle', id: 'T', sides: [8, 8, 5], show: { sides: false, vertices: false } }];

(async () => {
  // These tests are about what ends up in the database, so without one there is
  // nothing to assert. On a fresh clone that is the normal state, not a failure:
  // say so and leave the suite green, rather than greeting a newcomer's first
  // `npm test` with an error that reads like the project is broken.
  if (!process.env.MONGODB_URI) {
    console.log('\nskipped — these tests need a database, and MONGODB_URI is not set.');
    console.log('That is expected on a fresh clone. To run them: see docs/database.md,');
    console.log('then `npm run check`. They use their own throwaway database, never yours.\n');
    return;
  }
  if (process.env.MONGODB_DB !== 'maths-tutor-test') throw new Error('refusing to run against ' + process.env.MONGODB_DB);
  const db = await connect();
  await db.dropDatabase();                       // start clean, in the TEST database only

  try {

  /* ── 1. save-session runs verify-session itself ─────────────────────────── */
  await t('control: the good session passes verify-session', () => {
    const r = run('verify-session.js', write('good.json', goodSession()));
    eq(r.code, 0, 'exit code');
  });
  await t('save-session refuses a slip equal to the correct answer (it would mark a RIGHT answer wrong)', () => {
    const s = goodSession(); s.practice[0].slips = { '4': { code: 'x', say: 'x' } };
    const r = run('save-session.js', write('slip.json', s), '--dry');
    blockedByVerify(r); truthy(/CORRECT answer/.test(r.out), 'should say why: ' + r.out.slice(0, 200));
  });
  await t('--force does not bypass the check (it is for queue conflicts, not wrong keys)', () => {
    const s = goodSession(); s.practice[0].slips = { '4': { code: 'x', say: 'x' } };
    blockedByVerify(run('save-session.js', write('slip2.json', s), '--dry', '--force'));
  });
  await t('save-session refuses a picture that contradicts its own facts', () => {
    const s = goodSession(); s.practice.push(sceneQuestion([{ measure: 'sides', of: 'T', equals: [8, 8, 6] }], goodItems));
    const r = run('save-session.js', write('fact.json', s), '--dry');
    blockedByVerify(r); truthy(/draws/.test(r.out), 'should name the mismatch: ' + r.out.slice(0, 200));
  });
  await t('save-session refuses a picture nobody has drawn', () => {
    const s = goodSession(); s.practice.push(sceneQuestion(goodFacts, null));
    const r = run('save-session.js', write('undrawn.json', s), '--dry');
    blockedByVerify(r); truthy(/not been illustrated/.test(r.out), 'should say it is undrawn: ' + r.out.slice(0, 200));
  });
  await t('control: a correctly drawn picture passes verify-session', () => {
    const s = goodSession(); s.practice.push(sceneQuestion(goodFacts, goodItems));
    eq(run('verify-session.js', write('drawn.json', s)).code, 0, 'exit code');
  });

  /* ── 2. grading: score, mark check, re-grade guard ──────────────────────── */
  await t('countCorrect reads keyed {id, mark} marks and legacy strings alike', () => {
    eq(grading.countCorrect([{ id: 'a', mark: 'correct' }, 'correct', 'wrong', { id: 'b', mark: 'wrong' }, { id: 'c' }]), 2, 'count');
  });
  await t('todayDMY is this machine\'s date in DD/MM/YYYY, not UTC\'s', () => {
    eq(grading.todayDMY(), new Date().toLocaleDateString('en-GB'), 'today');
  });
  await t('a mark with no value is refused (it used to read as "nothing wrong found")', () => {
    const r = run('save-grading.js', write('nomark.json', { sessionId: 's', childId: 'c', topicId: 't', marks: [{ id: 'q1' }] }));
    eq(r.code, 1, 'exit code'); truthy(/found: undefined/.test(r.out), 'should name the bad value: ' + r.out.slice(0, 200));
  });

  await db.collection('children').insertOne({
    _id: 'testchild', name: 'Testchild', age: 10, stage: 'Stage 5', settings: { sessionMinutes: 30 },
    curriculum: { status: 'approved', groups: [{ id: 'g', name: 'Group', order: 1 }],
                  topics: [{ id: 't1', name: 'Test topic', prereqs: [], group: 'g' }], topicQueue: ['t1'] },
  });
  const question = (id) => ({ id, ask: id, answer: '1', hints: [], slips: {} });
  await db.collection('sessions').insertOne({
    _id: 'chk1', childId: 'testchild', topicId: 't1', kind: 'check', status: 'submitted',
    warmup: { from: '', items: [] }, practice: ['q1', 'q2', 'q3', 'q4'].map(question),
    attempts: ['q1', 'q2', 'q3', 'q4'].map((q) => ({ questionId: q, given: '1', correct: q !== 'q4', tries: 1, hintsUsed: 0 })),
    finishedAt: new Date().toISOString(), summary: { msTaken: 60000 },
  });
  const decision = write('decision.json', {
    sessionId: 'chk1', childId: 'testchild', topicId: 't1',
    marks: [{ id: 'q1', mark: 'correct' }, { id: 'q2', mark: 'correct' }, { id: 'q3', mark: 'correct' }, { id: 'q4', mark: 'wrong' }],
    verdict: 'mastered', checkOutcome: 'pass', stage: { phase: 'mastered', practiceLevel: null },
    parentSummary: 'Passed.', diagnosis: [{ q: 'q4', errorType: 'calc_slip' }], feedback: [], brief: null,
  });
  const topic = async () => ((await db.collection('children').findOne({ _id: 'testchild' })).topicStatus || {}).topics.t1;

  await t('grading a check with keyed marks records the real score, not 0', async () => {
    const r = run('save-grading.js', decision);
    eq(r.code, 0, 'exit code — ' + r.out.slice(-300));
    const t1 = await topic();
    eq([t1.checkScore, t1.checkTotal], [3, 4], 'checkScore / checkTotal');
  });
  await t('grading the same session again is refused rather than counted twice', async () => {
    const r = run('save-grading.js', decision);
    eq(r.code, 1, 'exit code'); truthy(/already in topicStatus/.test(r.out), 'should say why: ' + r.out.slice(0, 250));
    const t1 = await topic();
    eq([t1.sessionHistory.length, t1.errorProfile.calc_slip.count], [1, 1], 'history length / calc_slip count');
  });
  await t('--resume finishes the missing writes without counting it twice', async () => {
    const r = run('save-grading.js', decision, '--resume');
    eq(r.code, 0, 'exit code — ' + r.out.slice(-300));
    truthy(/not merged again/.test(r.out), 'should say it skipped the merge');
    const t1 = await topic();
    eq([t1.sessionHistory.length, t1.errorProfile.calc_slip.count, t1.checkAttempts], [1, 1, 0], 'history / calc_slip / checkAttempts');
  });

  /* ── 3. the server: what it will accept, and when ───────────────────────── */
  const { handler } = require('../netlify/functions/api');
  const call = async (method, p, key, body, qs) => {
    const r = await handler({
      httpMethod: method, path: '/.netlify/functions/api' + p, queryStringParameters: qs || null,
      headers: Object.assign({ 'x-tutor-key': key || process.env.TUTOR_ADMIN_KEY }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : null, isBase64Encoded: false,
    }, {});
    let json = null; try { json = JSON.parse(r.body); } catch (e) {}
    return { status: r.statusCode, json, raw: r };
  };
  const CHILD = process.env.TUTOR_CHILD_KEY;
  const open = (id, status) => db.collection('sessions').insertOne({ _id: id, childId: 'testchild', status, warmup: { from: '', items: [] }, practice: [question('p_1')], attempts: [] });
  await open('s-open', 'pending');
  await open('s-graded', 'graded');

  await t('an attempt is stored once, even if the page sends it twice', async () => {
    eq((await call('POST', '/sessions/s-open/attempts', CHILD, { clientId: 'a1', questionId: 'p_1', given: '1', correct: true })).status, 200, 'first');
    const again = await call('POST', '/sessions/s-open/attempts', CHILD, { clientId: 'a1', questionId: 'p_1', given: '1', correct: true });
    eq([again.status, again.json.duplicate], [200, true], 'second send is acknowledged as a duplicate');
    eq((await db.collection('sessions').findOne({ _id: 's-open' })).attempts.length, 1, 'stored attempts');
  });
  await t('a different attempt is stored alongside it', async () => {
    await call('POST', '/sessions/s-open/attempts', CHILD, { clientId: 'a2', questionId: 'p_1', given: '2', correct: false });
    eq((await db.collection('sessions').findOne({ _id: 's-open' })).attempts.map((a) => a.clientId), ['a1', 'a2'], 'order kept');
  });
  await t('finishing marks the session submitted', async () => {
    eq((await call('POST', '/sessions/s-open/finish', CHILD, { total: 1 })).status, 200, 'status code');
    eq((await db.collection('sessions').findOne({ _id: 's-open' })).status, 'submitted', 'status');
  });
  await t('a finish that already landed is acknowledged, so a lost reply can be retried', async () => {
    const r = await call('POST', '/sessions/s-open/finish', CHILD, { total: 1 });
    eq([r.status, r.json.already], [200, true], 'status / already');
  });
  await t('a finished session takes no more answers', async () => {
    eq((await call('POST', '/sessions/s-open/attempts', CHILD, { clientId: 'late', questionId: 'p_1' })).status, 409, 'status');
    eq((await db.collection('sessions').findOne({ _id: 's-open' })).attempts.length, 2, 'attempts unchanged');
  });
  await t('a GRADED session cannot be flipped back to submitted (it would freeze its topic in the Plan tab)', async () => {
    eq((await call('POST', '/sessions/s-graded/finish', CHILD, {})).status, 409, 'finish');
    eq((await call('POST', '/sessions/s-graded/attempts', CHILD, { clientId: 'x' })).status, 409, 'attempts');
    eq((await db.collection('sessions').findOne({ _id: 's-graded' })).status, 'graded', 'still graded');
  });
  await t('an unknown session is a 404, not a silent success', async () => {
    eq((await call('POST', '/sessions/nope/attempts', CHILD, { clientId: 'x' })).status, 404, 'attempts');
    eq((await call('POST', '/sessions/nope/finish', CHILD, {})).status, 404, 'finish');
  });

  /* ── 3b. Ollie's recorded lines: the keyed store and its route ──────────── */
  const { Binary } = require('mongodb');
  const CLIP = '0123456789abcd';
  const BYTES = Buffer.from('not-really-audio, but bytes that must arrive exactly as stored: \u0000\u00ff\u0080');
  await db.collection('audio').insertOne({ _id: CLIP, bytes: new Binary(BYTES), sessionId: 's-audio' });
  await db.collection('sessions').insertOne({ _id: 's-audio', childId: 'testchild', status: 'pending',
    warmup: { from: '', items: [] }, practice: [question('p_1')], attempts: [],
    audio: { voice: 'bm_george', version: 1, clips: [CLIP] } });
  const hdr = (raw, name) => { const k = Object.keys(raw.headers || {}).find((x) => x.toLowerCase() === name); return k ? raw.headers[k] : undefined; };

  await t('a recording reaches the child byte for byte, as audio (base64 through Lambda)', async () => {
    const r = await call('GET', '/audio/' + CLIP, CHILD);
    eq(r.status, 200, 'status');
    truthy(r.raw.isBase64Encoded === true, 'a binary body must be base64-encoded or Lambda corrupts it');
    truthy(Buffer.from(r.raw.body, 'base64').equals(BYTES), 'bytes differ from what was stored');
    eq(hdr(r.raw, 'content-type'), 'audio/mp4', 'content type');
  });
  await t('it is cached by the browser for good, but never by a shared cache (the route needs a key)', async () => {
    const cc = hdr((await call('GET', '/audio/' + CLIP, CHILD)).raw, 'cache-control') || '';
    truthy(/private/.test(cc) && /immutable/.test(cc) && !/public/.test(cc), 'cache-control was: ' + cc);
  });
  await t('no key, or a wrong one, gets no recording', async () => {
    eq((await call('GET', '/audio/' + CLIP, 'nope')).status, 401, 'wrong key');
    const bare = await handler({ httpMethod: 'GET', path: '/.netlify/functions/api/audio/' + CLIP, queryStringParameters: null, headers: {}, body: null, isBase64Encoded: false }, {});
    eq(bare.statusCode, 401, 'no key at all');
  });
  await t('a clip that does not exist is a 404', async () =>
    eq((await call('GET', '/audio/ffffffffffffff', CHILD)).status, 404, 'status'));
  await t('a malformed key is not on the child\'s allowlist, and is a 404 even for the parent', async () => {
    eq((await call('GET', '/audio/not-a-key', CHILD)).status, 401, 'child key');
    eq((await call('GET', '/audio/not-a-key')).status, 404, 'admin key');
  });
  await t('the session hands the page its list of recordings', async () => {
    const r = await call('GET', '/sessions/next', CHILD);
    eq([r.status, r.json.audio && r.json.audio.clips], [200, [CLIP]], 'status / audio.clips');
  });

  /* ── 4. the child's day, and the page not needing a name ────────────────── */
  const istToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const istPrev = new Date(Date.parse(istToday + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  await open('s-next', 'pending');
  // Two sessions on two DIFFERENT days in India — 22:00 yesterday, then 00:30 today —
  // that are the SAME day in UTC (16:30 and 19:00 on yesterday's UTC date). A server
  // that counts days in UTC sees one day and reports a streak of 1; the child did two.
  // (One session alone cannot show it: "today" shifts with it and everything still
  // lines up, which is how a first version of this test passed against the bug.)
  // Earlier tests finished sessions "now"; that would add today and mask the bug. Start clean.
  await db.collection('sessions').updateMany({}, { $unset: { finishedAt: '' } });
  await db.collection('sessions').insertMany([
    { _id: 'done-prev', childId: 'testchild', status: 'graded', finishedAt: new Date(istPrev + 'T22:00:00+05:30').toISOString() },
    { _id: 'done-late', childId: 'testchild', status: 'graded', finishedAt: new Date(istToday + 'T00:30:00+05:30').toISOString() },
  ]);
  await t('"me" resolves to the only child, so the page needs no name or id', async () => {
    const r = await call('GET', '/sessions/next', CHILD);
    eq([r.status, r.json.childName], [200, 'Testchild'], 'status / childName');
  });
  await t('days are the child\'s, not UTC\'s: 22:00 then 00:30 local is a streak of 2', async () => {
    const r = await call('GET', '/sessions/next', CHILD);
    eq(r.json.streak, 2, 'streak');
    eq(r.json.week.find((d) => d.today).state, 'done', 'today\'s state in the week strip');
  });
  await t('the dashboard route accepts "me" too', async () => {
    const r = await call('GET', '/dashboard/me');
    eq([r.status, r.json.child.id], [200, 'testchild'], 'status / child id');
  });
  await t('"Nothing queued" no longer offers a session nobody can open', async () => {
    await db.collection('sessions').updateMany({ status: 'pending' }, { $set: { status: 'graded' } });
    const r = await call('GET', '/sessions/next', CHILD);
    eq([r.json.nothingQueued, 'lastSession' in r.json], [true, false], 'nothingQueued / has lastSession');
  });
  await t('no public file names the child, or carries an id that would', () => {
    // Reads the REAL profiles on this machine rather than a hardcoded name, so a
    // fork is guarded against its own child's name. example.json is skipped: it is
    // the shipped placeholder and "Example" matches ordinary prose.
    const pdir = path.join(ROOT, 'profiles');
    const words = fs.readdirSync(pdir).filter((f) => f.endsWith('.json') && f !== 'example.json')
      .flatMap((f) => {
        const c = JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf8')).child || {};
        return [c.name, c.id].filter((w) => w && String(w).length > 2);
      });
    const pub = path.join(ROOT, 'public');
    const hits = [];
    for (const f of fs.readdirSync(pub).filter((x) => /\.(html|js|css)$/.test(x))) {
      const text = fs.readFileSync(path.join(pub, f), 'utf8');
      const re = (w) => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (words.some((w) => re(w).test(text))) hits.push(f);
    }
    eq(hits, [], 'public files that still contain the child\'s name');
  });

  } finally {
    // Only ever the test database — checked again here, not assumed.
    if (process.env.MONGODB_DB === 'maths-tutor-test') await db.dropDatabase();
    await close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log('\n' + (fails ? fails + ' FAILED, ' : '') + pass + ' passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('\nERROR:', e.message); process.exitCode = 1; close().catch(() => {}); });
