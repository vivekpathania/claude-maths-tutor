/* speech.js — what Ollie SAYS, and what each recording is CALLED.
 *
 * Loaded two ways, same file, same pattern as session-shape.js and scene.js:
 *   browser — <script src="/speech.js"></script>   → window.Speech
 *   node    — require('../public/speech.js')       → module.exports
 *
 * Two jobs, and they must agree exactly between the tool that renders the audio
 * (tools/voice, on the parent's Mac) and the page that plays it:
 *
 *   speakable(text)   the words to be spoken, from the text as it is shown.
 *   clipKey(text, v)  the name of the recording of those words, in voice v.
 *
 * The page never asks the server "do you have audio for this line?" and never
 * carries an id for a line. It works out the key from the text on screen and looks
 * it up in /audio/manifest.json. That is what makes the bank, authored lines and
 * (later) generated lines all work the same way: a line is its words. Edit a line
 * and it has a new key, so it gets new audio by itself; change the voice and every
 * key changes with it. See docs/voice.md.
 *
 * The key is a small synchronous hash, not crypto.subtle: that is async, and the
 * page's renderers build their HTML synchronously. It is not for security — at a
 * few thousand clips a 53-bit hash will not collide, and the render tool checks.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Speech = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Bump when speakable() starts producing different words for the same text:
  // every key changes, so every recording is made again. Part of every key.
  var VERSION = 1;

  var NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  var DEN = { 2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['quarter', 'quarters'], 5: ['fifth', 'fifths'],
              6: ['sixth', 'sixths'], 7: ['seventh', 'sevenths'], 8: ['eighth', 'eighths'], 9: ['ninth', 'ninths'],
              10: ['tenth', 'tenths'], 11: ['eleventh', 'elevenths'], 12: ['twelfth', 'twelfths'] };
  var UNITS = { cm: 'centimetres', mm: 'millimetres', km: 'kilometres', kg: 'kilograms', ml: 'millilitres' };

  // word → how to spell it so the voice says it right. EMPTY ON PURPOSE: an entry
  // is a guess about a voice's mistake, and a wrong guess makes a good word worse.
  // Add one only after hearing the word said wrong (the spike's respellings of
  // "isosceles" and "equilateral" were never confirmed).
  var RESPELL = {};

  function speakable(text) {
    var s = String(text == null ? '' : text);
    s = s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    // emoji and pictographs are decoration, not words
    s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ');
    s = s.replace(/(\d)\s*[–]\s*(\d)/g, '$1 to $2');                // 5–10 → "5 to 10"
    s = s.replace(/\s*[—–]\s*/g, ', ');                        // a dash is a pause
    s = s.replace(/(\d+)\s*\/\s*(\d+)/g, function (m, a, b) {            // 3/4 → "three quarters"
      var n = +a, d = +b;
      if (n <= 12 && DEN[d]) return NUM[n] + ' ' + DEN[d][n === 1 ? 0 : 1];
      return a + ' over ' + b;
    });
    s = s.replace(/\?\s*\/\s*(\d+)/g, function (m, d) { return 'what over ' + d; });   // the blank in 1/3 = ?/6
    s = s.replace(/£\s*(\d+)(?:\.(\d{2}))?/g, function (m, p, c) {  // £1.50 → "1 pound 50"
      var pounds = +p, pence = c ? +c : 0, out = [];
      if (pounds) out.push(pounds + (pounds === 1 ? ' pound' : ' pounds'));
      if (pence) out.push(pence + (pounds ? '' : ' pence'));
      return out.join(' ') || '0 pounds';
    });
    s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent');
    s = s.replace(/°/g, ' degrees');
    s = s.replace(/(^|[\s(])[−-](?=\d)/g, '$1minus ');              // −3 → "minus 3"
    s = s.replace(/\s[−-]\s/g, ' minus ');                          // 3 − 5
    s = s.replace(/×/g, ' times ').replace(/÷/g, ' divided by ')
         .replace(/\+/g, ' plus ').replace(/=/g, ' equals ');
    s = s.replace(/\b(cm|mm|km|kg|ml)\b/g, function (m) { return UNITS[m]; });
    for (var w in RESPELL) if (Object.prototype.hasOwnProperty.call(RESPELL, w))
      s = s.replace(new RegExp('\\b' + w + '\\b', 'gi'), RESPELL[w]);
    return s.replace(/’/g, "'").replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  }

  // cyrb53 — a well-known public-domain 53-bit string hash. Synchronous, and the
  // same bytes in node and in a browser.
  function cyrb53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, ch;
    for (var i = 0; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  // The name of the recording of `text` in `voice`: 14 hex characters, or null when
  // there is nothing to say. Hashes the SPEAKABLE words, so two displays that are
  // spoken identically share one recording.
  function clipKey(text, voice) {
    var s = speakable(text);
    if (!s || !voice) return null;
    var hex = cyrb53(VERSION + '|' + voice + '|' + s).toString(16);
    return ('00000000000000' + hex).slice(-14);
  }

  return { VERSION: VERSION, speakable: speakable, clipKey: clipKey, cyrb53: cyrb53 };
});
