// scene-facts.js — what is drawn in each scene of a session, and does it match
// the facts the author stated?
//
//   node scripts/scene-facts.js <session.json>            every scene, checked
//   node scripts/scene-facts.js <session.json> --pending  only bare requests, as JSON
//
// For the illustrator agent, which cannot see the picture it draws: it reads
// the plain-words description of what it actually produced, and the same
// errors verify-session.js would block on, without running the whole checker.
// Reads the file only — touches no database.

const fs = require('fs');
const SceneLib = require('../public/scene.js');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const pendingOnly = args.includes('--pending');

if (!file) { console.error('Usage: node scripts/scene-facts.js <session.json> [--pending]'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }

let session;
try { session = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error('Could not parse JSON: ' + e.message); process.exit(1); }

const scenes = SceneLib.walkScenes(session);
const bare = (s) => !Array.isArray(s.visual.items) || !s.visual.items.length;

if (pendingOnly) {
  // Everything the illustrator needs to draw each one: what the author asked
  // for, the facts that must hold, and the question or step it sits in.
  const todo = scenes.filter(bare).map((s) => ({
    path: s.path,
    request: s.visual.request || null,
    facts: s.visual.facts || [],
    caption: s.visual.caption || null,
    context: { ask: s.ask || null, big: s.big || null, answer: s.answer == null ? null : s.answer },
  }));
  console.log(JSON.stringify(todo, null, 2));
  process.exit(0);
}

if (!scenes.length) { console.log('No scenes in this session.'); process.exit(0); }

let bad = 0;
scenes.forEach((s) => {
  // A teach step's headline is a claim the picture must support; a question's
  // ask is only a prompt (same rule as verify-session.js).
  const claim = s.big && /steps\[\d+\]\.visual$/.test(s.path) ? s.big : null;
  const r = SceneLib.checkScene(s.visual, { claim });
  const leak = !r.errors.length && s.ask != null && /\.visual$/.test(s.path) && !/steps\[/.test(s.path)
    ? SceneLib.checkLeak(s.visual, s.answer) : [];
  if (r.errors.length) bad++;
  console.log(`${r.errors.length ? (r.unresolved ? '..  ' : 'FAIL') : 'ok  '}  ${s.path}`);
  if (r.unresolved) {
    console.log(`        not drawn yet — request: ${s.visual.request}`);
  } else if (!r.errors.length) {
    SceneLib.describe(s.visual).split('\n').forEach((l) => console.log('        ' + l));
  }
  r.errors.forEach((m) => console.log('        ✗ ' + m));
  // Warnings do not block, but each is a weaker picture than it looks — the
  // illustrator should treat them as defects to fix, not notes.
  r.warnings.concat(leak).forEach((m) => console.log('        ! ' + m));
});

console.log(`\n${scenes.length} scene(s), ${bad} with problems, ${scenes.filter(bare).length} still bare requests.`);
process.exitCode = bad ? 1 : 0;
