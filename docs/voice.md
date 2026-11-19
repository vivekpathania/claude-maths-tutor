# Ollie's voice

Read this when you are working on audio for Coach Ollie: rendering speech, the
Listen button, or the phase-2 live voice. The voice *text* (what she says, in what
register) is `docs/mascot.md`; this file is how it becomes sound.

**Status:** the rendered-Kokoro approach is chosen and built: `speech.js`, the render tool,
the bank's recordings, the teacher-written lines (rendered into the keyed store by
`save-session.js` after a save; `node render.js session <file>` by hand), and the Ollie
**dock** (below). Ollie lives bottom-left on every child page, a speech bubble above her
fades by itself, and her lines play as they happen. Browsers need one touch before sound,
so nothing speaks until the child taps "Let's go". Verified in a desktop browser (bank
clip, then a session clue fetched with the child key, with the clue box highlighted);
**not yet on an iPad** (silent switch, the shared-element unlock). The voice is
chosen by ear: `af_heart` (in `tools/voice/config.json`). Not voiced: second-angle steps,
feedback cards, slip explanations (shown, not said), the revealed answer, and any bank
line with the child's name. If you change what the page speaks, change `tools/voice/lines.js` too.

## How the page speaks (the Ollie kit)

`public/ollie-kit/` is the kit (character, dock, clue track, `ollie.css`); it is used
as-is and never edited. Three things its options cannot do are done in `public/ollie-voice.js`:

1. **Recordings.** The dock plays an `audioUrl` only if the caller passes one, and `OllieClues`
   calls `dock.say()` itself. So `OllieClues` is given a *speaker* (`OllieVoice.attach`)
   instead of the dock. The speaker picks the line, finds its recording by the words
   (`Speech.clipKey`) and calls `dock.sayText()` with the URL. The dock is mounted with
   `voice: 'audio-only'` (or `'none'` from age 12): a line with no recording is captions only,
   never the browser's robot voice. A clue is a bank line plus the clue text; they are spoken
   as two recordings in a chain, so a clue costs one new clip, not one per pairing.
2. **iPad.** The dock makes a new `Audio()` per line; Safari only lets a brand-new element
   play inside a tap. The first tap anywhere starts ONE shared element on silence, and from
   then on `new Audio(url)` returns that element.
3. **Pacing.** `speaker.chain([...])` speaks the first line now and each next one when the one
   before has finished (a greeting, then the screen's own line; a teach step, then its golden
   rule). Any other line cancels the rest. The dock's own idle nudge is off (`idleAfterMs: 0`);
   the speaker runs it, with a recording, on question and teach screens only.

Ollie reacts to the child, she does not narrate every screen: a new screen, question or teach
step may open with a line (`isNewScreen` in `index.html`); a redraw after an answer does not.
After an answer she reacts through the clue track.

## The design

**Render ahead of time, on the parent's Mac. Never in the browser, never on
Netlify.** `kokoro-js` is a small model (82M parameters) but a heavy package:
`tools/voice/node_modules` is **414 MB** against the app's 13 MB, because it pulls
in `@huggingface/transformers` and a native ONNX runtime. It lives in its own
folder, `tools/voice/`, with its own `package.json`, gitignored `node_modules`,
and is never a dependency of the app — so it cannot reach the deploy or the iPad.

**Every clip is content-addressed.** Its filename is a hash of
`voice + speakable text`. So the same line is never rendered twice; an edited line
gets new audio by itself; changing the voice re-renders everything; and a line
that did not exist until runtime (phase 2) is just one more hash.

**Audio is exactly the text on screen, nothing extra.** That makes the assessment
register safe by construction: a check has no hints and no slip messages, so there
is nothing to leak (`docs/mascot.md` §3). Speech inherits the register.

| Where | What | How |
|---|---|---|
| `public/audio/bank/` | the bank (`ollie-lines.js`): reactions, framing — **except lines with the child's name** | committed, static, CDN. ~3 MB for ~156 lines. `manifest.json` lists exactly which clips exist |
| Mongo, `audio` collection | a session's authored lines | rendered by `save-session.js`, served by `GET /api/audio/:hash`, **only for the pending session** (replaced on the next save), so storage stays flat |

**Lines with the child's name are not in the bank's audio.** About 16 bank lines
are templates (`Hi {name}!`, `What a comeback, {name}!`). `public/audio` is served
to anyone with no key, and a recording of the child's first name does not belong on
an open CDN — the same reason the pages no longer carry the name. They are voiced
in phase 4, in the keyed store with the session's own lines. The page needs no
special case: it works out a clip's key from the text it shows, the shown text has
the name in it, that key is not in the manifest, and no Listen button appears.
`scripts/test-voice.js` fails if a personal line ever gets a public recording.

