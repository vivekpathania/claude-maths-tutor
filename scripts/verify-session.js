#!/usr/bin/env node
// verify-session.js — deterministic safety net for generated sessions.
//
// Checks every question in a session file BEFORE it can reach the child:
//   • the stated answer actually equals the computed answer
//   • no "slip" (predicted wrong answer) is secretly the correct answer
//   • ids are unique, required fields present, answers in a sane range
//
// Word problems cannot be parsed arithmetically — those are reported as
// NEEDS-RESOLVE so the verifier agent can re-solve them cold.
//
// Usage:  node scripts/verify-session.js <session.json> [--json]
// Exit:   0 = no blocking errors, 1 = errors found (do not save)

'use strict';

const fs = require('fs');
const SessionShape = require('../public/session-shape.js');
// The same module the child's page draws scenes with — what is checked here is
// exactly what is drawn there (public/scene.js).
const SceneLib = require('../public/scene.js');

/* ── expression parsing (never eval — input may be model-generated) ───────── */

// Normalise unicode maths characters to ASCII.
function normaliseExpr(s) {
  return String(s)
    .replace(/[×⨯✕✖]/g, '*')
    .replace(/[÷∕]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/(\d),(?=\d{3}\b)/g, '$1');   // 1,000 → 1000
}

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) return null;   // 1.2.3
      out.push({ t: 'num', v: parseFloat(raw) });
      i = j;
      continue;
    }
    if ('+-*/()'.includes(c)) { out.push({ t: c }); i++; continue; }
    return null;                                              // unknown char
  }
  return out;
}

// expr := term (('+'|'-') term)*   term := factor (('*'|'/') factor)*
// factor := '-'? ( num | '(' expr ')' )
function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => (tokens[p] && tokens[p].t === t ? (p++, true) : false);

  function factor() {
    if (eat('-')) { const v = factor(); return v === null ? null : -v; }
    if (eat('(')) {
      const v = expr();
      if (v === null || !eat(')')) return null;
      return v;
    }
    const tok = peek();
    if (tok && tok.t === 'num') { p++; return tok.v; }
    return null;
  }
  function term() {
    let v = factor();
    if (v === null) return null;
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = peek().t; p++;
      const r = factor();
      if (r === null) return null;
      if (op === '/' && r === 0) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    let v = term();
    if (v === null) return null;
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = peek().t; p++;
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  const v = expr();
  return v === null || p !== tokens.length ? null : v;
}

// Returns a number, or null when the text is not a pure arithmetic expression.
function evalExpr(text) {
  const src = normaliseExpr(text).trim();
  if (!src || !/[0-9]/.test(src)) return null;
  if (/[a-zA-Z]/.test(src)) return null;              // prose → word problem
  const toks = tokenize(src);
  if (!toks || !toks.length) return null;
  const v = parse(toks);
  return v === null || !isFinite(v) ? null : round(v);
}

const round = (n) => Math.round(n * 1e10) / 1e10;

/* ── answer normalisation ─────────────────────────────────────────────────── */

// "9 r1" | "9 remainder 1" | "9 rem 1" | "9 r 1"  →  { q: 9, r: 1 }
const REMAINDER_RE = /^\s*(-?\d+)\s*(?:r|rem|remainder|remainders)\s*\.?\s*(\d+)\s*$/i;

function parseAnswer(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { kind: 'blank' };

  const m = s.match(REMAINDER_RE);
  if (m) return { kind: 'remainder', q: parseInt(m[1], 10), r: parseInt(m[2], 10) };

  const cleaned = normaliseExpr(s).replace(/[£$€%]/g, '').trim();
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return { kind: 'number', v: round(parseFloat(cleaned)) };

  return { kind: 'text', v: s };
}

