// save-grading.js — commit the grader agent's decision for one session.
//
//   node save-grading.js <grading-decision.json>
//
// Reads the grader agent's output (see grading/example.json) and does four
// writes, in order:
//   1. sessions/{sessionId}   — marks[] applied (full replace, must come first)
//   2. feedback/{sessionId}   — feedback items embedded; status → "graded"
//   3. topicStatus/{childId}  — the topic's verdict/stage/history/errorProfile merged
//   4. brief/{childId}        — the session brief for the next session, or null
//
// This script does NOT write the next session's question content — that is
// built separately by the teacher/author agent from the brief, verified, then
// queued with save-session.js. Grading and building are two different gates.
//
// Run on your real Mac.

const fs = require("fs");
const path = require("path");
const { getDoc, setDoc, assertReachable, close } = require("./db");
const { SESSION_MINUTES } = require("./session-minutes");

const VALID_VERDICTS = ["unassessed", "weak", "partial", "known", "mastered"];
const PHASES         = ["placement", "lesson", "practice", "check", "retest"];
const VALID_PHASES   = [...PHASES, "mastered"]; // topicStatus.stage can also be "mastered" (closed)

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

const { countQuestions, orderedQuestions, normalizeTeach } = require("../public/session-shape.js");

// A mark is either the string or a { id, mark } object — read it the same way
// everywhere. Comparing the raw entry to "correct" counted every keyed mark as wrong.
const markOf = (m) => (m && typeof m === "object") ? m.mark : m;
const countCorrect = (marks) => marks.filter((m) => markOf(m) === "correct").length;

// marks[] may arrive two ways:
//   keyed  — [{ id, mark }]   the contract. Order cannot drift from meaning.
//   legacy — ["correct", ...] positional, accepted only for decision files
//            written before keyed marks existed.
//
// The positional form is why this had to change: it joined marks[i] to
// orderedQuestions()[i], so a session carrying several guided questions
// shifted every later mark by one and mislabelled it "helped" — wrong
// cleanScore, wrong advance decision, no error anywhere.
function resolveMarks(g, session) {
  const rows = orderedQuestions(session);
  const ids = rows.map((r) => r.id);

  if (!Array.isArray(g.marks) || !g.marks.length)
    fail("marks is required and must be a non-empty array.");

  const keyed = typeof g.marks[0] === "object" && g.marks[0] !== null;
  if (!keyed) {
    if (g.marks.length !== rows.length)
      fail(`marks has ${g.marks.length} entries but the session has ${rows.length} questions.`);
    return rows.map((r, i) => ({ id: r.id, mark: g.marks[i], row: r }));
  }

  const byId = new Map();
  for (const m of g.marks) {
    if (!m || !m.id) fail("every keyed mark needs an \"id\".");
    if (!ids.includes(m.id))
      fail(`marks has id "${m.id}", which is not a question in this session.\n` +
           `  Session questions: ${ids.join(", ")}`);
    if (byId.has(m.id)) fail(`marks has id "${m.id}" twice.`);
    byId.set(m.id, m.mark);
  }
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length)
    fail(`marks is missing ${missing.length} question(s): ${missing.join(", ")}`);

  return rows.map((r) => ({ id: r.id, mark: byId.get(r.id), row: r }));
}

// "Clean" = right on the very first try with zero hints opened and no
// reveal/exhaust — i.e. genuinely unaided. A question answered correctly only
// after a wrong try, or after peeking a hint, is NOT clean (it's "helped").
// This is the mastery signal, computed deterministically from the page's own
// attempt record rather than trusted from the agent. hintsUsed on a first try
// can only be hints the child chose to open before answering (the ladder's
// auto-hint fires on the 2nd wrong try, never the 1st).
function cleanByQuestionId(session) {
  const firstTry = new Map(); // questionId -> its earliest recorded try
  for (const a of session.attempts || []) {
    if (!firstTry.has(a.questionId)) firstTry.set(a.questionId, a);
  }
  const clean = new Map();
  for (const [id, t] of firstTry) {
    clean.set(id, !!(t && t.correct && !t.hintsUsed && !t.revealed && !t.exhausted));
  }
  return clean;
}

