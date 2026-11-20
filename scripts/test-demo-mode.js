// test-demo-mode.js — TUTOR_DEMO=on is the public demo contract: no key needed,
// and nothing ever written. Two things make it worth its own test file.
//
// First, it is the only mode that serves the API to strangers, so a regression
// letting a write through would let anyone edit the data behind a public URL.
//
// Second, and worse: scripts/db.js falls back to "maths-tutor" when MONGODB_DB
// is unset, so a demo deployment with a forgotten or misspelled variable would
// serve a REAL child's sessions, unauthenticated, while looking perfectly
// healthy. The guard against that is one boolean in app.js. This is what keeps
// it honest.
//
//   node scripts/test-demo-mode.js
//
// Its own file because demo mode is read once, when app.js loads: each case
// needs the app re-required under different environment variables.

// Set before anything loads db.js — dotenv never overrides an existing value.
process.env.MONGODB_DB = 'maths-tutor-test';
process.env.TUTOR_ADMIN_KEY = 'test-admin-key-not-a-real-key';
process.env.TUTOR_CHILD_KEY = 'test-child-key-not-a-real-key';

const { close } = require('./db');

let pass = 0, fails = 0;
const failed = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('ok    ' + name); }
  catch (e) { fails++; failed.push(name); console.log('FAIL  ' + name + '\n        ' + e.message); }
}
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    throw new Error(`${what || 'value'}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const truthy = (v, msg) => { if (!v) throw new Error(msg); };

// app.js reads TUTOR_DEMO and MONGODB_DB once, at load. db.js is deliberately
// NOT cleared from the cache: it holds the Mongo connection, and a second copy
// would leak one per case.
function handlerWith(env) {
  Object.assign(process.env, env);
  for (const k of Object.keys(require.cache))
    if (/[\\/](app\.js|api\.js)$/.test(k)) delete require.cache[k];
  return require('../netlify/functions/api').handler;
}

// Every request here is made with NO key at all — that is the point of the mode.
const caller = (handler) => async (method, p, body) => {
  const r = await handler({
    httpMethod: method, path: '/.netlify/functions/api' + p, queryStringParameters: null,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null, isBase64Encoded: false,
  }, {});
  let json = null; try { json = JSON.parse(r.body); } catch (e) {}
  return { status: r.statusCode, json };
};

const WRITES = [
  ['DELETE', '/sessions/demo-5'],
  ['PATCH',  '/curriculum/demo-child'],
  ['PATCH',  '/children/demo-child'],
  ['POST',   '/children/demo-child/topics/t1/reteach'],
];

(async () => {
  /* ── 1. demo mode, pointed at a demo database ─────────────────────────── */
  {
    const call = caller(handlerWith({ TUTOR_DEMO: 'on', MONGODB_DB: 'maths-tutor-test' }));

    await t('an answer is accepted without a key, and never written', async () => {
      const r = await call('POST', '/sessions/demo-5/attempts', { questionId: 'p_1', given: '4', correct: true });
      eq(r.status, 200, 'status');
      eq(r.json && r.json.demo, true, 'flagged as demo');
    });

    // The first visitor to finish would otherwise flip the session to
    // "submitted" and leave every later one on the empty state.
    await t('finishing does not submit the session, so the next visitor still gets it', async () => {
      const r = await call('POST', '/sessions/demo-5/finish', {});
      eq(r.status, 200, 'status');
      eq(r.json && r.json.demo, true, 'flagged as demo');
    });

    await t('deletes and edits are refused, so a stranger cannot alter the demo', async () => {
      for (const [m, p] of WRITES) eq((await call(m, p, {})).status, 403, m + ' ' + p);
    });

    await t('reads are allowed through without a key', async () => {
      for (const p of ['/sessions/next', '/dashboard/me']) {
        const s = (await call('GET', p)).status;
        truthy(s !== 401 && s !== 403 && s !== 503, p + ' was ' + s);
      }
    });
  }

  /* ── 2. demo mode with the database it must never serve ───────────────── */
  // db.js's own connection still points at maths-tutor-test (its cache is kept),
  // so this only exercises the guard — it never reaches a real database.
  {
    const call = caller(handlerWith({ TUTOR_DEMO: 'on', MONGODB_DB: 'maths-tutor' }));
    await t('demo mode refuses to serve the production database name at all', async () => {
      for (const p of ['/sessions/next', '/dashboard/me', '/audio/00151073f71ec6'])
        eq((await call('GET', p)).status, 503, 'GET ' + p);
      eq((await call('POST', '/sessions/demo-5/attempts', {})).status, 503, 'even a write');
    });
  }

  {
    const call = caller(handlerWith({ TUTOR_DEMO: 'on', MONGODB_DB: '' }));
    await t('and refuses when MONGODB_DB is unset, which is how it would be forgotten', async () => {
      eq((await call('GET', '/sessions/next')).status, 503, 'status');
    });
  }

  /* ── 3. with demo mode off, nothing is loosened ───────────────────────── */
  {
    const call = caller(handlerWith({ TUTOR_DEMO: '', MONGODB_DB: 'maths-tutor-test', TUTOR_AUTH: 'on' }));
    await t('with TUTOR_DEMO off a keyless request is still refused', async () => {
      eq((await call('GET', '/sessions/next')).status, 401, 'status');
      eq((await call('DELETE', '/sessions/demo-5')).status, 401, 'delete');
    });
  }

  console.log(fails ? `\n${fails} FAILED: ${failed.join(', ')}` : `\n${pass} passed`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => close());