// Division where the stated answer carries a remainder: verify a ÷ b = q rem r.
function checkRemainder(ask, ans) {
  const src = normaliseExpr(ask);
  const m = src.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;                                  // not a bare division
  const a = parseFloat(m[1]), b = parseFloat(m[2]);
  if (!b) return { ok: false, why: 'divide by zero' };
  const q = Math.floor(a / b), r = round(a - q * b);
  if (ans.q === q && ans.r === r) return { ok: true };
  return { ok: false, why: `${a} ÷ ${b} = ${q} r${r}, not ${ans.q} r${ans.r}` };
}

/* ── visuals ──────────────────────────────────────────────────────────────── */
// Visuals are declarative data the child's page draws (see CLAUDE.md "Visuals").
// A diagram that contradicts its own caption teaches a falsehood, so a mismatch
// is blocking — the same severity as a wrong answer key.

const VISUAL_TYPES = ['placeValue', 'fractionBars', 'scene'];

/* ── authored Ollie lines (q.ollie, steps[].ollie) ─────────────────────────── */
// docs/mascot.md §8 plans a standalone verify-ollie-lines.js for the bank;
// these two rules are cheap enough to enforce here too, on every authored
// override, since a per-session line reaches a child exactly like a bank
// line does and the single-voice rule (§1) binds it just as hard.
const OLLIE_MAX_CHARS = 160;
function checkOllieLine(text, where, out) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return;
  if (/\bOllie\b/.test(s))
    out.errors.push({ where, msg: `Refers to Ollie in the third person ("${s}") — she speaks in first person, always (docs/mascot.md §1).` });
  if (s.length > OLLIE_MAX_CHARS)
    out.errors.push({ where, msg: `Ollie line is ${s.length} chars, over the ${OLLIE_MAX_CHARS}-char limit (docs/mascot.md §6/§8) — tighten it.` });
}

// Every fraction written in a piece of text, as [numerator, denominator].
function fractionsIn(text) {
  const out = [];
  const re = /(\d+)\s*\/\s*(\d+)/g;
  let m;
  while ((m = re.exec(String(text == null ? '' : text)))) out.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
  return out;
}

const fracStr = (p) => `${p[0]}/${p[1]}`;

