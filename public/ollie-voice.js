/* ollie-voice.js — the glue between the Ollie kit (public/ollie-kit) and Ollie's
 * recorded voice (tools/voice, docs/voice.md). Page-only. The kit is not edited; this
 * file does the three things its options cannot:
 *
 *   1. Recordings. The dock plays an `audioUrl` only when the caller passes one, and the
 *      clue track calls `dock.say()` itself. So OllieClues is handed the speaker below
 *      instead of the dock: it picks the line, finds its recording by the words
 *      (Speech.clipKey, speech.js) and calls dock.sayText() with the audioUrl. A line
 *      with no recording is silent — never the browser's robot voice (voice: 'audio-only').
 *   2. iPad. The dock makes a new Audio() for every line, and Safari only lets a
 *      brand-new element play inside a tap. The first tap anywhere starts ONE shared
 *      element on silence, and from then on `new Audio(url)` hands that element back.
 *   3. Pacing. Chains (a greeting, then the screen's own line) wait for each other.
 *
 * Any failure is silent: no manifest, a clip that will not load, no audio support.
 * The lesson never depends on this file.
 */
(function () {
  var manifest = null;              // the bank: { voice, version, clips: { key: text } }
  var sess = null;                  // this session's own clips: { voice, set: { key: true } }
  var blobs = {}, inflight = {};
  var api = null;
  var dock = null, Lines = null, register = 'practice', name = '', question = null;
  var chainToken = 0, quiet = false;
  var muted = false, rec = [];   // rec: what he said on THIS screen, for the speaker button
  var MUTE_KEY = 'ollie.muted';
  var ICON_ON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  var ICON_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ── 2. one shared <audio> element ────────────────────────────────── */
  var NativeAudio = window.Audio, shared = null, silentUrl = null;

  // 0.1 s of silence, built here rather than pasted in as an opaque string.
  function silence() {
    if (silentUrl) return silentUrl;
    var n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf), i;
    function w(o, s) { for (var j = 0; j < s.length; j++) v.setUint8(o + j, s.charCodeAt(j)); }
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, 'data'); v.setUint32(40, n, true);
    for (i = 0; i < n; i++) v.setUint8(44 + i, 128);
    silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return silentUrl;
  }

  function unlock() {
    if (shared || !NativeAudio) return;
    try {
      var a = new NativeAudio();
      a.preload = 'auto';
      a.src = silence();
      shared = a;
      var p = a.play();
      if (p && p.then) p.then(function () { if (a.src === silentUrl) a.pause(); },
        function (e) { if (e && e.name === 'NotAllowedError' && shared === a) shared = null; });
    } catch (e) { shared = null; }
  }

  if (NativeAudio) {
    window.Audio = function (src) {
      if (!shared) return new NativeAudio(src);
      try { shared.pause(); } catch (e) { /* nothing playing */ }
      if (src) shared.src = src;
      return shared;
    };
    document.addEventListener('click', unlock, true);
    document.addEventListener('touchend', unlock, true);
  }

  /* ── 1. recordings ────────────────────────────────────────────────── */
  function fetchClip(key, bank) {
    if (blobs[key]) return Promise.resolve(blobs[key]);
    if (inflight[key]) return inflight[key];
    if (!bank && !api) return Promise.reject(new Error('no api'));
    inflight[key] = (bank ? fetch('/audio/bank/' + key + '.m4a') : api('/api/audio/' + key))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function (b) { blobs[key] = URL.createObjectURL(b); delete inflight[key]; return blobs[key]; })
      .catch(function (e) { delete inflight[key]; throw e; });
    return inflight[key];
  }

  // Which clip says this exact text: { key, bank } or null.
  function clipOf(text) {
    if (typeof Speech === 'undefined') return null;
    var k;
    if (manifest) { k = Speech.clipKey(text, manifest.voice); if (k && has(manifest.clips, k)) return { key: k, bank: true }; }
    if (sess) { k = Speech.clipKey(text, sess.voice); if (k && sess.set[k]) return { key: k, bank: false }; }
    return null;
  }

  // Play only what is fully downloaded: a clip streamed straight from the network starts
  // before it can finish, and on a slow connection Ollie's lines get cut or skipped.
  // Resolves with a blob URL, or after `ms` with the best fallback (the bank file by URL,
  // streamed; a session clip has none, so captions only). The download carries on either way.
  function clipReady(text, ms) {
    var c = clipOf(text);
    if (!c) return Promise.resolve(null);
    if (blobs[c.key]) return Promise.resolve(blobs[c.key]);
    var fallback = c.bank ? '/audio/bank/' + c.key + '.m4a' : null;
    return new Promise(function (resolve) {
      var t = setTimeout(function () { resolve(fallback); }, ms);
      fetchClip(c.key, c.bank).then(function (u) { clearTimeout(t); resolve(u); }, function () { clearTimeout(t); resolve(fallback); });
    });
  }

  // The URL to play for this exact text, or null. A session clip that has not arrived yet
  // is fetched for next time and this line goes out as captions only.
  function audioFor(text) {
    var c = clipOf(text);
    if (!c) return null;
    if (blobs[c.key]) return blobs[c.key];
    fetchClip(c.key, c.bank).catch(function () {});
    return null;
  }

  var OllieVoice = {
    // Resolves either way — a missing manifest just means "no bank voice".
    init: function () {
      return fetch('/audio/manifest.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) {
          if (!m || !m.clips || !m.voice) return;
          if (typeof Speech === 'undefined' || m.version !== Speech.VERSION) {
            if (window.console) console.warn('Ollie voice: manifest version ' + m.version + ' does not match speech.js — bank voice off until it is re-rendered.');
            return;
          }
          manifest = m;
        })
        .catch(function () { /* no voice */ });
    },

    // This session's own clips (teacher-written lines), from the session document.
    setSession: function (audio, apiFetch) {
      api = apiFetch || api;
      sess = null;
      if (!audio || !audio.clips || !audio.voice || typeof Speech === 'undefined' || audio.version !== Speech.VERSION) return;
      var set = {};
      audio.clips.forEach(function (k) { set[k] = true; });
      sess = { voice: audio.voice, set: set };
      var todo = Object.keys(set), i = 0;
      function next() { if (i < todo.length) fetchClip(todo[i++]).then(next, next); }
      next(); next(); next(); next(); next(); next();
    },

    // The whole bank is ~3.5 MB: pull it in the background so a line is already on the
    // device by the time Ollie needs it. Call once the first screen is up.
    prefetchBank: function () {
      if (!manifest) return;
      var todo = Object.keys(manifest.clips), i = 0;
      function next() { if (i < todo.length) fetchClip(todo[i++], true).then(next, next); }
      next(); next(); next(); next();
    },

    // Younger children hear him by default; from 12 he is captions only (docs/mascot.md §6).
    voiceMode: function (age) { return age != null && age > 11 ? 'none' : 'audio-only'; },

    audioFor: audioFor,

    // What the shared element is doing (for tests; asking never disturbs it).
    nowPlaying: function () { return shared ? { src: shared.src, playing: !shared.paused && !shared.ended, ended: shared.ended, t: shared.currentTime } : null; },

    /* ── 3. the speaker: what the page and OllieClues talk to ─────── */
    attach: function (d, o) {
      o = o || {};
      dock = d; Lines = window.OllieLines;
      register = o.register || 'practice'; name = o.name || '';
      watchIdle(o.idleAfterMs == null ? 45000 : o.idleAfterMs);
      // He never speaks without his bubble: captions are always on, and "quiet" is a mute
      // button instead (the bubble stays, the sound goes).
      d.setCaptions(true);
      try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { muted = false; }
      var ctl = d.el.querySelector('.ollie-dock__controls'), mb = document.createElement('button');
      mb.type = 'button'; mb.className = 'ollie-dock__btn'; mb.setAttribute('data-action', 'mute');
      function paintMute() {
        mb.innerHTML = muted ? ICON_OFF : ICON_ON;
        mb.setAttribute('aria-pressed', muted ? 'true' : 'false');
        mb.setAttribute('aria-label', muted ? 'Turn Ollie’s sound on' : 'Turn Ollie’s sound off');
      }
      paintMute();
      mb.addEventListener('click', function () {
        muted = !muted; paintMute();
        try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {}
        if (dock.isSpeaking() && rec.length) speaker.replay();   // same line, now with or without sound
      });
      if (ctl) ctl.insertBefore(mb, ctl.firstChild);
      // The kit gives replay the same speaker icon as sound; make it a circular arrow.
      var rb = d.el.querySelector('[data-action="replay"]');
      if (rb) rb.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/><path d="M10.5 9.2v5.6l4.5-2.8z" fill="currentColor"/></svg>';
      // The kit's speaker button replays whatever it said last, even on an earlier screen.
      // Ours replays this screen's lines.
      d.el.addEventListener('click', function (e) {
        if (!e.target.closest || !e.target.closest('.ollie-dock__ollie, [data-action="replay"]')) return;
        e.stopImmediatePropagation(); speaker.replay();
      }, true);
      // The dock lights up while he speaks (ollie.css has no style for that; theme.css does).
      var svg = d.el.querySelector('svg[data-talking]');
      if (svg && window.MutationObserver) {
        new MutationObserver(function () { d.el.classList.toggle('is-speaking', svg.getAttribute('data-talking') === 'true'); })
          .observe(svg, { attributes: true, attributeFilter: ['data-talking'] });
      }
      return speaker;
    }
  };

  // q.ollie — an authored line for THIS question, in place of the bank line
  // (docs/mascot.md §1). Only the plain content moments take one.
  var RIGHTISH = { 'right.first': 1, 'right.recovered': 1, comeback: 1, streak: 1 };
  function authored(moment) {
    var qo = question && question.ollie;
    if (!qo) return '';
    var key = moment.indexOf('wrong.') === 0 ? 'wrong' : RIGHTISH[moment] ? 'right' : moment === 'fresh' ? 'fresh' : '';
    var line = key && qo[key];
    return (line && String(line).trim()) || '';
  }

  var loading = 0;   // lines waiting on their download; a chain must not move on meanwhile

  function sayText(text, o) {
    o = o || {};
    if (!dock || !text) return;
    if (!o.norec) rec.push({ text: text, o: o });
    // No bubble, no sound: with the on-screen keyboard open the dock is hidden.
    var hidden = dock.el.classList.contains('is-keyboard');
    function go(url) {
      dock.sayText(text, { mood: o.mood, audioUrl: muted || hidden ? null : url, readingEl: o.readingEl });
      // Text already on screen (a clue box, tagged "Ollie is reading this") needs no bubble repeating it.
      if (o.readingEl) hideBubble();
    }
    var url = muted || hidden ? null : audioFor(text);
    if (url || muted || hidden || !clipOf(text)) return go(url);
    // The clip is still downloading: hold the bubble and the voice until it lands, so they
    // start together and the whole line plays. A newer line cancels this one.
    var tok = chainToken; loading++;
    clipReady(text, 4000).then(function (u) {
      loading--;
      if (tok === chainToken) go(u);
    });
  }

  function sayNow(moment, o) {
    o = o || {};
    if (!dock) return;
    if (speaker.remap) moment = speaker.remap(moment) || moment;
    var ctx = {}; if (name && register !== 'assessment') ctx.name = name;
    var line = (!o.append && authored(moment)) || Lines.pick(register, moment, ctx);
    var mood = o.mood || (Lines.mood ? Lines.mood(register, moment) : 'neutral');
    if (o.append) {
      // A bank line, then the authored text (a clue). Two recordings that already exist, not
      // one new recording per pairing; the clue box is highlighted while he reads the clue.
      speaker.chain([{ text: line, o: { mood: mood } }, { text: o.append, o: { mood: mood, readingEl: o.readingEl } }]);
      return;
    }
    sayText(line, { mood: mood, readingEl: o.readingEl });
  }

  function hideBubble() { var b = dock.el.querySelector('.ollie-dock__bubble'); if (b) b.hidden = true; }

  var speaker = {
    remap: null,                                             // the page may swap a moment (streak, comeback)
    canIdle: null,                                           // the page says when a nudge makes sense
    say: function (moment, o) { if (quiet) return; chainToken++; rec = []; sayNow(moment, o); },
    sayText: function (text, o) { if (quiet) return; chainToken++; rec = []; sayText(text, o); },
    // Replaying earlier state (a reload mid-question) must not make him speak.
    quietly: function (fn) { quiet = true; try { fn(); } finally { quiet = false; } },
    // Speak the first now; each next one when the one before has finished.
    // Any other line, or stop(), cancels the rest.
    // items: [{ moment, o }] or [{ text, o }]
    chain: function (items, keep) {
      var my = ++chainToken, i = 0;
      if (!keep) rec = [];
      function one() {
        if (my !== chainToken || i >= items.length) return;
        var it = items[i++];
        if (it.text) sayText(it.text, it.o); else sayNow(it.moment, it.o);
        wait();
      }
      function wait() {
        setTimeout(function () {
          if (my !== chainToken) return;
          if (dock.isSpeaking() || loading) return wait();
          setTimeout(one, 350);
        }, 150);
      }
      one();
    },
    stop: function () { chainToken++; if (dock) { dock.stop(); hideBubble(); } },
    // A new question or step: forget the old screen's lines and clear a bubble left over from them.
    newScreen: function () { rec = []; if (dock && !dock.isSpeaking()) hideBubble(); },
    // The speaker button: this screen's lines again, or a plain nudge if he said nothing here.
    replay: function () {
      if (!dock) return;
      if (!rec.length) { chainToken++; sayNow('fresh'); return; }
      var items = rec.map(function (it) { var o = {}, k; for (k in it.o || {}) o[k] = it.o[k]; o.norec = true; return { text: it.text, o: o }; });
      speaker.chain(items, true);
    },
    setQuestion: function (q) { question = q || null; },
    setRegister: function (r) { register = r; if (dock) dock.setRegister(r); },
    setName: function (n) { name = n || ''; },
    isSpeaking: function () { return !!dock && dock.isSpeaking(); }
  };

  // The dock has its own "still with me?" nudge, but it says it with no recording. Run it
  // here instead (the page mounts the dock with idleAfterMs: 0).
  function watchIdle(ms) {
    if (!ms) return;
    var last = Date.now();
    function touch() { last = Date.now(); }
    ['input', 'keydown', 'pointerdown'].forEach(function (ev) { document.addEventListener(ev, touch, true); });
    setInterval(function () {
      if (!dock || dock.isSpeaking() || Date.now() - last < ms) return;
      if (speaker.canIdle && !speaker.canIdle()) { last = Date.now(); return; }   // not on the last screen
      last = Date.now();
      sayNow('idle');
    }, 2000);
  }

  window.OllieVoice = OllieVoice;
})();