// One record per teaching cycle: what was taught, and how it landed.
//
// Derived from the attempt record, never authored by the grader — the same
// discipline as quality[]. A guided question sits immediately after the
// explanation it tests, so its result IS the measurement of that explanation.
// The concept slug is what makes this readable months later: without it the
// history says "cycle 2 failed again", with it it says "digit-times-column
// needed a second angle three lessons running".
function buildCycleOutcomes(session, resolved) {
  const teach = normalizeTeach(session);
  if (!teach) return [];

  const triesById = new Map();
  for (const a of session.attempts || []) {
    if (!triesById.has(a.questionId)) triesById.set(a.questionId, []);
    triesById.get(a.questionId).push(a);
  }

  const out = [];
  teach.cycles.forEach((c, ci) => {
    if (!c.q) return;
    const row = resolved.find((r) => r.row.guided && r.row.cycleIndex === ci);
    const id = (row && row.id) || c.q.id;
    const tries = triesById.get(id) || [];
    const last = tries[tries.length - 1] || null;
    const first = tries[0] || null;

    const revealed = tries.some((a) => a.revealed);
    const exhausted = tries.some((a) => a.exhausted);
    const secondAngleShown = tries.some((a) => a.secondAngleShown);
    const hintsUsed = last ? (last.hintsUsed || 0) : 0;
    const firstTry = !!(first && first.correct && !first.hintsUsed && !revealed && !exhausted);
    const endedRight = (row && row.mark === "correct") || !!(last && last.correct);

    let outcome;
    if (revealed || exhausted || !endedRight) outcome = "not-landed";
    else if (secondAngleShown)                outcome = "needed-second-angle";
    else if (firstTry)                        outcome = "landed";
    else                                      outcome = "landed-after-hint";

    out.push({
      cycleIndex: ci,
      concept: c.concept || null,
      conceptName: c.conceptName || null,
      questionId: id,
      firstTry, tries: last ? (last.tries || tries.length) : 0, hintsUsed,
      secondAngleShown, revealed, exhausted,
      slipCodes: tries.map((a) => a.slipCode).filter(Boolean),
      secTaken: tries.reduce((a, b) => a + (b.msTaken || 0), 0)
        ? Math.round(tries.reduce((a, b) => a + (b.msTaken || 0), 0) / 1000)
        : null,
      outcome,
    });
  });
  return out;
}

// Today in THIS machine's time zone, not UTC. `toISOString()` is always UTC, so
// between midnight and 05:30 in India it still said yesterday — and that date went
// into lastDate, confirmedOn and every history entry.
const pad2 = (n) => String(n).padStart(2, "0");
function todayParts() { const d = new Date(); return [d.getFullYear(), pad2(d.getMonth() + 1), pad2(d.getDate())]; }
const todayDMY = () => { const [y, m, d] = todayParts(); return `${d}/${m}/${y}`; };   // 01/11/2026
const todayISO = () => todayParts().join("-");                                          // 2026-11-01

// Deterministic per-session stats, computed from the session's OWN attempts[]
// rather than trusted from the agent — removes a whole class of hand-counting
// mistakes. One row per questionId, taken from its LAST try.
function statsFromAttempts(session) {
  const byQ = new Map();
  for (const a of session.attempts || []) byQ.set(a.questionId, a); // later tries overwrite earlier
  let hintsUsedTotal = 0, revealedCount = 0, exhaustedCount = 0;
  for (const a of byQ.values()) {
    hintsUsedTotal += a.hintsUsed || 0;
    if (a.revealed) revealedCount++;
    if (a.exhausted) exhaustedCount++;
  }
  return { hintsUsedTotal, revealedCount, exhaustedCount, answered: byQ.size };
}