// `claimText` is the step's `big` — an assertion the diagram must support.
// `strict` cross-checks the diagram against it; that only applies to teach
// steps. A question's `ask` is a prompt, not a claim ("Shade 3/4 of this bar"
// legitimately ships an empty bar), so questions get shape checks only.
function checkVisual(v, where, claimText, out, strict) {
  const { errors, warnings, resolve } = out;

  if (!v || typeof v !== 'object') {
    errors.push({ where, msg: 'Visual is not an object.' });
    return;
  }
  if (!v.type || !VISUAL_TYPES.includes(v.type)) {
    errors.push({ where,
      msg: `Unknown visual type ${JSON.stringify(v.type)} — the child's page cannot draw it. Known types: ${VISUAL_TYPES.join(', ')}.` });
    return;
  }
  if (v.type === 'scene') {
    // Every fact the author stated is recomputed from the drawing itself, and
    // any disagreement blocks — a wrong picture teaches the error directly.
    // A teach step's headline is cross-checked too; a question's `ask` is a
    // prompt, not a claim, so questions get the facts check only.
    const r = SceneLib.checkScene(v, { claim: strict ? claimText : null });
    r.errors.forEach((msg) => errors.push({ where, msg }));
    r.warnings.forEach((msg) => warnings.push({ where, msg }));
    if (!r.errors.length)
      resolve.push({ where, ask: 'diagram: ' + SceneLib.describe(v).replace(/\n/g, ' | '),
        answer: String(claimText || '').trim(),
        msg: 'Does this picture fit the question, and can the question be answered from it alone? The facts were recomputed from the drawing.' });
    return;
  }
  if (v.type === 'placeValue') {
    // An all-zero chart is almost always a "blank chart" authored wrong: the
    // child reads 000000 as the number zero, and on a place-value topic that
    // actively fights the lesson. A genuinely blank chart uses "" per column.
    const digits = (v.cols || []).map((c) => (Array.isArray(c) ? String(c[1] ?? '') : ''));
    if (digits.length && digits.every((d) => d === '0'))
      out.warnings.push({ where, msg: 'placeValue chart is all zeros — for an EMPTY chart use "" per column, not "0".' });
    return;
  }
  if (v.type !== 'fractionBars') return;     // nothing else has a checkable claim

  const bars = Array.isArray(v.bars) ? v.bars : null;
  if (!bars || !bars.length) {
    errors.push({ where, msg: 'fractionBars needs a non-empty "bars" array.' });
    return;
  }

  let shapeOk = true;
  bars.forEach((b, i) => {
    const parts = b && b.parts, shaded = b && b.shaded;
    if (!Number.isInteger(parts) || parts < 1) {
      errors.push({ where, msg: `bars[${i}].parts must be a whole number 1 or more (got ${JSON.stringify(parts)}).` });
      shapeOk = false;
      return;
    }
    if (!Number.isInteger(shaded) || shaded < 0 || shaded > parts) {
      errors.push({ where, msg: `bars[${i}].shaded must be a whole number from 0 to ${parts} (got ${JSON.stringify(shaded)}).` });
      shapeOk = false;
      return;
    }
    // A bar labelled "2/4" must actually draw 2 of 4 parts.
    const lf = fractionsIn(b.label);
    if (lf.length === 1 && lf[0][1] && lf[0][0] / lf[0][1] !== shaded / parts)
      errors.push({ where, msg: `bars[${i}] is labelled "${b.label}" but draws ${shaded}/${parts}.` });
  });
  if (!shapeOk || !strict) {
    if (shapeOk && !strict)
      resolve.push({ where, ask: `diagram: ${bars.map((b) => `${b.shaded}/${b.parts}`).join(', ')}`,
        answer: String(claimText || '').trim(), msg: 'Does this diagram fit the question? Confirm by eye.' });
    return;
  }

  const claimed = fractionsIn(claimText);
  const drawn = bars.map((b) => b.shaded / b.parts);
  const claim = String(claimText || '').trim();

  if (!claimed.length) {
    if (claim)
      resolve.push({ where, ask: `diagram: ${bars.map((b) => `${b.shaded}/${b.parts}`).join(', ')}`,
        answer: claim, msg: 'Diagram claim names no fractions — confirm it matches by eye.' });
    return;
  }

  for (const p of claimed) {
    if (p[1] && !drawn.some((val) => val === p[0] / p[1]))
      errors.push({ where, msg: `"${claim}" names ${fracStr(p)} but no bar shows it.` });
  }

  // "1/2 = 2/4" asserts equality: the text must be true, and every bar drawn
  // under it must share that value — a bar showing anything else contradicts
  // the very thing the step is teaching.
  if (/=/.test(claim) && claimed.length > 1) {
    const vals = claimed.map((p) => p[0] / p[1]);
    if (!vals.every((x) => x === vals[0])) {
      errors.push({ where,
        msg: `"${claim}" says these are equal, but they are not: ${claimed.map(fracStr).join(' vs ')}.` });
    } else {
      bars.forEach((b, i) => {
        if (b.shaded / b.parts !== vals[0])
          errors.push({ where,
            msg: `"${claim}" claims one shaded amount, but bars[${i}] shows ${b.shaded}/${b.parts}.` });
      });
    }
  } else {
    // Not an equality claim — a bar the text never names may be a deliberate
    // contrast ("this is 1/2, NOT 1/8"), so flag it rather than block it.
    bars.forEach((b, i) => {
      const val = b.shaded / b.parts;
      if (!claimed.some((p) => p[1] && p[0] / p[1] === val))
        warnings.push({ where, msg: `bars[${i}] shows ${b.shaded}/${b.parts}, which "${claim}" never mentions — deliberate contrast?` });
    });
  }
}

/* ── question collection (supports both session shapes) ───────────────────── */

