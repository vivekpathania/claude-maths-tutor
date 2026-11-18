# Visuals

Read this when you are writing a `teach` step or a question that needs a
diagram (`teacher`, sometimes `author`), or drawing one (`illustrator`). Agents never write SVG or HTML — a
visual is declarative data the page draws, so it can be verified.


A `teach` step and any question can carry a `visual` — a diagram. **Agents
never write SVG or HTML.** A visual is declarative data the page draws, so it
can be *checked*: a diagram that contradicts its own step is blocked by
`verify-session.js` exactly like a wrong answer key, because it teaches a
falsehood just as directly. Model-authored markup could not be verified,
themed, or kept safe.

```jsonc
"visual": {
  "type": "fractionBars",
  "bars": [ { "parts": 2, "shaded": 1, "label": "1/2" },
            { "parts": 4, "shaded": 2, "label": "2/4" } ],
  "caption": "Same bar, cut differently — the coloured amount has not changed."
}
```

| `type` | Shows |
|---|---|
| `fractionBars` | Bars all rendered at the SAME total width, each cut into `parts` with `shaded` coloured from the left. Equal fractions therefore end at the same place — that alignment is the teaching. `label`/`caption` optional. |
| `placeValue` | The place-value grid: `cols` of `[label, digit]` pairs, `lit` indices highlighted. |
| `scene` | Any other diagram, from macros and atoms — see "Scenes" below. The teacher/author state what must be true; the illustrator agent draws it. |

The older `pv`/`lit` fields directly on a step still render (stored sessions
and the demo use them); `visual` is what new sessions write. An unknown
`type` renders no diagram rather than breaking the page.

## Scenes — any diagram, one renderer

`type: "scene"` is how everything else gets drawn: shapes, number lines, arrays,
and whatever comes next. One generic renderer (`public/scene.js`) draws it, and
**the same module measures it back** in `verify-session.js`, so the check cannot
drift from what the child sees.

A scene is a **contract plus a drawing**, written by two different agents:

```jsonc
"visual": {
  "type": "scene",
  "request": "A triangle the child can classify by its sides",          // teacher/author: intent
  "facts": [                                                            // teacher/author: the contract
    { "measure": "sides", "of": "T", "equals": [8, 3, 8] },
    { "mustNotShow": ["isosceles", "scalene", "equilateral"] }
  ],
  "items": [ { "m": "triangle", "id": "T", "sides": [8, 3, 8] } ],     // illustrator: the drawing
  "caption": "optional"
}
```

- **`teacher` / `author`** write `request` and `facts` — never `items`. They own
  the maths: what must be true of the picture, and what it must not give away.
  A scene they leave without `items` is a request; the `illustrator` agent draws
  it. `verify-session.js` blocks a session that still has one.
- **`illustrator`** writes `items`, only ever through
  `scripts/set-scene-items.js`, which cannot touch the question, the answer or
  the facts.
- **The checker recomputes every fact from the drawing** and blocks on any
  disagreement. A wrong picture is as bad as a wrong answer key: it teaches the
  error directly. A scene with no measurable fact is refused — nothing about it
  would be verified.

### Facts — what the checker can recompute