// The teaching profile — how this child learns, so the teacher agent can
// adapt instead of writing every lesson the same way.
//
// The agent supplies judgment (the dimensions and the prose note). The script
// owns everything countable: `measured` and `concepts` are derived here from
// the attempt record, and an agent that tries to supply them is rejected
// rather than quietly trusted.
const PROFILE_DIMENSIONS = {
  cycleSize:          ["short", "medium", "long"],
  visualReliance:     ["high", "mixed", "low"],
  secondAngleNeed:    ["rare", "sometimes", "often"],
  pace:               ["fast", "steady", "deliberate"],
  persistence:        ["keeps-going", "mixed", "gives-up-fast"],
  wordProblemComfort: ["low", "mixed", "good"],
  entryStyle:         ["needs-definition-first", "learns-from-example", "mixed"],
};
const CYCLE_SHAPED = ["cycleSize", "visualReliance", "secondAngleNeed", "entryStyle"];

function validateTeachingProfile(p, sessionKind) {
  if (p === undefined || p === null) {
    if (sessionKind === "lesson")
      fail("teachingProfile is required after a lesson session — it is how the tutor\n" +
           "  learns this child. Include at least a \"note\".");
    return;
  }
  if (typeof p !== "object") fail("teachingProfile must be an object.");
  if (p.measured) fail("teachingProfile.measured is computed from the attempt record — do not author it.");
  if (p.concepts) fail("teachingProfile.concepts is computed from the cycle outcomes — do not author it.");

  const dims = p.dimensions || {};
  for (const [k, v] of Object.entries(dims)) {
    if (!PROFILE_DIMENSIONS[k])
      fail(`teachingProfile.dimensions."${k}" is not a known dimension.\n` +
           `  Known: ${Object.keys(PROFILE_DIMENSIONS).join(", ")}`);
    if (!PROFILE_DIMENSIONS[k].includes(v))
      fail(`teachingProfile.dimensions.${k} = "${v}" is not valid.\n` +
           `  Allowed: ${PROFILE_DIMENSIONS[k].join(" | ")}`);
    // Nothing observed cycle shape outside a lesson, so a value there would
    // be a guess dressed up as a measurement.
    if (sessionKind !== "lesson" && CYCLE_SHAPED.includes(k))
      fail(`teachingProfile.dimensions.${k} can only be set after a lesson session ` +
           `(this was a ${sessionKind || "non-lesson"}).`);
  }
  if (sessionKind === "lesson" && (!p.note || !String(p.note).trim()))
    fail("teachingProfile.note is required after a lesson session.");
  if (p.note && String(p.note).length > 600)
    fail(`teachingProfile.note is ${String(p.note).length} chars — keep it under 600.`);
}

// Merge the agent's judgment with the script's measurements. Only the keys
// the agent supplied are replaced; everything else carries forward.
function mergeTeachingProfile(prev, p, cycleOutcomes, session, sessionId, today) {
  const base = prev || {};
  const cyc = cycleOutcomes || [];

  const concepts = { ...(base.concepts || {}) };
  for (const c of cyc) {
    if (!c.concept) continue;          // legacy cycle — counted in the session, not the pattern
    const e = concepts[c.concept] || { taught: 0, landedFirstTry: 0, neededSecondAngle: 0 };
    concepts[c.concept] = {
      taught: e.taught + 1,
      landedFirstTry: e.landedFirstTry + (c.outcome === "landed" ? 1 : 0),
      neededSecondAngle: e.neededSecondAngle + (c.secondAngleShown ? 1 : 0),
      conceptName: c.conceptName || e.conceptName || null,
      lastSeen: today, lastOutcome: c.outcome,
    };
  }

  const secs = cyc.map((c) => c.secTaken).filter((n) => typeof n === "number");
  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const measured = cyc.length ? {
    guidedFirstTryRate: Math.round((cyc.filter((c) => c.firstTry).length / cyc.length) * 100) / 100,
    secondAngleRate:    Math.round((cyc.filter((c) => c.secondAngleShown).length / cyc.length) * 100) / 100,
    medianTriesOnGuided: median(cyc.map((c) => c.tries || 0)),
    medianSecPerGuided:  median(secs),
  } : (base.measured || null);

  const note = p && p.note ? String(p.note) : (base.note || null);
  const history = p && p.note
    ? [...(base.history || []), { date: today, sessionId, note: String(p.note) }].slice(-5)
    : (base.history || []);

  return {
    updatedAt: today, updatedBySession: sessionId,
    lessonsObserved: (base.lessonsObserved || 0) + (cyc.length ? 1 : 0),
    dimensions: { ...(base.dimensions || {}), ...((p && p.dimensions) || {}) },
    measured, concepts, note, history,
  };
}