// Walks the session through the SAME ordering the child's page and the
// grading scripts use (public/session-shape.js). Before this was shared, a
// guided question outside `teach.tryIt` was never answer-checked at all — it
// shipped to the child with an unverified answer key and nothing said so.
function collectQuestions(session) {
  const warmN = ((session.warmup && session.warmup.items) || []).length;
  return SessionShape.orderedQuestions(session)
    .filter((r) => r.q && typeof r.q === 'object')
    .map((r) => {
      let where;
      if (r.section === 'warmup') where = `warmup[${r.index}]`;
      else if (r.section === 'guided') where = `teach.cycles[${r.cycleIndex}].q`;
      else if (!SessionShape.isStaged(session)) where = `questions[${r.index}]`;
      else where = `practice[${r.index - warmN - countGuided(session)}]`;
      return { q: r.q, where };
    });
}

function countGuided(session) {
  return SessionShape.orderedQuestions(session).filter((r) => r.guided).length;
}

/* ── checks ───────────────────────────────────────────────────────────────── */

const MAX_REASONABLE = 100000;

function verify(session) {
  const errors = [], warnings = [], resolve = [];
  const out = { errors, warnings, resolve };
  const items = collectQuestions(session);

  // ── the teach walkthrough. Nothing used to inspect this at all, yet it is
  // where the actual teaching happens — and a diagram contradicting its own
  // step is as damaging as a wrong answer key.
  const teach = SessionShape.normalizeTeach(session);
  if (teach) {
    const authored = Array.isArray(session.teach.cycles);   // new shape, held to the full schema
    const seenConcepts = new Map();

    teach.cycles.forEach((c, ci) => {
      const cw = authored ? `teach.cycles[${ci}]` : 'teach';

      const checkStep = (st, where) => {
        if (!st || typeof st !== 'object') {
          errors.push({ where, msg: 'Step is not an object.' });
          return;
        }
        if (!st.big || !String(st.big).trim())
          errors.push({ where, msg: 'Step has no "big" headline.' });
        if (st.visual) checkVisual(st.visual, `${where}.visual`, st.big, out, true);
        // docs/mascot.md §5 — Ollie narrates every teach step. A step with no `ollie`
        // would fall back to a generic bank line that has nothing to do with it, so
        // it blocks: the child must never hear that.
        if (st.ollie && String(st.ollie).trim()) checkOllieLine(st.ollie, `${where}.ollie`, out);
        else errors.push({ where, msg: 'No "ollie" — every teach step needs Ollie\'s own narration (docs/mascot.md §5); a generic bank line must never reach the child.' });
      };

      (c.steps || []).forEach((st, i) => checkStep(st, `${cw}.steps[${i}]`));

      // The second angle is shown to a child who has just got it wrong, so it
      // is held to exactly the same bar as a first explanation.
      if (c.secondAngle) {
        const sa = c.secondAngle.steps;
        if (!Array.isArray(sa) || !sa.length)
          errors.push({ where: `${cw}.secondAngle`, msg: 'secondAngle needs a non-empty "steps" array.' });
        else sa.forEach((st, i) => checkStep(st, `${cw}.secondAngle.steps[${i}]`));
      }

      if (!authored) return;   // legacy one-cycle form predates the rules below

      if (!(c.steps || []).length)
        errors.push({ where: cw, msg: 'Cycle has no teach steps.' });

      // Exactly one guided question per cycle. The child's page infers "was
      // this walkthrough seen?" from the question immediately after it, so a
      // cycle with no question is un-resumable-past, not just empty.
      if (!c.q)
        errors.push({ where: cw, msg: 'Cycle has no guided question "q" — every cycle must end in one.' });

      // The concept slug is what makes the stored history readable months
      // later ("digit-times-column needed a second angle three lessons
      // running") instead of "cycle 2 failed again".
      if (!c.concept || !String(c.concept).trim()) {
        errors.push({ where: cw, msg: 'Cycle has no "concept" slug.' });
      } else if (seenConcepts.has(c.concept)) {
        errors.push({ where: cw, msg: `Duplicate concept "${c.concept}" (also ${seenConcepts.get(c.concept)}).` });
      } else {
        seenConcepts.set(c.concept, cw);
      }
      if (!c.conceptName || !String(c.conceptName).trim())
        errors.push({ where: cw, msg: 'Cycle has no "conceptName" (the human-readable concept).' });

      if (!c.secondAngle)
        warnings.push({ where: cw, msg: 'No secondAngle — a wrong answer here gets only the hint ladder.' });

      // Both optional, enrichment-only (header badge name / "up next"
      // preview) — no warning for omitting either, just a sanity length
      // cap on whichever is present so the badge/preview line doesn't wrap
      // or overflow its small fixed space on the page.
      if (c.stepLabel != null && String(c.stepLabel).length > 30)
        errors.push({ where: `${cw}.stepLabel`, msg: `"${c.stepLabel}" is ${String(c.stepLabel).length} chars — keep it under 30, it renders in a small badge.` });
      if (c.upNext != null && String(c.upNext).length > 80)
        errors.push({ where: `${cw}.upNext`, msg: `"${c.upNext}" is ${String(c.upNext).length} chars — keep it under 80, one short preview line.` });

      // goldenRule has rendered on the page since the bubble/figure layout
      // landed but was never checked — optional (no card if absent), length
      // capped like everything else that lives in a small fixed card.
      if (c.goldenRule != null) {
        if (!c.goldenRule.title || !String(c.goldenRule.title).trim())
          errors.push({ where: `${cw}.goldenRule`, msg: 'goldenRule has no "title".' });
        else if (String(c.goldenRule.title).length > 80)
          errors.push({ where: `${cw}.goldenRule.title`, msg: `"${c.goldenRule.title}" is ${String(c.goldenRule.title).length} chars — keep it under 80.` });
        if (c.goldenRule.body != null && String(c.goldenRule.body).length > 200)
          errors.push({ where: `${cw}.goldenRule.body`, msg: `goldenRule.body is ${String(c.goldenRule.body).length} chars — keep it under 200.` });
      }
    });

    if (Array.isArray(session.teach.cycles) && (session.teach.steps || session.teach.tryIt))
      errors.push({ where: 'teach', msg: 'Session mixes teach.cycles with legacy teach.steps/tryIt — use one shape.' });
  }

  if (!items.length) {
    errors.push({ where: 'session', msg: 'No questions found in this session.' });
    return { errors, warnings, resolve, count: 0 };
  }

  const seenIds = new Map();

  for (const { q, where } of items) {
    const tag = `${where}${q.id ? ` (${q.id})` : ''}`;

    if (!q.ask || !String(q.ask).trim()) {
      errors.push({ where: tag, msg: 'Missing "ask" (the question text).' });
      continue;
    }
    if (q.id) {
      if (seenIds.has(q.id))
        errors.push({ where: tag, msg: `Duplicate question id "${q.id}" (also ${seenIds.get(q.id)}).` });
      else seenIds.set(q.id, where);
    } else if (SessionShape.isStaged(session)) {
      // Blocking, not a warning: without an authored id the page falls back to
      // a POSITIONAL id ('q_3'), so inserting a cycle silently renumbers every
      // later question and attaches old attempts to the wrong one.
      errors.push({ where: tag, msg: 'Question has no id (required — positional ids break on insertion).' });
    } else {
      warnings.push({ where: tag, msg: 'Question has no id.' });
    }

    if (q.answer === undefined || q.answer === null || String(q.answer).trim() === '') {
      errors.push({ where: tag, msg: 'Missing "answer".' });
      continue;
    }

    const ans = parseAnswer(q.answer);

    // ── the core check: does the stated answer match the computed one?
    if (ans.kind === 'remainder') {
      const rc = checkRemainder(q.ask, ans);
      if (rc === null) {
        resolve.push({ where: tag, ask: q.ask, answer: q.answer,
          msg: 'Remainder answer on a non-arithmetic question — re-solve by hand.' });
      } else if (!rc.ok) {
        errors.push({ where: tag, msg: `Wrong answer key: ${rc.why}.` });
      }
    } else {
      const computed = evalExpr(q.ask);
      if (computed === null) {
        resolve.push({ where: tag, ask: q.ask, answer: q.answer,
          msg: 'Word problem — cannot verify arithmetically, re-solve cold.' });
      } else if (ans.kind !== 'number') {
        errors.push({ where: tag,
          msg: `"${q.ask}" computes to ${computed} but the answer "${q.answer}" is not a number.` });
      } else if (ans.v !== computed) {
        errors.push({ where: tag,
          msg: `Wrong answer key: "${q.ask}" = ${computed}, but answer says "${q.answer}".` });
      }
    }

    // ── sanity on the answer itself
    if (ans.kind === 'number') {
      if (Math.abs(ans.v) > MAX_REASONABLE)
        warnings.push({ where: tag, msg: `Answer ${ans.v} is very large for primary maths.` });
      const dp = (String(ans.v).split('.')[1] || '').length;
      if (dp > 2)
        warnings.push({ where: tag, msg: `Answer ${ans.v} has ${dp} decimal places — is that intended?` });
    }

    // ── slips: a predicted wrong answer must never be the right answer
    if (q.slips && typeof q.slips === 'object') {
      const normRight = ans.kind === 'number' ? String(ans.v)
                      : ans.kind === 'remainder' ? `${ans.q}r${ans.r}` : String(q.answer).trim();

      for (const key of Object.keys(q.slips)) {
        const sp = parseAnswer(key);
        const normSlip = sp.kind === 'number' ? String(sp.v)
                       : sp.kind === 'remainder' ? `${sp.q}r${sp.r}` : String(key).trim();

        if (normSlip === normRight)
          errors.push({ where: tag,
            msg: `Slip "${key}" is the CORRECT answer — a right answer would be marked wrong.` });

        const sv = q.slips[key];
        if (typeof sv === 'string') continue;                 // bare message is allowed
        if (!sv || typeof sv !== 'object') {
          errors.push({ where: tag, msg: `Slip "${key}" has no message.` });
        } else {
          if (!sv.say || !String(sv.say).trim())
            errors.push({ where: tag, msg: `Slip "${key}" has no "say" text.` });
          if (!sv.code || !String(sv.code).trim())
            warnings.push({ where: tag, msg: `Slip "${key}" has no error code.` });
        }
      }
    }

    if (Array.isArray(q.hints) && q.hints.length === 0)
      warnings.push({ where: tag, msg: 'Empty hints array.' });

    if (q.visual) checkVisual(q.visual, `${tag}.visual`, q.ask, out, false);
    // A picture that prints its own question's answer is a giveaway, not a
    // stimulus. A warning (a tick label can legitimately equal the answer);
    // the hard version is a `mustNotShow` fact, which blocks.
    if (q.visual && q.visual.type === 'scene')
      SceneLib.checkLeak(q.visual, q.answer).forEach((msg) => warnings.push({ where: `${tag}.visual`, msg }));

    // ── q.ollie — per-question override for fresh/wrong/right (optional;
    // absent entirely on every session authored before this). Not strict
    // on which keys exist, but whichever ARE given must follow the same
    // first-person/length rules as every other Ollie line.
    if (q.ollie && typeof q.ollie === 'object') {
      ['fresh', 'wrong', 'right'].forEach((key) => {
        if (q.ollie[key] != null) checkOllieLine(q.ollie[key], `${tag}.ollie.${key}`, out);
      });
    }

    // ── correctVisual / workedVisual — same visual vocabulary as q.visual,
    // shape-checked only (strict=false): neither makes a standalone claim
    // the way a teach step's `big` does, so there's nothing to cross-check
    // them against beyond "is this a well-formed diagram".
    if (q.correctVisual) checkVisual(q.correctVisual, `${tag}.correctVisual`, q.ask, out, false);
    if (q.workedVisual) checkVisual(q.workedVisual, `${tag}.workedVisual`, q.ask, out, false);

    // ── hintVisuals — parallel-indexed to hints[]; null entries are fine
    // (not every hint needs a diagram), but the array itself must not
    // outrun the hints it's attached to.
    if (q.hintVisuals != null) {
      if (!Array.isArray(q.hintVisuals)) {
        errors.push({ where: `${tag}.hintVisuals`, msg: '"hintVisuals" must be an array, parallel to "hints".' });
      } else {
        if (q.hintVisuals.length > (q.hints || []).length)
          errors.push({ where: `${tag}.hintVisuals`, msg: `hintVisuals has ${q.hintVisuals.length} entries but hints has only ${(q.hints || []).length}.` });
        q.hintVisuals.forEach((hv, i) => {
          if (hv) checkVisual(hv, `${tag}.hintVisuals[${i}]`, (q.hints || [])[i], out, false);
        });
      }
    }
  }

  // ── marks/questions length rule from CLAUDE.md
  if (Array.isArray(session.marks) && Array.isArray(session.questions) &&
      session.marks.length !== session.questions.length) {
    errors.push({ where: 'session',
      msg: `marks[] has ${session.marks.length} entries but there are ${session.questions.length} questions.` });
  }

  // ── session.goal — the one-line "what today builds toward" shown in the
  // page footer. Optional (falls back to topicDescription on the page), so
  // a warning rather than an error, and capped since it renders on one line.
  if (session.goal == null || !String(session.goal).trim()) {
    warnings.push({ where: 'session', msg: 'No "goal" — the footer falls back to topicDescription instead of an authored line.' });
  } else if (String(session.goal).length > 100) {
    errors.push({ where: 'session.goal', msg: `"${session.goal}" is ${String(session.goal).length} chars — keep it under 100, it renders on one footer line.` });
  }

  return { errors, warnings, resolve, count: items.length };
}

