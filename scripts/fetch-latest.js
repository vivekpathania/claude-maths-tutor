// fetch-latest.js — show the newest SUBMITTED-but-UNGRADED session so it can
// be graded. Prints a human-readable view plus a JSON block.
//
//   node fetch-latest.js
//
// "Ungraded" = status === "submitted" AND session.marks is empty/absent.
// Run on your real Mac.

const { listSessions, assertReachable, close } = require("./db");
const SessionShape = require("../public/session-shape.js");

async function main() {
  await assertReachable();

  const sessions = await listSessions();
  if (!sessions.length) {
    console.log("No sessions yet. Run /setup-child, then /next-session to queue the first one.");
    return;
  }

  // Newest first by date (DD/MM/YYYY) then createTime as tiebreak.
  const parseDate = (d) => {
    const [dd, mm, yy] = (d || "").split("/");
    return yy && mm && dd ? `${yy}-${mm}-${dd}` : "";
  };
  sessions.sort((a, b) => {
    const c = parseDate(b.date).localeCompare(parseDate(a.date));
    return c !== 0 ? c : (b._createTime || "").localeCompare(a._createTime || "");
  });

  // Find the newest submitted session that has not been graded yet.
  // New sessions get status="graded" after save-grading runs.
  // Older sessions may still have status="submitted" but marks[] already set.
  let target = null;
  for (const s of sessions) {
    if (s.status !== "submitted") continue;
    if (Array.isArray(s.marks) && s.marks.length > 0) continue; // already graded
    target = s;
    break;
  }

  if (!target) {
    console.log("✓ Nothing to grade — every submitted session already has marks.");
    const pending = sessions.filter((s) => s.status === "pending").map((s) => s.id);
    console.log(pending.length ? `Pending (waiting for the child): ${pending.join(", ")}` : "No pending session queued.");
    return;
  }

  const staged = !!(target.warmup || target.practice || target.teach);

  console.log("═".repeat(64));
  console.log(`UNGRADED SESSION: ${target.id}`);
  console.log(`${target.dayLabel || target.topicName || "?"} · ${target.date || (target.finishedAt || "").slice(0, 10) || "?"}` +
              `${target.kind ? ` · kind: ${target.kind}` : ""}`);

  let payload;

  if (staged) {
    // Staged shape: the real record is attempts[], one row per try.
    const attempts = target.attempts || [];
    const byQ = new Map();
    for (const a of attempts) {
      if (!byQ.has(a.questionId)) byQ.set(a.questionId, []);
      byQ.get(a.questionId).push(a);
    }

    // Same ordering the child's page and save-grading.js use. A guided
    // question missed here never reaches the grader, so it never gets a mark,
    // and marks[] silently drifts out of step with the session.
    const qs = SessionShape.orderedQuestions(target)
      .map((r) => ({ ...r.q, id: r.id, section: r.section, guided: r.guided,
                     cycleIndex: r.cycleIndex }));

    const answered = qs.filter((q) => byQ.has(q.id)).length;
    const revealed = qs.filter((q) => (byQ.get(q.id) || []).some((t) => t.revealed));
    console.log(`Answered: ${answered}/${qs.length}   Attempts logged: ${attempts.length}`);
    if (revealed.length)
      console.log(`⚠ ${revealed.length} question(s) needed the answer shown: ${revealed.map((q) => q.id).join(", ")}`);
    console.log("═".repeat(64));

    qs.forEach((q, i) => {
      const tries = byQ.get(q.id) || [];
      const last = tries[tries.length - 1];
      console.log(`\n${i + 1}. [${q.section}] ${q.ask}`);
      console.log(`    expected: ${q.answer}`);
      if (!tries.length) {
        console.log("    → (not attempted)");
      } else {
        tries.forEach((t, k) => {
          if (t.revealed) {
            console.log(`    → GAVE UP after ${t.tries} tries — answer was shown`);
            return;
          }
          console.log(`    → try ${k + 1}: "${t.given}" ${t.correct ? "✓" : "✗"}` +
                      `${t.slipCode ? `  slip: ${t.slipCode}` : ""}` +
                      `${t.hintsUsed ? `  hints: ${t.hintsUsed}` : ""}`);
        });
        if (tries.some((t) => t.revealed)) console.log("    ⚠ NEEDS RE-TEACHING — could not get there unaided");
        else if (!last.correct) console.log("    ⚠ ended wrong");
      }
    });

    payload = {
      sessionId: target.id, childId: target.childId || "", kind: target.kind || "",
      topicId: target.topicId || "", topicName: target.topicName || "",
      prevSessionId: target.prevSessionId || "",
      expectedMarks: qs.length,
      questions: qs.map((q) => ({
        id: q.id, section: q.section, guided: !!q.guided, cycleIndex: q.cycleIndex,
        ask: q.ask, expected: q.answer,
        tries: (byQ.get(q.id) || []).map((t) => ({
          given: t.given, correct: !!t.correct, hintsUsed: t.hintsUsed || 0, slipCode: t.slipCode || null,
        })),
      })),
      summary: target.summary || null,
    };
  } else {
    // Legacy shape: questions[] / answers[] written in one go on submit.
    const qs = target.questions || [];
    const ans = target.answers || [];
    console.log(`Answered: ${target.answeredCount ?? ans.filter((a) => a).length}/${qs.length}` +
                ` · Theme: ${target.theme || "?"}`);
    console.log("═".repeat(64));
    qs.forEach((q, i) => {
      const a = ans[i] && ans[i].trim() ? ans[i] : "(skipped)";
      console.log(`\nQ${i + 1}. ${q}`);
      console.log(`    → Answer: ${a}`);
    });
    payload = {
      sessionId: target.id, childId: target.childId || "", date: target.date, theme: target.theme,
      prevSessionId: target.prevSessionId || "", questions: qs, answers: ans,
    };
  }

  console.log("\n" + "─".repeat(64));
  console.log(`Shape: ${staged ? "staged" : "legacy"} — marks[] must have ` +
              `${staged ? payload.questions.length : (target.questions || []).length} entries.`);
  console.log("JSON (for grading):");
  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((e) => { console.error("✗ fetch-latest failed:", e.message); process.exitCode = 1; })
  .finally(() => close());
