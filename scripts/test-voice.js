// test-voice.js — does Ollie's voice stay in step with what Ollie says?
//
//   node scripts/test-voice.js
//
// Plain node, no framework, no database. Three things can go quietly wrong with
// recorded audio, and each is checked here:
//
//   1. The page and the render tool disagree about a clip's name — then every
//      Listen button silently disappears, or worse, plays the wrong line.
//   2. A bank line is edited, or added, and nobody re-renders — then Ollie goes
//      silent on exactly the line that changed ("dead air").
//   3. A line with the child's name in it gets a recording on the open CDN.
//
// Needs the bank rendered once (cd tools/voice && node render.js bank).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const Speech = require('../public/speech.js');
const { BANK } = require('../public/ollie-lines.js');

let pass = 0, fails = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok    ' + name); }
  catch (e) { fails++; console.log('FAIL  ' + name + '\n        ' + e.message); }
}
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what || 'value'}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const truthy = (v, msg) => { if (!v) throw new Error(msg); };

/* ── 1. speakable: the words that are spoken ────────────────────────────── */

const SPOKEN = [
  ['What is 2.6 × 10?',              'What is 2.6 times 10?'],
  ['Is 1/3 the same as 2/6?',        'Is one third the same as two sixths?'],
  ['3/4 of the bar',                 'three quarters of the bar'],
  ['A right angle is 90°.',          'A right angle is 90 degrees.'],
  ['The sides are 6 cm and 4 cm.',   'The sides are 6 centimetres and 4 centimetres.'],
  ['Count back: 3 − 5 = −2.',        'Count back: 3 minus 5 equals minus 2.'],
  ['It costs £1.50.',                'It costs 1 pound 50.'],
  ['75p, or £0.75',                  '75p, or 75 pence'],
  ['25% of 80',                      '25 percent of 80'],
  ['Fill in the blank: 1/3 = ?/6.',  'Fill in the blank: one third equals what over 6.'],
  ['Warm-up done — now the new stuff.', 'Warm-up done, now the new stuff.'],
  ['Pages 5–10',                     'Pages 5 to 10'],
  ['That’s it! 🎈',             "That's it!"],
  ['<b>Bold</b> and <i>plain</i>',   'Bold and plain'],
  ['Spot on!',                       'Spot on!'],
];
SPOKEN.forEach(([text, want]) => t(`speakable: ${JSON.stringify(text)}`, () => eq(Speech.speakable(text), want)));
t('speakable: nothing in, nothing out', () => { eq(Speech.speakable(''), ''); eq(Speech.speakable(null), ''); eq(Speech.speakable('  🎈  '), ''); });

/* ── 2. clipKey: the recording's name ───────────────────────────────────── */

t('clipKey: 14 hex characters, and the same every time', () => {
  const k = Speech.clipKey('Spot on!', 'bm_george');
  truthy(/^[0-9a-f]{14}$/.test(k), 'got ' + k);
  eq(Speech.clipKey('Spot on!', 'bm_george'), k, 'second call');
});
t('clipKey: a different voice is a different clip', () =>
  truthy(Speech.clipKey('Spot on!', 'bm_george') !== Speech.clipKey('Spot on!', 'bm_lewis'), 'same key for two voices'));
t('clipKey: a different line is a different clip', () =>
  truthy(Speech.clipKey('Spot on!', 'bm_george') !== Speech.clipKey('Spot on.', 'bm_george'), 'same key for two lines'));
t('clipKey: two displays that SOUND the same share one clip', () => {
  eq(Speech.clipKey('<b>Spot on!</b>', 'bm_george'), Speech.clipKey('Spot on!', 'bm_george'), 'markup ignored');
  eq(Speech.clipKey('Spot  on! 🎈', 'bm_george'), Speech.clipKey('Spot on!', 'bm_george'), 'spacing and emoji ignored');
});
t('clipKey: nothing to say means no clip', () => { eq(Speech.clipKey('', 'bm_george'), null); eq(Speech.clipKey('Hi', ''), null); });

t('the PAGE computes the same keys as the render tool (speech.js loaded as a plain browser script)', () => {
  // In a browser there is no `module`; the file attaches itself to `self`. Run it that way.
  const sandbox = { self: {}, console };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'speech.js'), 'utf8'), sandbox);
  truthy(sandbox.self.Speech, 'speech.js did not attach window.Speech');
  const lines = [].concat(...Object.values(BANK).map((m) => [].concat(...Object.values(m))))
    .concat(SPOKEN.map(([t0]) => t0), ['Hello — ça va? £1.50', 'x']);
  lines.forEach((l) => eq(sandbox.self.Speech.clipKey(l, 'bm_george'), Speech.clipKey(l, 'bm_george'), 'key for ' + JSON.stringify(l)));
});

/* ── 3. the bank and its recordings ─────────────────────────────────────── */

const AUDIO = path.join(ROOT, 'public', 'audio');
const BANK_DIR = path.join(AUDIO, 'bank');
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(path.join(AUDIO, 'manifest.json'), 'utf8')); } catch (e) { /* reported below */ }

