/* session-shape.js — the ONE definition of a session's question order.
 *
 * Loaded two ways, deliberately the same physical file:
 *   browser — <script src="/session-shape.js"></script>  → window.SessionShape
 *   node    — require('../public/session-shape.js')      → module.exports
 *
 * Why it exists: the child's page and the grading scripts each used to walk a
 * session their own way. They agreed only by coincidence — both happened to go
 * warm-up → tryIt → practice. The moment a lesson carries several guided
 * questions that coincidence breaks, and `marks[i]` lines up against the wrong
 * question with no error raised anywhere. Everything that needs to know "what
 * are this session's questions, in order" calls into here.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SessionShape = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function isStaged(s) {
    return !!(s && (s.warmup || s.practice || s.teach));
  }

  /* Every lesson shape, old and new, as cycles.
   *
   * New:    teach.cycles[] — teach a bit, answer one guided question, repeat.
   * Legacy: teach.steps[] + teach.tryIt — the whole walkthrough then one
   *         question. Normalises to exactly one cycle, so stored sessions and
   *         the built-in demo keep producing today's counts to the question.
   * Returns null when there is no teach block at all (practice/check/retest).
   */
  function normalizeTeach(s) {
    const t = s && s.teach;
    if (!t) return null;

    if (Array.isArray(t.cycles)) {
      return {
        title: t.title || '',
        cycles: t.cycles.map(function (c) {
          return {
            concept: (c && c.concept) || null,
            conceptName: (c && c.conceptName) || null,
            steps: (c && c.steps) || [],
            q: (c && c.q) || null,
            secondAngle: (c && c.secondAngle) || null,
            // Enrichment-only fields (CLAUDE.md "Session shape") — optional,
            // but must still survive normalisation or the page never sees
            // them no matter what the teacher agent writes.
            goldenRule: (c && c.goldenRule) || null,
            stepLabel: (c && c.stepLabel) || null,
            upNext: (c && c.upNext) || null,
          };
        }),
      };
    }

    // Legacy one-cycle form. concept stays null — it was never authored, and
    // a null concept is excluded from the cross-topic pattern rather than
    // being invented here (see CLAUDE.md, "Teaching cycle records").
    return {
      title: t.title || '',
      cycles: [{
        concept: null, conceptName: null,
        steps: t.steps || [],
        q: t.tryIt || null,
        secondAngle: null,
      }],
    };
  }

  /* The session's questions in the exact order the child meets them.
   *
   * Rows, not bare questions — the section/guided fields are what let the
   * grader split mastery from teaching without re-deriving the shape.
   *
   *   [ { q, id, section: 'warmup'|'guided'|'practice', guided, cycleIndex, index } ]
   *
   * `id` carries the page's positional fallback ('q_<n>') so a session whose
   * questions predate mandatory ids still joins up identically on both sides.
   * New sessions are required to author real ids — verify-session.js blocks
   * the fallback rather than relying on it.
   */
  function orderedQuestions(s) {
    const rows = [];
    if (!s) return rows;

    const push = function (q, section, cycleIndex) {
      const index = rows.length;
      rows.push({
        q: q,
        id: (q && q.id) || ('q_' + index),
        section: section,
        guided: section === 'guided',
        cycleIndex: cycleIndex === undefined ? null : cycleIndex,
        index: index,
      });
    };

    if (!isStaged(s)) {
      (s.questions || []).forEach(function (q, i) {
        push(typeof q === 'string' ? { id: 'q' + (i + 1), ask: q } : q, 'practice');
      });
      return rows;
    }

    ((s.warmup && s.warmup.items) || []).forEach(function (q) { push(q, 'warmup'); });

    const teach = normalizeTeach(s);
    if (teach) {
      teach.cycles.forEach(function (c, ci) {
        if (c.q) push(c.q, 'guided', ci);
      });
    }

    (s.practice || []).forEach(function (q) { push(q, 'practice'); });
    return rows;
  }

  /* Every question the child answers. This is what marks[] must cover. */
  function countQuestions(s) {
    return orderedQuestions(s).length;
  }

  /* The questions `brief.questionCount` budgets: warm-up + practice.
   *
   * Guided questions are deliberately NOT counted. On a lesson the number of
   * cycles is the teacher agent's pedagogical call, not something the grader's
   * time budget gets to cap — see CLAUDE.md "Session size".
   */
  function countBudgetedQuestions(s) {
    return orderedQuestions(s).filter(function (r) { return !r.guided; }).length;
  }

  /* id → question, for anything rendering an attempt row back to its text. */
  function questionMap(s) {
    const m = {};
    orderedQuestions(s).forEach(function (r) { if (r.q) m[r.id] = r.q; });
    return m;
  }

  return {
    isStaged: isStaged,
    normalizeTeach: normalizeTeach,
    orderedQuestions: orderedQuestions,
    countQuestions: countQuestions,
    countBudgetedQuestions: countBudgetedQuestions,
    questionMap: questionMap,
  };
});
