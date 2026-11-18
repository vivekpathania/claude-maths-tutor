/* ollie-clues.js — the clue area under the answer box, and the rules for
 * when help appears. Ollie talks about the clues; the clues themselves live
 * here, in the question card, so the child can re-read them while answering.
 *
 * Needs: ollie-dock.js (for Ollie's lines) and ollie.css.
 *   browser — <script src="/ollie/ollie-clues.js"></script> → window.OllieClues
 *
 * The rules (one track per question):
 *   1st wrong try   → Ollie: wrong.first. Clues unlock; nothing shown yet.
 *   help tapped     → next unseen clue, Ollie reads it (clue.first / clue.last).
 *   2nd+ wrong try  → next unseen clue automatically (wrong.again).
 *   no clues left   → "Show me how": onShowMe() is called (wrong.stuck / showme.start).
 *   correct         → right.first only if no wrong try and no help used.
 * In the assessment register there are no clues: the area stays empty and
 * Ollie only uses presence lines.
 *
 *   var clues = OllieClues.create({
 *     container: document.querySelector('#clue-area'),
 *     clues: question.hints,             // authored per question
 *     dock: dock,
 *     register: 'practice',
 *     onShowMe: function () { renderWalkthrough(); }
 *   });
 *   // on Check:
 *   if (isRight) { var r = clues.correct(); progress.mark(r.firstTry ? 'star' : 'with-help'); }
 *   else clues.wrongTry();
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OllieClues = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var ICON_BULB = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>';
  var ICON_LOCK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  var ICON_EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var ICON_PREV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7"/></svg>';
  var BARS = '<span class="ollie-clue__bars" aria-hidden="true"><span></span><span></span><span></span></span>';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function create(opts) {
    opts = opts || {};
    var el = opts.container;
    var dock = opts.dock;
    var register = opts.register || 'practice';
    var noHelp = register === 'assessment';
    var list = (opts.clues || []).slice();
    var tries = 0, shown = 0, view = 0, usedHelp = false, showingMe = false;

    function say(moment, o) { if (dock) dock.say(moment, o); }

    function render() {
      if (!el) return;
      if (noHelp || showingMe || !list.length) { el.innerHTML = ''; el.hidden = true; return; }
      el.hidden = false;
      var html = '';
      var locked = tries === 0 && shown === 0;
      if (locked) {
        html += '<div class="ollie-clues__locked">' + ICON_LOCK +
          '<span class="ollie-clues__locked-text">Clues open after your first try</span>' +
          '<span class="ollie-chip">' + list.length + (list.length === 1 ? ' clue' : ' clues') + ' ready</span></div>';
      }
      if (shown > 0) {
        html += '<div class="ollie-clue" data-clue="' + view + '">' +
          '<div class="ollie-clue__head">' +
            '<span class="ollie-clue__label">' + ICON_BULB + 'Ollie’s clue ' + (view + 1) + ' of ' + list.length + '</span>' +
            '<span class="ollie-clue__reading">' + BARS + 'Ollie is reading this</span>' +
            (shown > 1
              ? '<span class="ollie-clue__nav">' +
                  '<button type="button" class="ollie-clue__flip" data-flip="-1" aria-label="Previous clue"' + (view === 0 ? ' disabled' : '') + '>' + ICON_PREV + '</button>' +
                  '<button type="button" class="ollie-clue__flip" data-flip="1" aria-label="Next clue"' + (view >= shown - 1 ? ' disabled' : '') + '>' + ICON_NEXT + '</button>' +
                '</span>'
              : '') +
          '</div>' +
          '<p class="ollie-clue__text">' + esc(list[view]) + '</p>' +
        '</div>';
      }
      if (!locked) {
        var left = list.length - shown;
        var label, badge, icon;
        if (left > 0) {
          label = shown === 0 ? 'Need a hand?' : 'Another clue';
          badge = shown === 0 ? left + (left === 1 ? ' clue' : ' clues') : left + ' left';
          icon = ICON_BULB;
        } else { label = 'Show me how'; badge = 'Step by step'; icon = ICON_EYE; }
        html += '<button type="button" class="ollie-clue-btn" data-help>' + icon + '<span>' + label + '</span><span class="ollie-chip">' + badge + '</span></button>';
      }
      el.innerHTML = html;
    }

    function clueBox() { return el ? el.querySelector('.ollie-clue') : null; }

    function reveal(moment) {
      if (shown >= list.length) return showMe(moment === 'wrong.again' ? 'wrong.stuck' : 'showme.start');
      shown++; view = shown - 1; usedHelp = true;
      render();
      var m = moment || (shown === list.length && shown > 1 ? 'clue.last' : 'clue.first');
      say(m, { append: list[view], readingEl: clueBox() });
    }

    function showMe(moment) {
      showingMe = true; usedHelp = true;
      render();
      say(moment || 'showme.start');
      if (opts.onShowMe) opts.onShowMe();
    }

    function onClick(e) {
      var flip = e.target.closest && e.target.closest('[data-flip]');
      if (flip) {
        view = Math.max(0, Math.min(shown - 1, view + Number(flip.getAttribute('data-flip'))));
        render();
        return;
      }
      if (e.target.closest && e.target.closest('[data-help]')) reveal(null);
    }
    if (el) el.addEventListener('click', onClick);

    render();

    return {
      /* call after each wrong answer */
      wrongTry: function () {
        tries++;
        if (noHelp) { say(tries === 1 ? 'wrong.first' : tries === 2 ? 'wrong.again' : 'wrong.stuck'); return 'none'; }
        if (showingMe) { say('wrong.again'); return 'showme'; }
        if (tries === 1) { render(); say('wrong.first'); return 'unlocked'; }
        if (shown < list.length) { reveal('wrong.again'); return 'clue'; }
        showMe('wrong.stuck'); return 'showme';
      },
      /* call when the answer is right; returns what the progress marker should show */
      correct: function () {
        var firstTry = tries === 0 && !usedHelp;
        say(firstTry ? 'right.first' : 'right.recovered');
        if (el) { el.innerHTML = ''; el.hidden = true; }
        return { firstTry: firstTry, usedHelp: usedHelp, tries: tries, cluesUsed: shown, showedMe: showingMe };
      },
      /* call after the walkthrough, when the child should type the answer */
      yourTurn: function () { say('showme.yourTurn'); },
      help: function () { if (!noHelp && (tries > 0 || shown > 0)) reveal(null); },
      reset: function (newClues) {
        list = (newClues || list).slice(); tries = 0; shown = 0; view = 0; usedHelp = false; showingMe = false; render();
      },
      state: function () { return { tries: tries, shown: shown, usedHelp: usedHelp, showingMe: showingMe }; },
      destroy: function () { if (el) { el.removeEventListener('click', onClick); el.innerHTML = ''; } }
    };
  }

  return { create: create };
});
