// render.js — turn Coach Ollie's lines into recordings. Runs on the parent's Mac.
//
//   node render.js bank                      the bank → public/audio/bank/ (open, static)
//   node render.js session <session.json>    one session's own lines → the keyed store (Mongo)
//   node render.js bank|session … --dry      say what it would do, render nothing
//   node render.js bank --voice bm_lewis     try another voice (changes every key)
//
// See docs/voice.md. Idempotent: a clip that already exists is not made again, so
// editing one line renders one clip. The voice is in config.json — "provisional"
// until a person has listened and chosen.
//
// TWO PLACES, ON PURPOSE.
//   bank     public/audio/bank/<key>.m4a + manifest.json. Served to anyone, no key.
//            Only generic lines (no child's name) belong here, so a bank line that
//            contains "{name}" is skipped — a recording of the child's name does not
//            belong on an open CDN.
//   session  Mongo `audio` collection, served by GET /api/audio/:key (child key
//            required). A session's own lines — narration, hints, slip explanations,
//            the reveal — and anything personal. Only the PENDING session's clips are
//            kept: rendering one deletes the clips of every other session.
// The page finds both the same way: from the words it is about to show.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const Speech = require(path.join(ROOT, 'public', 'speech.js'));
const { BANK } = require(path.join(ROOT, 'public', 'ollie-lines.js'));
const AUDIO = path.join(ROOT, 'public', 'audio');
const BANK_DIR = path.join(AUDIO, 'bank');
const MANIFEST = path.join(AUDIO, 'manifest.json');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--voice');
const mode = positional[0];
const dry = args.includes('--dry');
const vi = args.indexOf('--voice');
const voice = vi >= 0 ? args[vi + 1] : config.voice;
const SPEECH_CPS = 14;          // spoken characters per second, for the estimate
const RENDER_SPEED = 2.0;       // measured: 1 s of speech takes 0.5 s to make

if (mode !== 'bank' && mode !== 'session') {
  console.error('Usage: node render.js bank [--dry] [--voice <id>]\n       node render.js session <session.json> [--dry] [--voice <id>]');
  process.exit(1);
}

// distinct speakable lines → clip key, refusing a hash collision (which would play the
// WRONG line to a child) instead of trusting that it cannot happen
function keyed(texts) {
  const clips = new Map();
  for (const text of texts) {
    const key = Speech.clipKey(text, voice);
    if (!key) continue;
    const spoken = Speech.speakable(text);
    if (clips.has(key) && clips.get(key) !== spoken)
      throw new Error(`clip key collision on ${key}: "${clips.get(key)}" vs "${spoken}"`);
    clips.set(key, spoken);
  }
  return clips;
}

function collectBank() {
  const texts = [], personal = new Set();
  for (const moments of Object.values(BANK))
    for (const lines of Object.values(moments))
      for (const line of lines) (/\{[a-zA-Z]+\}/.test(line) ? personal.add(line) : texts.push(line));
  return { clips: keyed(texts), personal: [...personal] };
}

// One model load serves every clip in a run. Yields { render(text) → Buffer of AAC }.
async function loadRenderer(tmpBase) {
  console.log('Loading the model…');
  const { KokoroTTS } = await import('kokoro-js');
  const tts = await KokoroTTS.from_pretrained(config.model, { dtype: config.dtype, device: 'cpu' });
  if (!Object.keys(tts.voices || {}).includes(voice)) throw new Error(`voice "${voice}" is not in this model`);
  return {
    async render(text) {
      const wav = tmpBase + '.wav', m4a = tmpBase + '.m4a';
      try {
        const audio = await tts.generate(text, { voice });
        await audio.save(wav);
        // AAC, 48 kbps, mono: plays on every iPad, ~30 KB a line
        execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', wav, m4a], { stdio: 'pipe' });
        return fs.readFileSync(m4a);
      } finally {
        for (const f of [wav, m4a]) { try { fs.unlinkSync(f); } catch (e) { /* already gone */ } }
      }
    },
  };
}

function progress(i, n, t0) {
  if ((i + 1) % 10 === 0 || i + 1 === n) {
    const sec = (Date.now() - t0) / 1000;
    console.log(`  ${i + 1}/${n} · ${sec.toFixed(0)} s elapsed · ~${Math.round(sec / (i + 1) * (n - i - 1))} s left`);
  }
}
const voiceNote = () => `voice ${voice}${config.provisional && vi < 0 ? ' (PROVISIONAL — not yet chosen by a listener)' : ''}`;

/* ── bank ─────────────────────────────────────────────────────────────────── */

const haveFile = (key) => { try { return fs.statSync(path.join(BANK_DIR, key + '.m4a')).size > 0; } catch (e) { return false; } };
const onDisk = () => (fs.existsSync(BANK_DIR) ? fs.readdirSync(BANK_DIR).filter((f) => f.endsWith('.m4a')).map((f) => f.slice(0, -4)) : []);