function validateBrief(b, topicId) {
  if (!b) return; // null brief is valid — e.g. all topics mastered
  if (!b.topicId || !b.topicName) fail("brief.topicId and brief.topicName are required.");
  if (!PHASES.includes(b.phase)) fail(`brief.phase must be one of: ${PHASES.join(", ")} (got "${b.phase}")`);
  if (b.phase === "practice" && typeof b.practiceLevel !== "number")
    fail("brief.practiceLevel is required (a number) when brief.phase is \"practice\".");
  const u = b.uiMode;
  if (!u) fail("brief.uiMode is required.");
  if (typeof u.hintsMax !== "number" || u.hintsMax < 0) fail("brief.uiMode.hintsMax must be a number >= 0.");
  if (typeof u.allowReveal !== "boolean") fail("brief.uiMode.allowReveal must be a boolean.");
  if (typeof u.showScore !== "boolean") fail("brief.uiMode.showScore must be a boolean.");
  if (!["multi", "oneShot"].includes(u.retryPolicy)) fail('brief.uiMode.retryPolicy must be "multi" or "oneShot".');
  if (!b.ageStageContext || typeof b.ageStageContext.age !== "number")
    fail("brief.ageStageContext.age is required.");
  // The grader's own session-size judgment call (see grader.md "Session
  // size") — required so it can never silently fall back to a hardcoded count.
  if (!Number.isInteger(b.questionCount) || b.questionCount <= 0)
    fail("brief.questionCount must be a positive whole number — the grader's session-size decision.");
  if (!SESSION_MINUTES.includes(b.sessionMinutes))
    fail(`brief.sessionMinutes must be one of ${SESSION_MINUTES.join(", ")} (got ${b.sessionMinutes}).`);
}

// Pure — no I/O, no writes. Called BEFORE any database write so a bad file
// fails closed instead of partially landing (marks/feedback already written,
// then rejected on the topicStatus step — that was the bug this guards).
function checkHardInvariants(prev, g) {
  let checkAttempts = prev.checkAttempts || 0;
  let backtrackTo = null;

  if (g.checkOutcome === "pass") {
    if (g.verdict !== "mastered") fail(`checkOutcome is "pass" — verdict must be "mastered" (got "${g.verdict}").`);
    checkAttempts = 0;
  } else if (g.checkOutcome === "fail") {
    if (g.verdict === "mastered") fail('checkOutcome is "fail" — verdict cannot be "mastered".');
    checkAttempts += 1;
    if (checkAttempts >= 2) {
      if (!g.backtrackTo) fail("checkAttempts has reached 2 — g.backtrackTo (the prerequisite topic id) is required.");
      backtrackTo = g.backtrackTo;
    }
  }
  return { checkAttempts, backtrackTo };
}