/* ── reporting ────────────────────────────────────────────────────────────── */

function report(r, file) {
  const line = (sym, o) => console.log(`  ${sym} ${o.where}: ${o.msg}`);
  console.log(`\nverify-session — ${file}`);
  console.log(`  ${r.count} question${r.count === 1 ? '' : 's'} checked\n`);

  if (r.errors.length) {
    console.log(`BLOCKING ERRORS (${r.errors.length}) — do not save this session:`);
    r.errors.forEach((o) => line('✗', o));
    console.log('');
  }
  if (r.resolve.length) {
    console.log(`NEEDS INDEPENDENT RE-SOLVE (${r.resolve.length}) — hand these to the verifier agent:`);
    r.resolve.forEach((o) => console.log(`  ? ${o.where}: ${o.ask}  →  stated "${o.answer}"`));
    console.log('');
  }
  if (r.warnings.length) {
    console.log(`WARNINGS (${r.warnings.length}):`);
    r.warnings.forEach((o) => line('!', o));
    console.log('');
  }
  if (!r.errors.length && !r.resolve.length && !r.warnings.length)
    console.log('All checks passed.\n');
  else if (!r.errors.length)
    console.log(`No blocking errors.${r.resolve.length ? ' Re-solve the questions listed above before saving.' : ''}\n`);
}

/* ── entry ────────────────────────────────────────────────────────────────── */

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--'));

  if (!file) {
    console.error('Usage: node scripts/verify-session.js <session.json> [--json]');
    process.exit(2);
  }

  let session;
  try {
    session = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Could not read ${file}: ${e.message}`);
    process.exit(2);
  }

  // A grading file wraps the new session under "next".
  const target = session.next && typeof session.next === 'object' ? session.next : session;
  const r = verify(target);

  if (asJson) console.log(JSON.stringify({ file, ...r }, null, 2));
  else report(r, file);

  process.exit(r.errors.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { verify, evalExpr, parseAnswer, checkRemainder };
