// db.js — MongoDB data layer.
//
// Two real collections:
//   children/{childId}  — profile + curriculum + topicStatus
//   sessions/{sessionId} — session + embedded feedback
//
// Virtual paths (transparent routing, callers use legacy names):
//   curriculum/{id}   → children/{id}.curriculum   ($set / field-read)
//   topicStatus/{id}  → children/{id}.topicStatus  ($set / field-read)
//   feedback/{id}     → sessions/{id}.feedback      ($set / field-read, also sets status="graded")
//   brief/{id}        → children/{id}.brief         ($set / field-read) — the grader
//                        agent's handoff to the teacher/author agent. One at a time,
//                        same as "only one pending session" — overwritten each /grade run.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { MongoClient } = require('mongodb');

const DB_NAME = process.env.MONGODB_DB || 'maths-tutor';
let _client, _db, _opening;

// Cache the in-flight PROMISE, not just the finished handle. A CLI script makes
// one call at a time so it never mattered locally, but a cold serverless
// container handling two requests at once would otherwise see `_db` unset twice
// and open two MongoClients, leaking the first. See docs/deploy.md.
function connect() {
  if (_db) return Promise.resolve(_db);
  if (!_opening) {
    _opening = open().catch((e) => {
      _opening = undefined; // let the next request retry rather than cache the failure
      throw e;
    });
  }
  return _opening;
}

async function open() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set — copy .env.example → .env and fill it in.');
  }
  _client = new MongoClient(uri);
  await _client.connect();
  _db = _client.db(DB_NAME);
  // Indexes for common session queries. Deliberately NOT awaited: it is
  // idempotent and only matters from the second query onward, so making the
  // first request of a cold container wait on a round trip buys nothing. If it
  // fails (e.g. a read-only user) the queries still work, just unindexed.
  _db.collection('sessions')
    .createIndex({ childId: 1, status: 1 })
    .catch((e) => console.error('createIndex(sessions) failed:', e.message));
  return _db;
}

// Maps a virtual collection name → { real collection, embedded field }
const VIRTUAL = {
  curriculum:  { col: 'children', field: 'curriculum'  },
  topicStatus: { col: 'children', field: 'topicStatus' },
  feedback:    { col: 'sessions', field: 'feedback'    },
  brief:       { col: 'children', field: 'brief'       },
  teachingProfile: { col: 'children', field: 'teachingProfile' },
};

// Strip _id → id for callers
function docOut(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: String(_id), ...rest };
}

async function listSessions() {
  const db = await connect();
  const docs = await db.collection('sessions').find({}).toArray();
  return docs.map(docOut);
}

// path = "collection/docId"
async function getDoc(path) {
  const [col, id] = path.split('/');
  const virt = VIRTUAL[col];
  const db = await connect();
  if (virt) {
    const doc = await db.collection(virt.col).findOne({ _id: id });
    return doc ? (doc[virt.field] || null) : null;
  }
  return docOut(await db.collection(col).findOne({ _id: id }));
}

// path = "collection/docId", obj = plain JS object
async function setDoc(path, obj) {
  const [col, id] = path.split('/');
  const virt = VIRTUAL[col];
  const db = await connect();

  if (virt) {
    const update = { $set: { [virt.field]: obj } };
    if (col === 'feedback') update.$set.status = 'graded';
    await db.collection(virt.col).updateOne({ _id: id }, update, { upsert: true });
    return;
  }

  const { id: _a, _id: _b, ...rest } = obj;
  await db.collection(col).replaceOne({ _id: id }, { _id: id, ...rest }, { upsert: true });
}

// CLI scripts must call this, or the open MongoClient keeps the event loop
// alive and the process never exits. The server never calls it.
async function close() {
  if (_client) {
    await _client.close();
    _client = undefined;
    _db = undefined;
    _opening = undefined;
  }
}

async function assertReachable() {
  try {
    await connect();
  } catch (e) {
    console.error('\n✗ Could not connect to MongoDB.\n  Check MONGODB_URI in .env.\n  Detail:', e.message, '\n');
    process.exit(1);
  }
}

module.exports = { listSessions, getDoc, setDoc, assertReachable, connect, close };