async function bankMode() {
  const { clips, personal } = collectBank();
  const todo = [...clips.keys()].filter((k) => !haveFile(k));
  const orphans = onDisk().filter((k) => !clips.has(k));
  const chars = todo.reduce((n, k) => n + clips.get(k).length, 0);

  console.log(voiceNote());
  console.log(`  ${clips.size} distinct lines to voice · ${clips.size - todo.length} already rendered · ${todo.length} to render · ${orphans.length} orphan(s) to delete`);
  console.log(`  ${personal.length} name-bearing line(s) skipped — personal, so not for the open CDN`);
  if (todo.length) console.log(`  about ${Math.round(chars / SPEECH_CPS / RENDER_SPEED)} s of rendering`);
  if (dry) return;

  fs.mkdirSync(BANK_DIR, { recursive: true });
  const failed = [];
  if (todo.length) {
    const r = await loadRenderer(path.join(BANK_DIR, '.tmp'));
    const t0 = Date.now();
    for (let i = 0; i < todo.length; i++) {
      const key = todo[i];
      try { fs.writeFileSync(path.join(BANK_DIR, key + '.m4a'), await r.render(clips.get(key))); }
      catch (e) { failed.push(`${key} "${clips.get(key)}": ${e.message}`); }
      progress(i, todo.length, t0);
    }
  }
  for (const k of orphans) fs.unlinkSync(path.join(BANK_DIR, k + '.m4a'));
  if (orphans.length) console.log(`  deleted ${orphans.length} orphaned clip(s)`);

  // The manifest lists only clips that really exist, so the page never offers a
  // Listen button that plays nothing.
  const have = {};
  for (const k of [...clips.keys()].sort()) if (haveFile(k)) have[k] = clips.get(k);
  const manifest = { voice, version: Speech.VERSION, model: config.model, provisional: !!config.provisional && vi < 0, clips: have };
  fs.writeFileSync(MANIFEST + '.tmp', JSON.stringify(manifest, null, 1));
  fs.renameSync(MANIFEST + '.tmp', MANIFEST);

  const bytes = Object.keys(have).reduce((n, k) => n + fs.statSync(path.join(BANK_DIR, k + '.m4a')).size, 0);
  console.log(`\nManifest written: ${Object.keys(have).length} clips, ${(bytes / 1048576).toFixed(1)} MB`);
  if (failed.length) { console.error(`\n${failed.length} FAILED:\n  ` + failed.join('\n  ')); process.exitCode = 1; }
}

/* ── session ──────────────────────────────────────────────────────────────── */

async function sessionMode() {
  const file = positional[1];
  if (!file) throw new Error('give a session file: node render.js session <session.json>');
  const s = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!s.id) throw new Error('the session has no id');
  const { sessionLines } = require('./lines.js');
  const texts = sessionLines(s).map((l) => l.text);

  // the bank and a session's own clips are looked up by different voices if they were
  // rendered at different times — say so rather than let half the lines change voice
  try {
    const bank = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    if (bank.voice !== voice) console.warn(`⚠ the bank is rendered in ${bank.voice} but this session is in ${voice} — Ollie would change voice between them. Re-render the bank too.`);
  } catch (e) { /* no bank yet */ }

  const { connect, close } = require('../../scripts/db');
  const { Binary } = require('mongodb');
  const db = await connect();
  try {
    // The bank skips every line with the child's name in it (it is served openly), so those
    // are recorded here, per child, with the first name filled in the way the page does.
    const child = s.childId ? await db.collection('children').findOne({ _id: s.childId }, { projection: { name: 1 } }) : null;
    const first = child && child.name ? String(child.name).trim().split(/\s+/)[0] : '';
    const personal = first ? collectBank().personal.map((l) => l.replace(/\{name\}/g, first)) : [];
    if (!first) console.warn('⚠ no child name found — lines that use the name get no recording.');
    const clips = keyed(texts.concat(personal));
    const audio = db.collection('audio');
    const keys = [...clips.keys()];
    const have = new Set((await audio.find({ _id: { $in: keys } }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    const todo = keys.filter((k) => !have.has(k));
    const chars = todo.reduce((n, k) => n + clips.get(k).length, 0);
    console.log(`${voiceNote()}\n  session ${s.id} (${db.databaseName})`);
    console.log(`  ${keys.length} distinct lines · ${keys.length - todo.length} already stored · ${todo.length} to render` +
                (todo.length ? ` · about ${Math.round(chars / SPEECH_CPS / RENDER_SPEED)} s` : ''));
    if (dry) return;

    const failed = [];
    if (todo.length) {
      const r = await loadRenderer(path.join(__dirname, '.tmp-session'));
      const t0 = Date.now();
      for (let i = 0; i < todo.length; i++) {
        const key = todo[i];
        try {
          const buf = await r.render(clips.get(key));
          await audio.insertOne({ _id: key, bytes: new Binary(buf), text: clips.get(key), voice, sessionId: s.id, createdAt: new Date().toISOString() });
        } catch (e) { failed.push(`${key} "${clips.get(key)}": ${e.message}`); }
        progress(i, todo.length, t0);
      }
    }

    // Only the pending session's clips are kept, so storage stays flat: claim every
    // clip this session uses (including ones shared with an older session), then drop
    // whatever is left that belongs to anyone else.
    const stored = new Set((await audio.find({ _id: { $in: keys } }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    await audio.updateMany({ _id: { $in: [...stored] } }, { $set: { sessionId: s.id } });
    const gone = await audio.deleteMany({ sessionId: { $ne: s.id } });
    if (gone.deletedCount) console.log(`  removed ${gone.deletedCount} clip(s) belonging to other sessions`);

    // Link only what really exists, so the page never offers a button that plays nothing.
    const linked = [...stored].sort();
    const upd = await db.collection('sessions').updateOne({ _id: s.id }, { $set: { audio: { voice, version: Speech.VERSION, clips: linked } } });
    if (!upd.matchedCount) console.warn(`⚠ sessions/${s.id} is not in the database yet — clips are stored but not linked. Save the session first.`);
    console.log(`\n${linked.length} clip(s) linked to ${s.id}`);
    if (failed.length) { console.error(`\n${failed.length} FAILED:\n  ` + failed.join('\n  ')); process.exitCode = 1; }
  } finally {
    await close();
  }
}

(mode === 'bank' ? bankMode() : sessionMode())
  .catch((e) => { console.error('\nrender failed:', e.message); process.exitCode = 1; });
