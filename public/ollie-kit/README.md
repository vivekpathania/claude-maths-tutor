# Coach Ollie kit

Everything for Ollie on the child's page: the animated character, the dock with her speech bubble, the clue area under the answer box, her line bank, and still images.

Open `demo.html` in a browser to see it all working. It uses the browser's built-in voice for speech.

## Files

| File | What it is |
|---|---|
| `ollie/ollie-character.js` | Ollie as one inline SVG. Sets her mood and talking state. |
| `ollie/ollie-dock.js` | Her home on the page: speech bubble, voice, captions, replay, idle nudge. |
| `ollie/ollie-clues.js` | The clue area under the answer box and the rules for when help appears. |
| `ollie/ollie-lines.js` | The line bank. Clue lines now say the clue is under the answer box. |
| `ollie/ollie.css` | All of Ollie's animation, the dock, the bubble and the clue styles. |
| `assets/ollie-*.svg` | Still images for each mood, plus `ollie-avatar.svg` (head only), for places with no animation (emails, parent reports, app icons). |
| `demo.html` | A working practice question wired up end to end. |

## Add Ollie to a page

```html
<link rel="stylesheet" href="/ollie/ollie.css">

<main class="ollie-content"> … your page … </main>

<script src="/ollie/ollie-lines.js"></script>
<script src="/ollie/ollie-character.js"></script>
<script src="/ollie/ollie-dock.js"></script>
<script src="/ollie/ollie-clues.js"></script>
<script>
  var dock = OllieDock.mount({ register: 'practice', name: child.firstName });
</script>
```

The order of the scripts matters. Put `ollie-content` on the page's main content so it keeps clear of Ollie:
- **1200px and wider:** Ollie sits in the bottom-left margin and the content keeps a 340px rail free.
- **Below 1200px:** Ollie moves into a strip along the bottom, and the content gets extra bottom padding.

## Make Ollie speak

```js
dock.say('wrong.first');                         // a line from the bank, with its mood
dock.say('open', { audioUrl: '/audio/open-3.mp3' });
dock.sayText('Authored line for this lesson', { mood: 'point' });
dock.replay();                                   // what the speaker button does
dock.stop();
```

- **Browsers block sound until the child taps something.** Call `dock.unlock()` from the session's start button ("Let's go").
- **Voice source:** pass `audioUrl` for recorded audio. Without it, the dock uses the browser's voice (`voice: 'speech'`, the default). Use `voice: 'none'` for captions only.
- **Timing:** the bubble and beak follow the real audio. The beak stops when the audio ends, and the bubble fades 1.5 seconds later (shown for at least 3.5 seconds). If the length can't be measured, it's estimated from the text.
- **No overlap:** a new line always stops the current one.
- **Idle nudge:** typing or tapping resets the "still with me?" nudge (`idleAfterMs`, default 45000; `0` turns it off).
- **Captions setting:** the captions button is remembered on the device.

## Clues

```js
var clues = OllieClues.create({
  container: document.querySelector('#clue-area'),   // a .ollie-clues element under the answer box
  clues: question.hints,                              // authored per question
  dock: dock,
  register: 'practice',
  onShowMe: renderWalkthrough
});

// on Check
if (isRight) {
  var result = clues.correct();          // Ollie says right.first or right.recovered
  progress.mark(result.firstTry ? 'star' : 'with-help');
} else {
  clues.wrongTry();                      // Ollie reacts; clues unlock or appear
}
// after the walkthrough
clues.yourTurn();
```

The rules, built in:

| What happens | Result |
|---|---|
| First wrong try | Ollie says `wrong.first`. Clues unlock; no clue is shown yet. |
| Child taps "Need a hand?" | The next unseen clue appears, and Ollie reads it (`clue.first`, then `clue.last`). |
| Second and later wrong tries | The next clue appears automatically (`wrong.again`). |
| No clues left | "Show me how": `onShowMe()` is called. |
| Clue box while Ollie reads it | Gets a strong border and an "Ollie is reading this" tag. |
| `register: 'assessment'` | No clue area at all; Ollie uses presence lines only. |

## Moods

`ollie-lines.js` decides the mood for each moment through `mood(register, moment)`. You can also set one yourself with `sayText(text, { mood })`.

| Mood | Pose | Reaction when a line starts |
|---|---|---|
| `wave` | Right wing up | Waves three times |
| `think` | Wing to chin, eyes up, head tilted | Holds the tilt |
| `point` | Left wing points towards the card | Nudges, small lean |
| `cheer` | Both wings up, happy eyes | Two hops, wings flap |
| `neutral` | Wings down | Small lean |

She is never fully still. She bobs gently, blinks, looks left and right now and then, tilts her head and ruffles her wings, each on its own timing. While she talks, her beak moves and her body sways gently. When the device asks for reduced motion, she stays still; voice and captions are unchanged.

## Colours

`ollie.css` reads the `--ol-*` tokens from `app.css` when they're there, and falls back to the same values on its own. Clues use their own help colour (lilac), defined at the top of `ollie.css`:

```css
--ollie-help-bg: #F3EFFB;  --ollie-help-line: #CDBFEF;  --ollie-help-strong: #7A5BC7;
--ollie-help-text: #55399E; --ollie-help-chip: #E7E0F7;
```

Change those five values to try a different help colour.

## Accessibility

- The bubble is a polite live region, so screen readers announce what Ollie says.
- Ollie's button and the speaker button are both labelled "Hear Ollie again".
- The captions button uses `aria-pressed`.
- All controls are at least 48px and show a blue focus ring.
- In the strip layout, when the on-screen keyboard opens, the strip hides so it never covers the answer box. Ollie keeps talking.
