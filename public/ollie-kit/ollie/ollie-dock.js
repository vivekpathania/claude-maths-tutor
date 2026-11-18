/* ollie-dock.js — where Ollie lives on the child's page.
 *
 * Needs: ollie-character.js, ollie-lines.js, ollie.css.
 *   browser — <script src="/ollie/ollie-dock.js"></script> → window.OllieDock
 *
 * Layout (handled by ollie.css):
 *   1200px and wider  docked in the bottom-left margin; the page keeps a
 *                     340px rail free (add class "ollie-content" to <main>).
 *   below 1200px      a strip along the bottom; the page keeps room for it.
 *   keyboard open     on touch devices the strip hides and Ollie speaks by
 *                     voice only, so he never covers the answer box.
 *
 * Behaviour:
 *   - The bubble appears when Ollie speaks and fades a moment after he
 *     finishes. No buttons inside it.
 *   - The speaker button (or tapping Ollie) replays the last line.
 *   - The captions button turns the bubble off for children who only listen.
 *   - A new line always stops the current one; Ollie never talks over himself.
 *   - Typing or tapping resets the "still with me?" idle nudge.
 *
 *   var dock = OllieDock.mount({ register: 'practice', name: 'Sam' });
 *   startButton.onclick = function(){ dock.unlock(); dock.say('open'); };
 *   dock.say('wrong.first');
 *   dock.say('clue.first', { append: clueText, readingEl: clueBox });
 *   dock.sayText('Any authored line', { mood: 'point', audioUrl: '/audio/x.mp3' });
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OllieDock = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var ICON_CAPTIONS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M7 10h10M7 13h6"/></svg>';
  var ICON_SPEAKER = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>';

  var PREF_KEY = 'ollie.captions';
  var MS_PER_CHAR = 55;        // estimate when no audio length is known
  var MIN_VISIBLE = 3500;      // bubble never shorter than this
  var LINGER_AFTER = 1500;     // bubble stays this long after he stops

  function readPref(fallback) {
    try { var v = localStorage.getItem(PREF_KEY); return v === null ? fallback : v === '1'; }
    catch (e) { return fallback; }
  }
  function writePref(on) { try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch (e) {} }

  function mount(opts) {
    opts = opts || {};
    var Lines = opts.lines || (typeof window !== 'undefined' && window.OllieLines);
    var Character = opts.character || (typeof window !== 'undefined' && window.OllieCharacter);
    if (!Lines || !Character) throw new Error('OllieDock needs OllieLines and OllieCharacter loaded first.');

    var container = opts.container || document.body;
    var register = opts.register || 'practice';
    var name = opts.name || '';
    var voiceMode = opts.voice || 'speech';           // 'speech' | 'audio-only' | 'none'
    var captions = readPref(opts.captions !== false);
    var idleAfter = opts.idleAfterMs == null ? 45000 : opts.idleAfterMs;

    // ---- DOM
    var root = document.createElement('div');
    root.className = 'ollie-dock';
    root.innerHTML =
      '<div class="ollie-dock__bubble" role="status" aria-live="polite" hidden><p class="ollie-dock__text"></p></div>' +
      '<div class="ollie-dock__bar">' +
        '<button type="button" class="ollie-dock__ollie" aria-label="Hear Ollie again"></button>' +
        '<div class="ollie-dock__controls">' +
          '<button type="button" class="ollie-dock__btn" data-action="captions" aria-label="Show Ollie’s words" aria-pressed="true">' + ICON_CAPTIONS + '</button>' +
          '<button type="button" class="ollie-dock__btn ollie-dock__btn--replay" data-action="replay" aria-label="Hear Ollie again">' + ICON_SPEAKER + '</button>' +
        '</div>' +
      '</div>';
    container.appendChild(root);
    document.body.classList.add('ollie-docked');

    var bubble = root.querySelector('.ollie-dock__bubble');
    var textEl = root.querySelector('.ollie-dock__text');
    var ollieBtn = root.querySelector('.ollie-dock__ollie');
    var captionsBtn = root.querySelector('[data-action="captions"]');
    var replayBtn = root.querySelector('[data-action="replay"]');

    var ollie = Character.create({ size: opts.size || 104, mood: 'wave' });
    ollieBtn.appendChild(ollie.el);

    // ---- state
    var current = null;     // { text, mood, opts }
    var token = 0;          // guards callbacks from an older line
    var audio = null;
    var hideTimer = null, endTimer = null, leaveTimer = null, idleTimer = null;
    var shownAt = 0;
    var speaking = false;
    var readingEl = null;

    function setCaptions(on) {
      captions = !!on;
      writePref(captions);
      captionsBtn.setAttribute('aria-pressed', captions ? 'true' : 'false');
      if (!captions) hideBubble(true);
      else if (speaking && current) showBubble(current.text);
    }

    function showBubble(text) {
      clearTimeout(hideTimer); clearTimeout(leaveTimer);
      textEl.textContent = text;
      bubble.classList.remove('is-leaving');
      if (!captions) return;
      bubble.hidden = false;
      // restart the pop-in animation
      bubble.classList.remove('is-entering'); void bubble.offsetWidth; bubble.classList.add('is-entering');
      shownAt = Date.now();
    }

    function hideBubble(now) {
      clearTimeout(hideTimer); clearTimeout(leaveTimer);
      if (bubble.hidden) return;
      if (now) { bubble.hidden = true; bubble.classList.remove('is-leaving'); return; }
      bubble.classList.add('is-leaving');
      leaveTimer = setTimeout(function () { bubble.hidden = true; bubble.classList.remove('is-leaving'); }, 360);
    }

    function setReading(el) {
      if (readingEl && readingEl !== el) readingEl.classList.remove('is-being-read');
      readingEl = el || null;
      if (readingEl) readingEl.classList.add('is-being-read');
    }

    function stop() {
      token++;
      clearTimeout(endTimer);
      if (audio) { try { audio.pause(); } catch (e) {} audio = null; }
      if (typeof speechSynthesis !== 'undefined') { try { speechSynthesis.cancel(); } catch (e) {} }
      speaking = false;
      ollie.talk(false);
      setReading(null);
    }

    function finished(myToken) {
      if (myToken !== token) return;
      speaking = false;
      ollie.talk(false);
      setReading(null);
      var visibleFor = Date.now() - shownAt;
      var wait = Math.max(LINGER_AFTER, MIN_VISIBLE - visibleFor);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { hideBubble(false); }, wait);
      resetIdle();
    }

    function pickVoice() {
      if (typeof speechSynthesis === 'undefined') return null;
      var voices = speechSynthesis.getVoices() || [];
      var want = opts.voiceName;
      for (var i = 0; i < voices.length; i++) if (want && voices[i].name === want) return voices[i];
      for (var j = 0; j < voices.length; j++) if (/^en-GB/i.test(voices[j].lang)) return voices[j];
      for (var k = 0; k < voices.length; k++) if (/^en/i.test(voices[k].lang)) return voices[k];
      return null;
    }

    function play(text, o, myToken) {
      var estimate = 600 + text.length * MS_PER_CHAR;
      function fallback() { endTimer = setTimeout(function () { finished(myToken); }, estimate); }

      if (o.audioUrl && voiceMode !== 'none') {
        audio = new Audio(o.audioUrl);
        audio.addEventListener('ended', function () { finished(myToken); });
        audio.addEventListener('error', function () { if (myToken === token) fallback(); });
        var p = audio.play();
        if (p && p.catch) p.catch(function () { if (myToken === token) fallback(); });
        return;
      }
      if (voiceMode === 'speech' && typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
        var u = new SpeechSynthesisUtterance(text);
        var v = pickVoice(); if (v) u.voice = v;
        u.lang = (v && v.lang) || 'en-GB';
        u.rate = opts.speechRate || 0.95;
        u.pitch = opts.speechPitch || 1.05;
        u.onend = function () { finished(myToken); };
        u.onerror = function () { if (myToken === token) fallback(); };
        try { speechSynthesis.speak(u); } catch (e) { fallback(); }
        // some browsers never fire onend: cap it
        endTimer = setTimeout(function () { finished(myToken); }, estimate * 2 + 2000);
        return;
      }
      fallback();
    }

    /* sayText(text, o) — say any line. o.mood, o.audioUrl, o.readingEl */
    function sayText(text, o) {
      o = o || {};
      if (!text) return;
      stop();
      var myToken = token;
      current = { text: text, mood: o.mood || 'neutral', opts: o };
      ollie.setMood(current.mood);
      showBubble(text);
      speaking = true;
      ollie.talk(true);
      setReading(o.readingEl);
      clearTimeout(idleTimer);
      play(text, o, myToken);
    }

    /* say(moment, o) — pick from the line bank. o.append adds authored text
     * (a clue, a hint) after the bank line; o.ctx is passed to pick(). */
    function say(moment, o) {
      o = o || {};
      var ctx = o.ctx || {}; if (name && ctx.name == null) ctx.name = name;
      var line = Lines.pick(register, moment, ctx);
      var text = o.append ? line + ' ' + o.append : line;
      var mood = o.mood || (Lines.mood ? Lines.mood(register, moment) : 'neutral');
      sayText(text, { mood: mood, audioUrl: o.audioUrl, readingEl: o.readingEl });
      return line;
    }

    function replay() {
      if (!current) return;
      sayText(current.text, current.opts && { mood: current.mood, audioUrl: current.opts.audioUrl, readingEl: current.opts.readingEl });
    }

    // ---- idle nudge
    function resetIdle() {
      clearTimeout(idleTimer);
      if (!idleAfter) return;
      idleTimer = setTimeout(function () { if (!speaking) say('idle'); }, idleAfter);
    }
    function onActivity() { if (!speaking) resetIdle(); }
    document.addEventListener('input', onActivity, true);
    document.addEventListener('keydown', onActivity, true);
    document.addEventListener('pointerdown', onActivity, true);

    // ---- on-screen keyboard (strip layout, touch devices)
    var vv = typeof window !== 'undefined' ? window.visualViewport : null;
    function checkKeyboard() {
      if (!vv) return;
      var open = window.innerHeight - vv.height > 150;
      root.classList.toggle('is-keyboard', open);
    }
    if (vv) vv.addEventListener('resize', checkKeyboard);

    // ---- controls
    ollieBtn.addEventListener('click', replay);
    replayBtn.addEventListener('click', replay);
    captionsBtn.addEventListener('click', function () { setCaptions(!captions); });
    setCaptions(captions);

    /* unlock() — call from the first tap of the session (the start button).
     * Browsers block sound until the child has interacted with the page. */
    function unlock() {
      if (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
        try { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
      }
    }

    function destroy() {
      stop(); clearTimeout(hideTimer); clearTimeout(leaveTimer); clearTimeout(idleTimer);
      document.removeEventListener('input', onActivity, true);
      document.removeEventListener('keydown', onActivity, true);
      document.removeEventListener('pointerdown', onActivity, true);
      if (vv) vv.removeEventListener('resize', checkKeyboard);
      document.body.classList.remove('ollie-docked');
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    resetIdle();

    return {
      el: root,
      character: ollie,
      say: say,
      sayText: sayText,
      replay: replay,
      stop: stop,
      unlock: unlock,
      setCaptions: setCaptions,
      setRegister: function (r) { register = r; },
      setName: function (n) { name = n || ''; },
      isSpeaking: function () { return speaking; },
      destroy: destroy
    };
  }

  return { mount: mount };
});