t('the bank has been rendered (public/audio/manifest.json exists)', () =>
  truthy(manifest, 'no manifest — run: cd tools/voice && node render.js bank'));

if (manifest) {
  const personal = /\{[a-zA-Z]+\}/;
  const allLines = [].concat(...Object.values(BANK).map((m) => [].concat(...Object.values(m))));
  const voiced = [...new Set(allLines.filter((l) => !personal.test(l)))];
  const files = fs.existsSync(BANK_DIR) ? fs.readdirSync(BANK_DIR).filter((f) => f.endsWith('.m4a')).map((f) => f.slice(0, -4)) : [];

  t('the manifest was made by this version of speech.js', () => eq(manifest.version, Speech.VERSION, 'manifest.version'));
  t('the manifest names a voice', () => truthy(typeof manifest.voice === 'string' && manifest.voice, 'no voice in the manifest'));

  t(`every bank line has a recording — none is silent (${voiced.length} lines)`, () => {
    const missing = voiced.filter((l) => {
      const k = Speech.clipKey(l, manifest.voice);
      return k && !(Object.prototype.hasOwnProperty.call(manifest.clips, k) && files.includes(k));
    });
    eq(missing.slice(0, 5), [], `${missing.length} line(s) with no recording — edited or added since the last render? run: cd tools/voice && node render.js bank. First few`);
  });
  t('every clip in the manifest exists, and is more than a few bytes', () => {
    const bad = Object.keys(manifest.clips).filter((k) => {
      try { return fs.statSync(path.join(BANK_DIR, k + '.m4a')).size < 2000; } catch (e) { return true; }
    });
    eq(bad, [], 'manifest entries with a missing or empty file');
  });
  t('no orphaned clips on disk (they ship to every iPad for nothing)', () =>
    eq(files.filter((k) => !manifest.clips[k]), [], 'files not in the manifest'));
  t('the manifest text is what the key says (no stale or edited entry)', () => {
    const wrong = Object.entries(manifest.clips).filter(([k, text]) => Speech.clipKey(text, manifest.voice) !== k);
    eq(wrong.slice(0, 3), [], 'entries whose text no longer hashes to their key');
  });
  t('a line with the child’s name in it is NEVER recorded on the open CDN', () => {
    const lines = [...new Set(allLines.filter((l) => personal.test(l)))];
    truthy(lines.length > 0, 'expected the bank to have name-bearing lines to test against');
    const leaked = lines.filter((l) => {
      const k = Speech.clipKey(l, manifest.voice);
      return k && Object.prototype.hasOwnProperty.call(manifest.clips, k);
    });
    eq(leaked, [], 'personal lines that have a public recording');
    eq(Object.values(manifest.clips).filter((x) => personal.test(x) || /[{}]/.test(x)), [], 'placeholder text in the manifest');
  });
}

/* ── 4. what a session can say aloud (tools/voice/lines.js) ──────────────── */

const { sessionLines } = require('../tools/voice/lines.js');
const lesson = () => ({
  id: 't-lesson', uiMode: { allowReveal: true },
  teach: { title: 'T', cycles: [{
    concept: 'c', conceptName: 'C',
    steps: [{ big: 'b1', note: 'a note', ollie: 'Think of a fence.' }, { big: 'b2', ollie: 'Now the next bit.' }],
    goldenRule: { title: 'Rule one.', body: 'Do the thing.' },
    q: { id: 'g1', ask: 'Which way?', answer: '4', hints: ['Which way does it go?', 'Left.'],
         slips: { '5': { code: 'x', say: 'You went right.' } }, ollie: { fresh: 'A fresh one.' } },
    secondAngle: { steps: [{ big: 'x', note: 'second angle note' }] },
  }] },
  warmup: { from: '', items: [] },
  practice: [{ id: 'p_1', ask: 'What is 3 + 3?', answer: '6', hints: ['One.'], slips: { '7': { code: 'y', say: '' } } }],
  close: { line: 'Done.', next: 'More soon.' },
});
const said = (s) => sessionLines(s).map((l) => l.text);

t('a lesson\'s own lines: narration, golden rule, Ollie\'s question lines, clues, close', () => {
  const got = said(lesson());
  ['Think of a fence.', 'Now the next bit.', 'Rule one.', 'Do the thing.', 'A fresh one.',
   'Which way does it go?', 'Left.', 'One.', 'Done.', 'More soon.']
    .forEach((x) => truthy(got.includes(x), 'missing: ' + x));
});
t('what the page does not speak is not recorded (question text, notes, second angles, slip explanations, the revealed answer)', () => {
  const got = said(lesson());
  ['Which way?', 'What is 3 + 3?', 'a note', 'second angle note', 'You went right.', ''].forEach((x) => truthy(!got.includes(x), 'should not be recorded: ' + JSON.stringify(x)));
  eq(got.filter((x) => /^The answer is/.test(x)), [], 'answer clips');
});
t('a CHECK session has no clues, so none are recorded for it', () => {
  const chk = lesson(); chk.uiMode = { allowReveal: false };
  const got = said(chk);
  ['Which way does it go?', 'Left.', 'One.'].forEach((x) => truthy(!got.includes(x), 'clue recorded in a check: ' + x));
  truthy(said(lesson()).includes('One.'), 'control: a lesson does have them');
});
t('a one-shot placement session has no clues either', () => {
  const p = lesson(); p.uiMode = { retryPolicy: 'oneShot', allowReveal: false };
  truthy(!said(p).includes('One.'), 'clue recorded in a placement');
});
t('every line is a distinct key at one voice, with no collisions (the render tool refuses one)', () => {
  const texts = [...new Set(said(lesson()))];
  eq(new Set(texts.map((x) => Speech.clipKey(x, 'bm_george'))).size, texts.length, 'distinct keys');
});

