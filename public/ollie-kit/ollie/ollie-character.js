/* ollie-character.js — Coach Ollie as one animatable inline SVG.
 *
 * Loaded the same way as ollie-lines.js:
 *   browser — <script src="/ollie/ollie-character.js"></script> → window.OllieCharacter
 *   node    — require('./ollie-character.js')                   → module.exports
 *
 * All movement lives in ollie.css. This file only builds the SVG and flips
 * three attributes on it:
 *   data-mood     wave | think | point | cheer | neutral   (pose + gaze)
 *   data-talking  true | false                              (beak + sway)
 *   .is-reacting  added for ~2s on each new line            (one-off move)
 *
 *   var ollie = OllieCharacter.create({ size: 104 });
 *   someEl.appendChild(ollie.el);
 *   ollie.setMood('cheer');   // pose + reaction (hop and flap)
 *   ollie.talk(true);         // beak moves, body sways
 *   ollie.talk(false);
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.OllieCharacter = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var MOODS = ['wave', 'think', 'point', 'cheer', 'neutral'];

  var C = {
    body: '#8C7A5B', wing: '#6E5E43', belly: '#F3E7CF', feather: '#D9C7A4',
    beak: '#E08A3C', jaw: '#C9742F', cheek: '#E9A27A', shadow: '#E9E0CF',
    glasses: '#3E6B55', ink: '#2B2722', white: '#FFFFFF'
  };

  // Parts, back to front. Class names are the contract with ollie.css.
  var PARTS = [
    '<ellipse class="ollie__shadow" cx="80" cy="152" rx="44" ry="6" fill="' + C.shadow + '"/>',
    '<g class="ollie__bob"><g class="ollie__tilt"><g class="ollie__sway"><g class="ollie__react">',
      // ear tufts
      '<path d="M40 44 L50 20 L64 40 Z" fill="' + C.wing + '"/>',
      '<path d="M120 44 L110 20 L96 40 Z" fill="' + C.wing + '"/>',
      // wings behind the body (one left + one right shows per mood)
      '<path class="ollie__wing ollie__wing--l-down" d="M34 88 q-12 26 8 46 q4 -26 -8 -46z" fill="' + C.wing + '"/>',
      '<path class="ollie__wing ollie__wing--l-up" d="M34 84 q-22 -14 -22 -42 q20 12 26 38z" fill="' + C.wing + '"/>',
      '<path class="ollie__wing ollie__wing--l-point" d="M36 86 q-30 -4 -32 -20 q20 -2 34 12z" fill="' + C.wing + '"/>',
      '<path class="ollie__wing ollie__wing--r-down" d="M126 88 q12 26 -8 46 q-4 -26 8 -46z" fill="' + C.wing + '"/>',
      '<path class="ollie__wing ollie__wing--r-up" d="M126 84 q22 -14 22 -42 q-20 12 -26 38z" fill="' + C.wing + '"/>',
      // body
      '<ellipse cx="80" cy="90" rx="48" ry="58" fill="' + C.body + '"/>',
      '<ellipse cx="80" cy="106" rx="31" ry="38" fill="' + C.belly + '"/>',
      '<path d="M66 104 q5 5 10 0 M84 104 q5 5 10 0 M75 118 q5 5 10 0" stroke="' + C.feather + '" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
      // thinking wing sits in front of the body, hand to chin
      '<path class="ollie__wing ollie__wing--r-think" d="M128 92 q16 10 2 30 q-14 4 -18 -4 q10 -6 16 -26z" fill="' + C.wing + '"/>',
      // green glasses
      '<circle cx="60" cy="68" r="18" fill="' + C.white + '" stroke="' + C.glasses + '" stroke-width="5"/>',
      '<circle cx="100" cy="68" r="18" fill="' + C.white + '" stroke="' + C.glasses + '" stroke-width="5"/>',
      '<path d="M77 65 Q80 60 83 65" stroke="' + C.glasses + '" stroke-width="4" fill="none" stroke-linecap="round"/>',
      '<path d="M42 64 L38 62 M118 64 L122 62" stroke="' + C.glasses + '" stroke-width="4" fill="none" stroke-linecap="round"/>',
      // eyes: gaze (mood) > look (idle) > blink
      '<g class="ollie__gaze"><g class="ollie__look"><g class="ollie__blink">',
        '<circle cx="62" cy="70" r="8" fill="' + C.ink + '"/>',
        '<circle cx="102" cy="70" r="8" fill="' + C.ink + '"/>',
        '<circle cx="65" cy="67" r="2.5" fill="' + C.white + '"/>',
        '<circle cx="105" cy="67" r="2.5" fill="' + C.white + '"/>',
      '</g></g></g>',
      // happy closed eyes for cheer
      '<g class="ollie__happy">',
        '<path d="M50 72 q10 -12 20 0" stroke="' + C.ink + '" stroke-width="5" fill="none" stroke-linecap="round"/>',
        '<path d="M90 72 q10 -12 20 0" stroke="' + C.ink + '" stroke-width="5" fill="none" stroke-linecap="round"/>',
      '</g>',
      '<circle cx="46" cy="88" r="5" fill="' + C.cheek + '" opacity="0.6"/>',
      '<circle cx="114" cy="88" r="5" fill="' + C.cheek + '" opacity="0.6"/>',
      // beak: lower jaw moves when talking
      '<path class="ollie__jaw" d="M75 89 L85 89 L80 96 Z" fill="' + C.jaw + '"/>',
      '<path d="M72 80 L88 80 L80 90 Z" fill="' + C.beak + '"/>',
      // feet
      '<path d="M68 146 l-4 6 M72 146 v7 M76 146 l4 6 M84 146 l-4 6 M88 146 v7 M92 146 l4 6" stroke="' + C.beak + '" stroke-width="3" fill="none" stroke-linecap="round"/>',
    '</g></g></g></g>'
  ].join('');

  /* markup(opts) — the SVG as a string, for server-side or template use.
   * opts.size   px, default 104
   * opts.mood   default 'wave'
   * opts.label  if given, Ollie is announced as an image with this label;
   *             otherwise she is decorative (aria-hidden), which is right
   *             when she sits inside a labelled button.
   */
  function markup(opts) {
    opts = opts || {};
    var size = opts.size || 104;
    var mood = MOODS.indexOf(opts.mood) >= 0 ? opts.mood : 'wave';
    var a11y = opts.label
      ? 'role="img" aria-label="' + String(opts.label).replace(/"/g, '&quot;') + '"'
      : 'aria-hidden="true" focusable="false"';
    return '<svg class="ollie" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="' + size +
      '" height="' + size + '" data-mood="' + mood + '" data-talking="false" ' + a11y + '>' + PARTS + '</svg>';
  }

  function control(svg) {
    var reactTimer = null;
    function react() {
      svg.classList.remove('is-reacting');
      // force a reflow so the same animation can play again
      void svg.getBoundingClientRect();
      svg.classList.add('is-reacting');
      clearTimeout(reactTimer);
      reactTimer = setTimeout(function () { svg.classList.remove('is-reacting'); }, 2200);
    }
    return {
      el: svg,
      setMood: function (mood, opts) {
        svg.setAttribute('data-mood', MOODS.indexOf(mood) >= 0 ? mood : 'neutral');
        if (!opts || opts.react !== false) react();
      },
      getMood: function () { return svg.getAttribute('data-mood'); },
      react: react,
      talk: function (on) { svg.setAttribute('data-talking', on ? 'true' : 'false'); },
      destroy: function () { clearTimeout(reactTimer); if (svg.parentNode) svg.parentNode.removeChild(svg); }
    };
  }

  /* create(opts) — build Ollie in the browser and return her controller. */
  function create(opts) {
    var holder = document.createElement('div');
    holder.innerHTML = markup(opts);
    return control(holder.firstChild);
  }

  /* attach(svgEl) — control an Ollie that is already in the page
   * (for example one rendered on the server with markup()). */
  function attach(svgEl) { return control(svgEl); }

  return { create: create, attach: attach, markup: markup, MOODS: MOODS };
});
