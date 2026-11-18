// save-curriculum.js — validate and save an APPROVED child profile + curriculum.
//
//   node scripts/save-curriculum.js profiles/<childId>.json [--dry] [--force]
//
//   --dry    validate only, no network, no writes
//   --force  overwrite an existing, already-saved curriculum
//
// Writes two docs:
//   children/{childId}    = profile + settings (age, stage, board, session length...)
//   curriculum/{childId}  = approved topic list with prerequisites and sources
//
// Run on your real Mac (Claude sandboxes can't reach Firestore).

const fs = require("fs");
const path = require("path");
const { SESSION_MINUTES } = require("./session-minutes");

function fail(msg) { console.error("✗ " + msg); process.exit(1); }

// Soft problems: worth a human look, not worth blocking a save over.
const warnings = [];
function warn(msg) { warnings.push(msg); }

function validate(p) {
  const c = p.child, s = p.settings, t = p.topics, src = p.research, g = p.groups;
  if (!c || !c.id || !/^[a-z0-9-]+$/.test(c.id)) fail("child.id required (lowercase letters, digits, dashes).");
  for (const k of ["name", "board", "stage"]) if (!c[k]) fail(`child.${k} is required.`);
  if (typeof c.age !== "number") fail("child.age must be a number.");

  if (!s) fail("settings block is required.");
  for (const k of ["sessionMinutes", "questionsPerSession", "diagnosticSittings"])
    if (typeof s[k] !== "number" || s[k] <= 0) fail(`settings.${k} must be a positive number.`);
  // The parent picks from four options, not a free number — it is the ceiling
  // a session may run to, and the dashboard's picker offers exactly these.
  if (!SESSION_MINUTES.includes(s.sessionMinutes))
    fail(`settings.sessionMinutes must be one of ${SESSION_MINUTES.join(", ")} (got ${s.sessionMinutes}).`);
  // Only the STARTING count, for a child with no history. From there the
  // grader sets each session's size itself (brief.questionCount), growing it
  // as stamina allows — see CLAUDE.md "Session size".
  if (!Number.isInteger(s.questionsPerSession))
    fail("settings.questionsPerSession must be a whole number (the starting count; the grader grows it from there).");
  if (!s.reason) fail("settings.reason is required (one line on why these values).");

  if (!src || !src.status) fail("research.status is required: 'verified' or 'model-knowledge'.");
  if (!["verified", "model-knowledge"].includes(src.status)) fail("research.status must be 'verified' or 'model-knowledge'.");
  if (src.status === "verified" && !src.sourceUrl) fail("verified research needs research.sourceUrl.");
  if (!src.retrievedOn) fail("research.retrievedOn (YYYY-MM-DD) is required.");

  // Groups: the teaching family a topic belongs to. `strand` alone is too
  // coarse to be useful (a primary stage puts ~30 of 40 topics under
  // "Number"), so the dashboard groups by this instead.
  if (!Array.isArray(g) || g.length === 0)
    fail("groups must be a non-empty array. Older profiles predate groups — regenerate with the `curriculum` agent.");
  const gids = new Set();
  g.forEach((x, i) => {
    if (!x.id || !x.name || !x.strand) fail(`groups[${i}] needs id, name, strand.`);
    if (gids.has(x.id)) fail(`duplicate group id: ${x.id}`);
    gids.add(x.id);
    if (typeof x.order !== "number") fail(`group ${x.id}: order must be a number.`);
  });

  if (!Array.isArray(t) || t.length === 0) fail("topics must be a non-empty array.");
  const ids = new Set();
  t.forEach((x, i) => {
    if (!x.id || !x.name || !x.strand) fail(`topics[${i}] needs id, name, strand.`);
    if (ids.has(x.id)) fail(`duplicate topic id: ${x.id}`);
    ids.add(x.id);
    if (!x.group) fail(`topic ${x.id}: group is required.`);
    if (!gids.has(x.group)) fail(`topic ${x.id}: group '${x.group}' is not in groups[].`);
    if (!Array.isArray(x.prereqs)) fail(`topic ${x.id}: prereqs must be an array (can be empty).`);
    if (typeof x.order !== "number") fail(`topic ${x.id}: order must be a number.`);
  });

  const sizes = {};
  t.forEach((x) => { sizes[x.group] = (sizes[x.group] || 0) + 1; });
  g.forEach((x) => { if (!sizes[x.id]) fail(`group ${x.id} has no topics.`); });
  Object.entries(sizes).forEach(([id, n]) => {
    if (n > 10) warn(`group '${id}' holds ${n} topics — large enough that it may not read as one family.`);
  });
  t.forEach((x) => x.prereqs.forEach((q) => {
    if (!ids.has(q)) fail(`topic ${x.id}: prerequisite '${q}' is not in the list.`);
    if (q === x.id) fail(`topic ${x.id} lists itself as a prerequisite.`);
  }));
  // order must respect prerequisites, which also rules out cycles
  const ord = Object.fromEntries(t.map((x) => [x.id, x.order]));
  t.forEach((x) => x.prereqs.forEach((q) => {
    if (ord[q] >= x.order) fail(`topic ${x.id} (order ${x.order}) comes before its prerequisite ${q} (order ${ord[q]}).`);
  }));

  // A dependency graph where nearly every topic has exactly one parent is
  // usually not a graph at all — it is each topic chained to the one before
  // it. That makes the "what must come first" chain a straight line back to
  // topic 1, which tells a parent nothing. Real maths dependencies branch.
  const linked = t.filter((x) => x.prereqs.length > 0);
  const single = linked.filter((x) => x.prereqs.length === 1);
  if (linked.length >= 10 && single.length / linked.length > 0.85)
    warn(`${single.length} of ${linked.length} linked topics have exactly one prerequisite — check these are real dependencies, not just "taught next".`);

  // A topic whose only prerequisite is the topic immediately before it is the
  // signature of that same mistake.
  const byOrder = [...t].sort((a, b) => a.order - b.order);
  const prevOf = {};
  byOrder.forEach((x, i) => { if (i) prevOf[x.id] = byOrder[i - 1].id; });
  const chained = t.filter((x) => x.prereqs.length === 1 && x.prereqs[0] === prevOf[x.id]);
  if (chained.length > 3)
    warn(`${chained.length} topics list only the immediately preceding topic as their prerequisite (${chained.slice(0, 4).map((x) => x.id).join(", ")}${chained.length > 4 ? ", …" : ""}).`);
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry"), force = args.includes("--force");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) fail("Usage: node scripts/save-curriculum.js profiles/<childId>.json [--dry] [--force]");
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail(`File not found: ${full}`);
  let p;
  try { p = JSON.parse(fs.readFileSync(full, "utf8")); }
  catch (e) { fail(`Could not parse JSON: ${e.message}`); }

  validate(p);
  const n = p.topics.length;
  console.log(`✓ valid: ${p.child.name}, ${p.child.board} ${p.child.stage}, ${n} topics in ${p.groups.length} groups, research ${p.research.status}`);
  if (warnings.length) {
    console.log(`\nWORTH A LOOK (${warnings.length}) — not blocking:`);
    warnings.forEach((w) => console.log("  ! " + w));
    console.log("");
  }
  if (dry) { console.log("• --dry: nothing written."); return; }

  const { getDoc, setDoc, assertReachable } = require("./db");
  await assertReachable();
  const existing = await getDoc(`curriculum/${p.child.id}`);
  if (existing && !force) fail(`curriculum/${p.child.id} already exists. Re-run with --force to replace it.`);

  const groups = p.groups
    .map((x) => ({ id: x.id, name: x.name, strand: x.strand, order: x.order }))
    .sort((a, b) => a.order - b.order);

  const topics = p.topics.map((x) => ({
    id: x.id, name: x.name, strand: x.strand, group: x.group, order: x.order,
    prereqs: x.prereqs, description: x.description || "", sourceUrl: x.sourceUrl || "",
    // Drives placement-vs-teach in the topic table (CLAUDE.md "Topic queue").
    schoolCovered: x.schoolCovered === true,
  }));

  // The teaching queue the parent reorders in the dashboard. Defaults to
  // curriculum order; /grade and /next-session walk this, not topics[].
  const topicQueue = Array.isArray(p.topicQueue) && p.topicQueue.length
    ? p.topicQueue
    : [...topics].sort((a, b) => a.order - b.order).map((x) => x.id);

  const unknown = topicQueue.filter((id) => !topics.some((t) => t.id === id));
  if (unknown.length) fail(`topicQueue has unknown topic ids: ${unknown.join(", ")}`);

  // Preserve any existing progress — this is a full replace of children/{id}.
  const prevChild = (await getDoc(`children/${p.child.id}`)) || {};
  await setDoc(`children/${p.child.id}`, {
    ...p.child, settings: p.settings, schoolFocus: p.schoolFocus || "",
    ...(prevChild.topicStatus ? { topicStatus: prevChild.topicStatus } : {}),
  });
  console.log(`✓ children/${p.child.id}`);
  await setDoc(`curriculum/${p.child.id}`, {
    childId: p.child.id, status: "approved", research: p.research, groups, topics, topicQueue,
    approvedOn: new Date().toLocaleDateString("en-CA"),   // this machine's day, not UTC's
  });
  console.log(`✓ curriculum/${p.child.id} (${n} topics, ${groups.length} groups)`);
  console.log(`\nSaved. This does not change ${p.child.name}'s daily sessions yet.`);
}

main()
  .catch((e) => { console.error("✗ save-curriculum failed:", e.message); process.exitCode = 1; })
  // Required lazily so --dry never loads the db module at all.
  .finally(() => require("./db").close());
