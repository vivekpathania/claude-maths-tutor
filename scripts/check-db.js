#!/usr/bin/env node
// check-db.js — "is my database connected?", answered in plain English.
//
// This is the first command a new parent runs, and the one place they are most
// likely to get stuck: a Mongo connection string has four separate ways to be
// wrong and the driver reports three of them as the same DNS error. So every
// failure here is translated into what to go and fix, not what the driver said.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');

const DB_NAME = process.env.MONGODB_DB || 'maths-tutor';
const uri = process.env.MONGODB_URI;

// Each entry: does this error match, and what should they actually do about it.
// `m` is the driver's message, lowercased.
const DIAGNOSES = [
  {
    when: (m) => m.includes('invalid scheme'),
    title: 'That is not a connection string.',
    body: [
      'MONGODB_URI must start with "mongodb+srv://" (Atlas) or "mongodb://" (a',
      'database on your own machine). It looks like a web address was pasted',
      'instead — the Atlas page you are on, rather than the string from its',
      '"Connect" button.',
    ],
  },
  {
    when: (m) => m.includes('enotfound') || m.includes('querysrv'),
    title: 'The server in your connection string could not be found.',
    body: [
      'One of three things, in order of likelihood:',
      '',
      '  1. A placeholder is still in there. If MONGODB_URI contains "<" or ">"',
      '     anywhere, that is the problem — Atlas gives you the string with',
      '     <db_password> in it and expects you to replace it, angle brackets',
      '     and all.',
      '  2. Your password contains @ : / ? # or %. Those end the password as far',
      '     as the connection string is concerned, so the rest of it gets read as',
      '     a server name. The giveaway is an error naming a "server" that is',
      '     really a piece of your password. Easiest fix: change the database',
      '     user\'s password in Atlas to letters and numbers only.',
      '  3. A typo in the cluster name, or the cluster was deleted.',
    ],
  },
  {
    when: (m) => m.includes('bad auth') || m.includes('authentication failed'),
    title: 'The server was reached, but the username or password was refused.',
    body: [
      'The address is right, so this is only about the credentials.',
      '',
      '  - These are the DATABASE user you created inside Atlas, not the email',
      '    and password you log in to Atlas with. They are different accounts and',
      '    confusing the two is the usual cause.',
      '  - Check it under "Database Access" in Atlas. You can reset that user\'s',
      '    password there and paste the new one in.',
    ],
  },
  {
    when: (m) => m.includes('server selection') || m.includes('timed out') || m.includes('econnrefused'),
    title: 'Nothing answered. The connection was not refused — it was ignored.',
    body: [
      'That pattern almost always means your computer is not on the database\'s',
      'guest list, rather than anything being broken:',
      '',
      '  - In Atlas, open "Network Access" and add your current IP address.',
      '    Atlas offers a button for it. Note that a home IP usually changes, so',
      '    a rule that worked last month can stop working.',
      '  - If you are running MongoDB on your own machine instead, it is not',
      '    started.',
      '',
      'See docs/database.md for the deployment case, where there is no fixed IP',
      'to add.',
    ],
  },
];

function explain(err) {
  const m = String(err && err.message || '').toLowerCase();
  const hit = DIAGNOSES.find((d) => d.when(m));
  console.error('\n✗ Could not connect.\n');
  if (hit) {
    console.error(hit.title);
    console.error('');
    hit.body.forEach((l) => console.error(l));
  } else {
    console.error('The database driver reported something this script does not');
    console.error('have a plain-English translation for:');
    console.error('');
    console.error('  ' + String(err && err.message || err));
    console.error('');
    console.error('docs/database.md walks through the whole setup from scratch.');
  }
  console.error('\nThe driver\'s own words, in case you are searching for them:');
  console.error('  ' + String(err && err.message || err).split('\n')[0]);
  console.error('');
}

async function main() {
  if (!uri) {
    console.error('\n✗ MONGODB_URI is not set.\n');
    console.error('The app does not know where your database is. To fix it:');
    console.error('');
    console.error('  cp .env.example .env     then open .env and fill in MONGODB_URI');
    console.error('');
    console.error('docs/database.md walks through getting that value, free, from');
    console.error('scratch. It takes about ten minutes and needs no card.\n');
    process.exitCode = 1;
    return;
  }

  // Report the address WITHOUT the password: this output gets pasted into
  // issues and chats, and the password is the only real credential there is.
  const safe = uri.replace(/\/\/([^:/@]+):([^@]*)@/, '//$1:********@');
  console.log('\nConnecting to: ' + safe);
  console.log('Database name: ' + DB_NAME + (process.env.MONGODB_DB ? '' : '   (the default)'));

  let client;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const db = client.db(DB_NAME);
    await db.command({ ping: 1 });

    const children = await db.collection('children').countDocuments();
    const sessions = await db.collection('sessions').countDocuments();

    console.log('\n✓ Connected, and the database answered.\n');
    console.log('  children: ' + children);
    console.log('  sessions: ' + sessions);

    if (!children) {
      console.log('\nNo child set up yet. Either:');
      console.log('  /setup-child                      in Claude Code, for a real child, or');
      console.log('  node scripts/seed-demo.js --force to look around with invented data.');
    }

    // Writing is not optional for this app: every session, mark and feedback is
    // a write. A read-only database user connects perfectly and then fails on
    // the first /grade, which is a much worse place to find out.
    try {
      const probe = db.collection('_writecheck');
      const r = await probe.insertOne({ at: new Date() });
      await probe.deleteOne({ _id: r.insertedId });
      console.log('\n✓ This user can write, which the app needs.');
    } catch (e) {
      console.log('\n! Connected, but this user cannot write: ' + e.message.split('\n')[0]);
      console.log('  Give the database user "Read and write to any database" in');
      console.log('  Atlas under Database Access. Grading cannot save without it.');
      process.exitCode = 1;
    }
    console.log('');
  } catch (err) {
    explain(err);
    process.exitCode = 1;
  } finally {
    if (client) await client.close().catch(() => {});
  }
}

main();