/* ── 5. the page loads the Ollie kit, in the right order ────────────────── */

const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'theme.css'), 'utf8');
t('index.html loads speech.js, the kit (character, dock, clues), then ollie-voice.js, all before the page script', () => {
  const at = (s) => html.indexOf('src="' + s + '"');
  const order = ['/ollie-lines.js', '/speech.js', '/ollie-kit/ollie/ollie-character.js', '/ollie-kit/ollie/ollie-dock.js',
    '/ollie-kit/ollie/ollie-clues.js', '/ollie-voice.js'].map(at);
  truthy(order.every((n) => n > 0), 'a script is missing: ' + order);
  truthy(order.every((n, i) => !i || n > order[i - 1]), 'order is wrong: ' + order);
  truthy(html.indexOf('<script>', order[order.length - 1]) > order[order.length - 1], 'page script is not last');
});
t('ollie.css loads after theme.css, and the main content carries ollie-content', () => {
  truthy(html.indexOf('/ollie-kit/ollie/ollie.css') > html.indexOf('href="/theme.css"') && html.indexOf('href="/theme.css"') > 0, 'css order');
  truthy(/<main class="[^"]*\bollie-content\b/.test(html), 'no ollie-content on <main>');
});
t('the old Ollie UI is gone: coach card, help shelf, header speaker button, footer bar', () => {
  ['ol-coach', 'ol-owl', 'ol-bubble', 'ol-hand', 'ol-listen', 'voice-toggle', 'class="page-footer"', 'Need a hand?', 'Your 1-on-1 Tutor']
    .forEach((x) => truthy(!html.includes(x), 'still in index.html: ' + x));
});
t('nothing but the dock is fixed to the page (theme.css fixes nothing)', () =>
  truthy(!/position:\s*fixed/.test(css), 'theme.css has a fixed element — it would collide with Ollie'));
t('the page survives the kit failing to load (it has a no-op stand-in)', () =>
  truthy(/var speaker = \{ say:function/.test(html), 'no stand-in for the speaker — a missing kit would break every screen'));

/* ── 6. ollie-voice.js: the shared audio element and the recordings ──────── */

const ov = fs.readFileSync(path.join(ROOT, 'public', 'ollie-voice.js'), 'utf8');
t('ollie-voice.js hands the dock ONE audio element (iPad plays later clips only from an element a tap started)', () => {
  truthy(/window\.Audio = function/.test(ov) && /shared/.test(ov), 'no shared Audio element');
  truthy(/touchend/.test(ov), 'no touch unlock');
});
t('a clue is spoken as a bank line then the clue itself — two recordings, never a new one per pairing', () =>
  truthy(/speaker\.chain\(\[\{ text: line/.test(ov), 'append is not chained'));
t('she never speaks without her bubble: captions forced on, mute instead, no sound while the dock is hidden', () => {
  truthy(/setCaptions\(true\)/.test(ov), 'captions are not forced on');
  truthy(/data-action', 'mute'/.test(ov) && /muted \|\| hidden \? null/.test(ov), 'no mute / hidden-dock silence');
  truthy(/data-action="captions"\]\{display:none\}/.test(css), 'the kit captions button is still shown');
});
t('no bubble repeats text already boxed on screen (readingEl)', () =>
  truthy(/if \(o\.readingEl\) hideBubble\(\)/.test(ov), 'bubble still shown over a clue being read'));
t('the speaker button replays THIS screen, and a new screen forgets the last one', () => {
  truthy(/newScreen: function/.test(ov) && /stopImmediatePropagation/.test(ov), 'no per-screen replay');
  truthy(/speaker\.newScreen\(\)/.test(html), 'isNewScreen does not reset the replay');
});
t('a line waits for its clip to finish downloading, and the bank is prefetched (slow connections skipped lines)', () => {
  truthy(/clipReady\(text, \d+\)/.test(ov) && /loading\+\+/.test(ov), 'sayText does not wait for the download');
  truthy(/isSpeaking\(\) \|\| loading/.test(ov), 'a chain moves on while a line is still loading');
  truthy(/prefetchBank/.test(ov) && /OllieVoice\.prefetchBank\(\)/.test(html), 'bank is not prefetched');
});

console.log('\n' + (fails ? fails + ' FAILED, ' : '') + pass + ' passed');
process.exitCode = fails ? 1 : 0;
