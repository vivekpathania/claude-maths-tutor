# Third-party notices

This project is released under the MIT License (see `LICENSE`). It also uses
the work listed below, each under its own licence. Versions and licences here
were read from the installed packages, not from memory — re-check them after a
dependency upgrade.

## Runtime dependencies (npm)

Installed by `npm install`, not vendored into this repository.

| Package | Version | Licence |
|---|---|---|
| `dotenv` | 16.x | BSD-2-Clause |
| `express` | 4.x | MIT |
| `mongodb` | 6.x | Apache-2.0 |
| `serverless-http` | 4.x | MIT |

## Build-time only (voice rendering)

`tools/voice/` is deliberately a separate package so this never reaches the
Netlify deploy or the child's device (see `docs/voice.md`).

| Package | Version | Licence |
|---|---|---|
| `kokoro-js` | 1.2.1 | Apache-2.0 |

`kokoro-js` downloads the **Kokoro-82M** text-to-speech model at render time.
The model is published under Apache-2.0 by its authors. Confirm the current
terms at the model's own page before redistributing anything it generates.

## Generated audio

`public/audio/bank/*.m4a` (about 3.5 MB, 157 clips) is Coach Ollie's recorded
speech, generated on a maintainer's machine with Kokoro using the `af_heart`
voice. The words are this project's own (`public/ollie-lines.js`); the
synthesis comes from the model above. A fork can re-render the whole bank with
`node tools/voice/render.js bank` instead of using these files.

## Browser libraries

Loaded from a CDN at runtime, **not** bundled in this repository.

| Library | Source | Licence |
|---|---|---|
| Tailwind CSS (Play CDN) | `cdn.tailwindcss.com` | MIT |

## Fonts

Loaded from the Google Fonts CDN at runtime. **Not** bundled in this
repository, so no font files are redistributed here. All are licensed under the
SIL Open Font License 1.1:

Archivo · Baloo 2 · IBM Plex Mono · Nunito · Plus Jakarta Sans · Public Sans

If you self-host any of them, ship the OFL text alongside the font files.

## Coach Ollie

The Coach Ollie character, the artwork in `public/ollie-kit/assets/`, the kit in
`public/ollie-kit/`, the theme in `public/design/`, and the line bank in
`public/ollie-lines.js` were generated with an AI assistant for this project.

No third-party artwork, icon set, component library or design kit was used, and
the kit has no runtime dependencies of its own. Output rights rest with the
project, so all of it is covered by `LICENSE`.

## Curriculum

The topic lists under `profiles/` are derived from publicly published
curriculum frameworks (for example the Cambridge Primary mathematics
framework). They are an independent reading of what a stage covers, expressed in
this project's own words.

This project is **not affiliated with, endorsed by, or certified by** Cambridge
Assessment International Education or any other examination board or school.
Framework text is not reproduced here.

## Claude

Grading, lesson writing and verification run through Anthropic's Claude via
Claude Code. Anthropic's terms apply to that usage, and running the pipeline
consumes your own account's quota. No Anthropic code is included here.
