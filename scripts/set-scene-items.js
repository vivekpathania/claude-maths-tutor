// set-scene-items.js — put a drawing into one scene of a session, and change
// nothing else.
//
//   node scripts/set-scene-items.js <session.json> <path> <items.json>
//
//   <path>        where the scene lives, as printed by scene-facts.js, e.g.
//                 teach.cycles[0].q.visual  or  practice[2].visual
//   <items.json>  a JSON array of macros / atoms (see docs/visuals.md)
//
// This is the illustrator agent's only way to write. It sets `items` and leaves
// `request`, `facts`, `caption`, and everything around the scene (the question,
// its answer, its hints) exactly as the teacher or author wrote them — so a
// check that will not pass can never be "fixed" by quietly editing the maths.
// Reads and writes the one file; touches no database.

const fs = require('fs');

const [file, path, itemsFile] = process.argv.slice(2);
if (!file || !path || !itemsFile) {
  console.error('Usage: node scripts/set-scene-items.js <session.json> <path> <items.json>');
  process.exit(1);
}
for (const f of [file, itemsFile])
  if (!fs.existsSync(f)) { console.error('File not found: ' + f); process.exit(1); }

let session, items;
try { session = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error('Could not parse ' + file + ': ' + e.message); process.exit(1); }
try { items = JSON.parse(fs.readFileSync(itemsFile, 'utf8')); }
catch (e) { console.error('Could not parse ' + itemsFile + ': ' + e.message); process.exit(1); }
if (!Array.isArray(items) || !items.length) {
  console.error('items must be a non-empty JSON array of macros / atoms.');
  process.exit(1);
}

// "teach.cycles[0].q.visual" → ["teach", "cycles", "0", "q", "visual"]
const steps = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
let node = session;
for (const s of steps) {
  if (node == null || typeof node !== 'object' || !(s in node)) {
    console.error('Nothing at "' + path + '" (stopped at "' + s + '"). Use a path from scene-facts.js.');
    process.exit(1);
  }
  node = node[s];
}
if (!node || node.type !== 'scene') {
  console.error('"' + path + '" is not a scene (type: "scene").');
  process.exit(1);
}

node.items = items;
fs.writeFileSync(file, JSON.stringify(session, null, 2));
console.log('✓ ' + path + ' — ' + items.length + ' item(s) set. Nothing else was changed.');