async function mergeTopicStatus(childId, sessionId, g, verdict, checkAttempts, backtrackTo) {
  const existing = (await getDoc(`topicStatus/${childId}`)) || {};
  const topics = existing.topics || {};
  const prev = topics[g.topicId] || { checkAttempts: 0, errorProfile: {}, sessionHistory: [] };
  const today = todayDMY();

  // ── Deterministic session stats + errorProfile merge ────────────────────
  const correct = countCorrect(g.marks);
  const total = g.marks.length;
  const stats = g._sessionStats || {}; // injected by main() after reading the session doc

  const errorProfile = { ...prev.errorProfile };
  const diagnosis = Array.isArray(g.diagnosis) ? g.diagnosis : [];
  const errorCounts = {};
  for (const d of diagnosis) {
    if (!d.errorType) continue;
    errorCounts[d.errorType] = (errorCounts[d.errorType] || 0) + 1;
    const p = errorProfile[d.errorType] || { count: 0, lastSeen: null, lastSessionId: null };
    errorProfile[d.errorType] = { count: p.count + 1, lastSeen: today, lastSessionId: sessionId };
  }
  const dominantErrors = Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).map(([code]) => code);

  // ── On known/mastered scored by a placement session specifically ────────
  const isPlacementGrade = g._sessionKind === "placement";
  const isCheckGrade = g._sessionKind === "check" || g._sessionKind === "retest";

  // Both numbers are over UNAIDED questions only, not just clean. A
  // completion/mastery pair that silently changed meaning between a lesson
  // and a practice session would be worse than either definition on its own.
  // Falls back to the whole session for grades with no guided split recorded.
  const histTotal = typeof g._unaidedTotal === "number" ? g._unaidedTotal : total;
  const histScore = typeof g._unaidedCorrect === "number" ? g._unaidedCorrect : correct;
  const cyc = g._cycleOutcomes || [];

  const historyEntry = {
    sessionId, date: today, kind: g._sessionKind || null, phase: g.stage ? g.stage.phase : null,
    practiceLevel: g.stage ? (g.stage.practiceLevel ?? null) : null,
    score: histScore, total: histTotal,
    // Unaided first-try count — the mastery trend the grader reads across
    // sessions, distinct from `score` (eventual completion). Null on entries
    // written before this field existed.
    cleanScore: g._cleanCount ?? null,
    dominantErrors, hintsUsedTotal: stats.hintsUsedTotal || 0,
    revealedCount: stats.revealedCount || 0, exhaustedCount: stats.exhaustedCount || 0,
    verdictAtTime: verdict,
    // Null for sessions saved before this field existed, or if /finish never
    // got a msTaken (shouldn't happen, but never block a save over it).
    minutesTaken: g._sessionMinutesTaken ?? null,
    // The teaching signal, kept apart from the mastery numbers above. Null
    // when the session had no guided cycles, or predates this field.
    guided: cyc.length ? {
      asked: cyc.length,
      firstTryCorrect: cyc.filter((c) => c.firstTry).length,
      secondAngleShown: cyc.filter((c) => c.secondAngleShown).length,
      revealed: cyc.filter((c) => c.revealed || c.exhausted).length,
    } : null,
  };
  const history = [...(prev.sessionHistory || []), historyEntry];

  // Per-topic teaching record: did re-teaching this topic actually land the
  // second time? Sits beside sessionHistory rather than duplicating it.
  const teachingHistory = cyc.length
    ? [...(prev.teachingHistory || []), {
        sessionId, date: today,
        cycles: cyc.map((c) => ({ concept: c.concept, conceptName: c.conceptName,
                                  outcome: c.outcome, slipCodes: c.slipCodes })),
      }]
    : (prev.teachingHistory || []);

  topics[g.topicId] = {
    verdict,
    stage: g.stage || prev.stage || { phase: "unassessed", practiceLevel: null },
    placementScore: isPlacementGrade ? correct : (prev.placementScore ?? null),
    placementTotal: isPlacementGrade ? total   : (prev.placementTotal ?? null),
    checkScore:     isCheckGrade ? correct : (prev.checkScore ?? null),
    checkTotal:     isCheckGrade ? total   : (prev.checkTotal ?? null),
    checkAttempts,
    backtrackTo,
    confirmedOn: verdict === "mastered" ? today : (prev.confirmedOn ?? null),
    lastDate: today,
    sessionHistory: history,
    teachingHistory,
    errorProfile,
    // The parent dashboard's wording for this topic (grader.md Step 2c). A run that
    // supplies none keeps the last one rather than blanking the card.
    parentNote:  g.topicNote  ? g.topicNote.trim()  : (prev.parentNote  ?? null),
    parentWatch: g.topicWatch === "" ? null : g.topicWatch ? g.topicWatch.trim() : (prev.parentWatch ?? null),
    // A parent's "Re-teach" request is met once a lesson on this topic has been graded.
    reteach: (g._sessionKind === "lesson" ? null : (prev.reteach ?? null)),
  };

  await setDoc(`topicStatus/${childId}`, {
    childId, lastUpdated: todayISO(), topics,
  });
  return topics[g.topicId];
}