**The page.** One shared `<audio>` element, unlocked by the first tap, reused after (see
"How the page speaks"). Not Web Audio: on iPad it goes silent when the side switch is on
mute, while `<audio>` still plays. `<audio src>` cannot send the `x-tutor-key` header, so
authored clips are fetched with `apiFetch` (prefetched at load) and played from a blob. **Auto-speak
only after the first touch** (iOS forbids earlier). On by default for age 11 and under, captions
only from 12; there is no header switch any more — the dock's speaker button replays this screen's lines
(`speaker.newScreen()` forgets the last screen's), and a mute button replaces the kit's captions
button: the bubble is always on and always shown with the line, only the sound goes. The dock
lights a warm spotlight behind her (`.is-speaking`) while she talks. When she reads text that is already on
screen (a clue, boxed and tagged "Ollie is reading this") the bubble is skipped; the replay button is a
circular arrow, the mute button a speaker (amber with a cross when muted). With the on-screen keyboard open the dock is hidden, so
that line is silent too — she never speaks without a bubble. Any failure is silent: the lesson never blocks on
audio and `save-session` never blocks on rendering (it warns and saves text-only).

**What gets spoken** (a real lesson, day 2: 115 lines, ~10 min of speech in all):

| Tier | Adds | Per lesson |
|---|---|---|
| 1 | Ollie's own words: bank, `steps[].ollie`, golden rule, greeting/close, `q.ollie` | ~1.2k chars (~90 s) |
| 2 | hints and slip messages | +4.7k |
| 3 | the question text ("Read it to me") | +1k |

Ship tier 1 plus the questions first: where the child is weak on worded
questions, reading the `ask` aloud is probably the most useful part.

## Build order

0. **Listening spike** — done; the decision gate.
1. **Done.** `public/speech.js`: turns text into speakable words (× → "times",
   ° → "degrees", −3 → "minus 3", `£1.50` → "1 pound 50", units, fractions) and names
   each clip with a small synchronous hash of `version | voice | speakable text`.
   Tested so Node and a plain browser script produce identical keys.
2. **Done.** `tools/voice/render.js bank`, the bank's recordings, and
   `scripts/test-voice.js`, which fails if **any bank line has no recording**
   (silent dead air), if a clip is orphaned, or if the manifest is stale.
3. **Done.** `public/ollie-voice.js` (the speaker, the shared audio element, the manifest
   and the session's clips) on top of the Ollie kit. It replaces the earlier `public/voice.js`, whose
   Listen buttons and header switch are gone. A missing kit or manifest is silent — the page has a
   no-op stand-in. **Not yet tried on the iPad.**
4. Authored audio: the `save-session` hook, the Mongo store, `/api/audio/:hash`
   (binary responses need `serverless-http`'s `binary` option).
5. "Read it to me", age defaults, mute toggle.
6. Later: an audio bar for long narration (`.ol-audio` CSS and the `play`/`pause`/
   `replay`/`speaker` icons already exist, with no code behind them); auto-read for
   younger children.

## Running it

```bash
cd tools/voice
node render.js bank --dry      # what would change, and how long it would take
node render.js bank            # render what is missing; delete what is orphaned
node render.js bank --voice bm_lewis   # try another voice (every key changes)
cd ../.. && npm test           # includes scripts/test-voice.js
```

**Edit a bank line and the test fails until you re-render** — by design. Rendering
only touches lines whose words changed. To change the voice: edit `voice` in
`tools/voice/config.json`, set `provisional` to `false`, re-render (about 5
minutes for the bank), and commit `public/audio`.

## The spike (run on this Mac, `kokoro-js` 1.2.1, `q8`, CPU)

| | |
|---|---|
| Model load | 18 s (first run included the download) |
| Render speed | **2.0× real time** (1 s of speech takes 0.5 s) — same for every voice |
| Peak memory | 760 MB |
| Clip size | ~30 KB each as 48 kbps AAC (`afconvert`, built in; no ffmpeg needed) |
| Mac `say` | ~1 s per clip; ~27 KB |
| Cost to render | the bank (7 min of speech) ≈ 3.7 min once; a tier-1 lesson ≈ 45 s; everything in a lesson ≈ 5 min |

Kokoro British voices available: `bm_george`, `bm_lewis`, `bm_fable`, `bm_daniel`
(male), `bf_emma`, `bf_isabella`, `bf_alice`, `bf_lily` (female). The first four were
rendered. Ollie is "she" throughout these docs.

**Not yet known — needs ears:** which voice is Ollie; whether the iPad's own
`speechSynthesis` voice is good enough to skip rendering entirely; whether the
"made speakable" draft helps or hurts. Known weak spots in that draft from reading
its output: `£1.50` → "1.50 pounds" (should be "one pound fifty"), and the
respellings of *isosceles* and *equilateral* are guesses.

## Decisions still open

1. **The voice** — a Kokoro voice, or the iPad's own (live `speechSynthesis`)? The
   latter needs no files and would speak live LLM text for free, but Ollie would
   sound different on every device and iOS version, and a mispronounced "scalene"
   cannot be fixed.
2. **What is spoken** — tier 1 + questions first (recommended), or more.
3. **Default on/off by age** — 11 and under on, 12+ off (recommended).

## Risks

- **Pronunciation of maths words.** Respell through a small dictionary in
  `speech.js`. Kokoro's inline phoneme override is documented for its Python
  pipeline; whether the JS build supports it is unverified, so plan on respelling.
- **Repetition is worse in audio than in text.** 12 assessment moments have one
  line. The ones that can fire several times a session (`wrong.again`,
  `wrong.stuck`, `right.recovered`, `comeback`) need 3+ lines before audio goes on
  for that register.
- **iPad quirks are untested.** Silent switch, first-tap unlock, binary responses
  through Netlify. Test on the real iPad before step 3 ships.

## Phase 2 — live LLM lines

Pre-rendering cannot voice a line that does not exist until the child is stuck, and
Netlify cannot host the model. Voicing live lines needs an always-on render host
(the Mac, or a small VM) behind the same hash API: the bank line plays at once and a
generated line plays only if it arrives in time. The assessment register never calls
it (`docs/mascot.md` §9). If lines are generated in the pipeline instead, the same
Mac render path covers them with no new infrastructure. Decide after phase 1.