| `measure` | `of` | `equals` |
|---|---|---|
| `length` | a segment id, or a polygon edge `"T.AB"` (either order) | a number |
| `sides` | a polygon id | the list of its side lengths, any order |
| `angle` | `"T@B"` (polygon vertex) or an angle-mark id | degrees |
| `perimeter` / `area` | a polygon id (area also a rect id) | a number |
| `count` | a group id (an array's id); optional `"where": {"on": true}` for the shaded ones | a whole number. "None shaded" is `where: {on: true}` equals `0` — state it, or nothing checks it. |
| `value` | a number-line point id | the number it sits at |
| *(not a measure)* `mustNotShow` | `["text", ...]` | the picture may print none of these as a label |

`mustNotShow` is how a **stimulus** picture avoids giving its own answer away. It
matches whole words, so `"4"` is not found inside `"14 cm"`. Separately, a
question's own picture is warned if any label equals the question's `answer`.

### Macros — the page does the geometry, nobody can get it wrong

Use a macro whenever one fits. Every macro takes an optional `"id"` and
`"at": [x, y]` to place it beside others (each draws around the origin; two
macros may not share an id).

| Macro | Arguments | Notes |
|---|---|---|
| `triangle` | `sides: [a, b, c]` **or** `angles: [A, B, C]` (+ optional `base`); `names`, `unit` (default `"cm"`), `show: {sides, angles, ticks, rightMark, vertices}` | a is opposite A, so a=\|BC\|, b=\|CA\|, c=\|AB\|. **Equal sides get matching tick marks and a 90° corner gets its square, both worked out from the numbers** — never declared, so they cannot contradict the lengths. Impossible sides or angles are refused. Lays itself out: a right angle bottom-left, an isosceles on its odd side, otherwise the longest side as base. Defaults: `unit` cm; every `show` flag on except `angles` (built from `angles`, sides are off and angles on). |
| `numberLine` | `min`, `max`, `step`, `labelEvery`, `hideLabels: [values]`, `points: [{id, at, label}]`, `arrows` | A point's value is read back from where it is drawn. `hideLabels` leaves a number off the line so a point cannot be read from its own tick label — **but that leaves a gap in the numbers written (`-5 -4 _ -2 -1`) that the child can read the answer off, and the checker warns.** Prefer `labelEvery: 5`: they are given `-5, 0, 5` and must count to the point. Defaults: `step` 1, `labelEvery` 1, `arrows` on. |
| `array` | `rows`, `cols`, `shaded` (first n in reading order) **or** `shadedCells: [[r,c],...]`, `shape: "dot" \| "square"` | Counts are measured from the dots drawn. Defaults: `shaded` 0, `shape` `"dot"`. |

### Atoms — for what no macro covers

`segment` (`from`, `to`, `ticks`, `label`, `arrow`), `polygon` (`points` as a
named object or a list, `labels`, `fill`), `circle`, `rect`, `text`, `point`,
`angleMark` (`at`, `from`, `to`). Coordinates are plain numbers, y up. An atom
scene is still fully checked: lengths, angles, areas and counts are recomputed
from the coordinates, so a hand-placed point that is a little off is caught.
Prefer a macro; atoms are for the picture a macro cannot make.

### Labels cannot collide

The checker lays the labels out exactly as the page will and **blocks** if two
land on top of each other — a stimulus the child cannot read is as wrong as one
drawn wrongly, and nobody who cannot see the picture would otherwise know. The
usual cures: a triangle with `show: { sides: false }` and/or
`{ vertices: false }` (the tick marks still show which sides match, and the
numbers go in the question), a number line with `labelEvery: 5`, or fewer
pieces in one picture.

Pieces also may not overlap or touch (they must clear each other by half a text
height), which is why an unplaced macro — drawn around the origin like every
other — collides with its neighbour: give each its own `"at"`. Measured on three
triangles of about the same size, pieces clear each other from about **1.15×**
the widest piece when they carry no labels or only vertex letters, but
side-length numbers need about **2.7×**. So with several pieces, leave the
numbers to the question's text and show what matches with tick marks.

### When a scene cannot say it

If a topic needs a drawing no macro makes and atoms cannot express with
checkable facts, say so — the `illustrator` reports `MISSING MACRO:`, and that
line is what triggers building one.

### Adding a macro

A macro is one function in `public/scene.js`, so it is drawn and measured by the
same code:

| Where | Change |
|---|---|
| `public/scene.js` | a `mFoo(m, cx)` that adds atoms (give them `group`/`id` so facts can name them), an entry in `MACROS` and `MACRO_ID`, a line in `describe()` |
| `scripts/test-scene.js` | cases for it: a right one passes, **a wrong one is blocked**, an impossible one is refused |
| `docs/visuals.md` | a row in the macro table above |

`index.html`, `verify-session.js` and the agents need no change — a new macro is
available to the illustrator as soon as it is documented here. Next, as topics
arrive: clock, coordinate grid, bar chart and pictogram, protractor, spinner,
hundred square and bar model. The order follows `topicQueue`.

### What a scene does not do

The child **reads** a scene and types an answer. It cannot yet ask the child to
tick, circle, shade or draw on one — that needs a new answer type, a new attempt
record and new scoring, and is a separate piece of work.