async function main() {
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) fail("Usage: node save-grading.js <grading-decision.json> [--resume]");
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail(`File not found: ${full}`);

  let g;
  try { g = JSON.parse(fs.readFileSync(full, "utf8")); }
  catch (e) { fail(`Could not parse JSON: ${e.message}`); }

  // ── Validate core fields ─────────────────────────────────────────────────
  if (!g.sessionId) fail("sessionId is required.");
  if (!g.childId)   fail("childId is required.");
  if (!g.topicId)   fail("topicId is required.");
  // Two accepted shapes — keyed [{id, mark}] (the contract) and the legacy
  // positional ["correct", ...]. resolveMarks() does the real work; this only
  // checks the mark values themselves.
  if (!Array.isArray(g.marks)) fail("marks must be an array of {id, mark} objects, or legacy 'correct'/'wrong' strings.");
  // `.find()` then `!== undefined` could not see a mark with NO value ({ id } alone):
  // the value found is undefined, which reads as "nothing bad found".
  const badMarks = g.marks.map(markOf).filter((m) => m !== "correct" && m !== "wrong");
  if (badMarks.length) fail(`marks may only be 'correct' or 'wrong' (found: ${badMarks.map(String).join(", ")}).`);
  if (!VALID_VERDICTS.includes(g.verdict))
    fail(`verdict must be one of: ${VALID_VERDICTS.join(", ")} (got "${g.verdict}")`);
  if (g.checkOutcome !== undefined && g.checkOutcome !== null && !["pass", "fail"].includes(g.checkOutcome))
    fail('checkOutcome must be "pass", "fail", or omitted.');
  if (!g.stage || !VALID_PHASES.includes(g.stage.phase))
    fail(`stage.phase must be one of: ${VALID_PHASES.join(", ")}`);
  if (!g.parentSummary || typeof g.parentSummary !== "string" || !g.parentSummary.trim())
    fail("parentSummary is required — a 1-3 sentence plain-English note for the parent (see grader.md Step 2b).");
  for (const k of ["topicNote", "topicWatch"])
    if (g[k] !== undefined && g[k] !== null && (typeof g[k] !== "string" || g[k].length > 400))
      fail(`${k} must be a string of at most 400 characters (see grader.md Step 2c).`);
  validateBrief(g.brief, g.topicId);

  const feedback = Array.isArray(g.feedback) ? g.feedback : [];
  const items = feedback.map((f) => {
    if (!f.q || !f.title || !f.body) fail("each feedback item needs q, title, body.");
    const item = { q: f.q, title: f.title, body: f.body };
    // Optional, enrichment-only (docs/feedback-style.md) — a legacy item
    // with none of these still renders fine, body carries everything as it
    // always has. Whichever ARE given are shape-checked so a malformed one
    // doesn't reach a child silently.
    if (f.lastTry != null) {
      if (typeof f.lastTry !== "object" || f.lastTry.given == null || String(f.lastTry.given).trim() === "")
        fail(`feedback item "${f.title}": lastTry needs at least a "given" value.`);
      item.lastTry = { question: f.lastTry.question || null, given: String(f.lastTry.given) };
    }
    if (f.remember != null) {
      if (typeof f.remember !== "string" || !f.remember.trim())
        fail(`feedback item "${f.title}": remember must be a non-empty string.`);
      if (f.remember.length > 140)
        fail(`feedback item "${f.title}": remember is ${f.remember.length} chars — keep it under 140, it's a one-line callout.`);
      item.remember = f.remember;
    }
    if (f.visual != null) {
      if (typeof f.visual !== "object" || !f.visual.type)
        fail(`feedback item "${f.title}": visual needs a "type".`);
      item.visual = f.visual;
    }
    return item;
  });

  await assertReachable();

  const session = await getDoc(`sessions/${g.sessionId}`);
  if (!session) fail(`sessions/${g.sessionId} does not exist.`);
  const qCount = countQuestions(session);
  const resolved = resolveMarks(g, session);        // [{ id, mark, row }]

  // ── Validate hard invariants BEFORE any write — fail closed, not partway ──
  const existingStatus = (await getDoc(`topicStatus/${g.childId}`)) || {};
  const prevTopic = (existingStatus.topics || {})[g.topicId] || { checkAttempts: 0, errorProfile: {}, sessionHistory: [] };
  // Five writes in a row, no transaction. If one stopped partway, the natural
  // response is "run it again" — which would append this session to sessionHistory
  // a second time, double every error count and double the teaching record, and the
  // grader would read that as a child who keeps making the same mistake.
  const alreadyMerged = (prevTopic.sessionHistory || []).some((h) => h.sessionId === g.sessionId);
  if (alreadyMerged && !resume)
    fail(`${g.sessionId} is already in topicStatus.${g.topicId}'s history — an earlier run got that far.\n` +
         "  Grading it again would count it twice. To finish whatever is still missing without\n" +
         "  recounting, re-run with --resume.");
  const { checkAttempts, backtrackTo } = alreadyMerged
    ? { checkAttempts: prevTopic.checkAttempts || 0, backtrackTo: prevTopic.backtrackTo ?? null }
    : checkHardInvariants(prevTopic, g);
  validateTeachingProfile(g.teachingProfile, session.kind || null);

  // Deterministic cross-check: warn (do not block) if the agent's marks
  // disagree with what the page itself recorded as correct — the agent's
  // human-fairness judgment (clumsy-but-right wording) is allowed to differ,
  // but a silent landslide of disagreement usually means a mistake.
  const byQ = new Map();
  for (const a of session.attempts || []) byQ.set(a.questionId, a);
  const pageCorrect = [...byQ.values()].filter((a) => a.correct).length;
  const agentCorrect = resolved.filter((r) => r.mark === "correct").length;
  if (Math.abs(pageCorrect - agentCorrect) >= 2)
    console.warn(`⚠ marks disagree with the page's own record on ${Math.abs(pageCorrect - agentCorrect)} ` +
                 `question(s) (page says ${pageCorrect}/${qCount}, grading says ${agentCorrect}/${qCount}). ` +
                 `Proceeding — but double-check this was deliberate.`);

  const correct = agentCorrect;

  // Per-question quality: 'clean' (unaided first-try), 'helped' (right in the
  // end but needed a retry or a hint), or 'wrong' (the grader marked it wrong).
  // The grader's correctness verdict wins — a question it marked wrong is never
  // "clean" even if the page recorded a lucky first tap. This is what the
  // parent-facing "X done · Y clean" split and the grader's mastery thresholds
  // read, so completion no longer masquerades as mastery.
  const cleanMap = cleanByQuestionId(session);
  const quality = resolved.map((r) =>
    r.mark === "wrong" ? "wrong" : (cleanMap.get(r.id) ? "clean" : "helped"));

  // What the child answers in a lesson splits two ways, and conflating them
  // is the bug this guards: a GUIDED question sits immediately after the
  // explanation it tests, with the full hint ladder up. Getting it right
  // measures whether the teaching landed, not whether the topic is mastered.
  // cleanScore — the number the grader's advance thresholds read — therefore
  // counts unaided (non-guided) questions only.
  const questionIndex = resolved.map((r) => ({ id: r.id, section: r.row.section, guided: r.row.guided }));
  const unaided = resolved.filter((r) => !r.row.guided);
  const unaidedQuality = unaided.map((r) =>
    r.mark === "wrong" ? "wrong" : (cleanMap.get(r.id) ? "clean" : "helped"));
  const cleanCount = unaidedQuality.filter((q) => q === "clean").length;
  const unaidedCorrect = unaided.filter((r) => r.mark === "correct").length;
  g._cleanCount = cleanCount;
  g._unaidedCorrect = unaidedCorrect;
  g._unaidedTotal = unaided.length;

  const cycleOutcomes = buildCycleOutcomes(session, resolved);
  g._cycleOutcomes = cycleOutcomes;

  // ── Write 1: session doc gets marks + quality + the parent-facing summary ──
  await setDoc(`sessions/${g.sessionId}`, {
    ...session,
    marks: resolved.map((r) => r.mark),       // positional, for the dashboard
    markedBy: resolved.map((r) => ({ id: r.id, mark: r.mark })),
    quality, questionIndex,
    cycleOutcomes: cycleOutcomes.length ? cycleOutcomes : undefined,
    parentSummary: g.parentSummary,
  });
  console.log(`✓ sessions/${g.sessionId} updated with marks (${correct}/${qCount} correct, ` +
              `${cleanCount}/${unaided.length} clean unaided)`);
  if (cycleOutcomes.length)
    cycleOutcomes.forEach((c) =>
      console.log(`    cycle ${c.cycleIndex + 1} ${c.concept ? `[${c.concept}] ` : ""}→ ${c.outcome}`));

  // ── Write 2: feedback embedded, status → graded ───────────────────────────
  await setDoc(`feedback/${g.sessionId}`, { items });
  console.log(`✓ feedback/${g.sessionId} — ${items.length} note${items.length === 1 ? "" : "s"} embedded, status → graded`);

  // ── Write 3: topicStatus merge ────────────────────────────────────────────
  g._sessionStats = statsFromAttempts(session);
  g._sessionKind = session.kind || null;
  // How long the child actually took, from the page's own /finish summary —
  // the grader's "Session size" rule needs this to tell whether a past
  // session finished comfortably inside its budget or ran close to it.
  const msTaken = session.summary && session.summary.msTaken;
  g._sessionMinutesTaken = typeof msTaken === "number" ? Math.round((msTaken / 60000) * 10) / 10 : null;
  if (alreadyMerged) console.log("• topicStatus already holds this session — not merged again (--resume).");
  const updated = alreadyMerged ? prevTopic
    : await mergeTopicStatus(g.childId, g.sessionId, g, g.verdict, checkAttempts, backtrackTo);
  console.log(`✓ topicStatus/${g.childId}.${g.topicId} — verdict:${updated.verdict} stage:${updated.stage.phase}` +
              (updated.stage.practiceLevel ? `(${updated.stage.practiceLevel})` : "") +
              (updated.backtrackTo ? ` ⚠ BACKTRACK → ${updated.backtrackTo}` : ""));

  // ── Write 4: the session brief for the next build step ───────────────────
  await setDoc(`brief/${g.childId}`, g.brief ? { ...g.brief, generatedAt: new Date().toISOString(), generatedBySession: g.sessionId } : null);
  if (g.brief) console.log(`✓ brief/${g.childId} — next: ${g.brief.topicName} [${g.brief.phase}]`);
  else console.log("• brief/" + g.childId + " cleared — no next session (all topics mastered, or parent review needed).");

  // ── Write 5: the teaching profile — how this child learns ────────────────
  if (g.teachingProfile || (g._cycleOutcomes || []).length) {
    const prevProfile = await getDoc(`teachingProfile/${g.childId}`);
    if (prevProfile && prevProfile.updatedBySession === g.sessionId) {
      console.log("• teachingProfile already holds this session — not merged again.");
    } else {
      const merged = mergeTeachingProfile(prevProfile, g.teachingProfile, g._cycleOutcomes,
                                          session, g.sessionId,
                                          todayDMY());
      await setDoc(`teachingProfile/${g.childId}`, merged);
      const hard = Object.entries(merged.concepts || {})
        .filter(([, v]) => v.neededSecondAngle >= 2)
        .map(([k]) => k);
      console.log(`✓ teachingProfile/${g.childId} — ${Object.keys(merged.concepts || {}).length} concept(s) tracked` +
                  (hard.length ? `, needing another angle: ${hard.join(", ")}` : ""));
    }
  }

  console.log("\nDone. The child will see this feedback next time they open their page.");
}

if (require.main === module) {
  main()
    .catch((e) => { console.error("✗ save-grading failed:", e.message); process.exitCode = 1; })
    .finally(() => close());
}
module.exports = { markOf, countCorrect, todayDMY, todayISO };
