> Authentication is on by default. `TUTOR_AUTH=off` switches it off (local work only; never on Netlify).

# Deploying to Netlify

Read this when you are putting the child's page and the dashboard on the
internet. The daily pipeline (`/grade`, `/next-session`) does **not** go
through Netlify — those scripts run on your Mac and talk to MongoDB directly.
Only the two web pages and the API they call are deployed.

---

## Authentication — two keys, and it fails closed

Every `/api` route requires a key in the `x-tutor-key` header. There are two,
because the child's iPad stores its key permanently and that device should not
be able to read the dashboard or delete anything:

| Key | Reaches | Lives on |
|---|---|---|
| `TUTOR_CHILD_KEY` | `GET /api/sessions/next`, `POST /api/sessions/:id/attempts`, `POST /api/sessions/:id/finish` — and nothing else | the child's iPad, in `localStorage` |
| `TUTOR_ADMIN_KEY` | everything, including the dashboard, curriculum edits and session deletes | the parent's browser, in `localStorage` |

**Never put the admin key on the child's device.** A borrowed or lost iPad
should expose one child's questions, not the whole database.

**It fails closed.** With either variable unset, every `/api` route returns
503 and logs why. An unset environment variable must never quietly mean "open
to the internet" — which is precisely the failure this guards against, since
the natural first deploy is one where you forgot to set them.

Comparison is against a SHA-256 digest via `crypto.timingSafeEqual`, so a
wrong key cannot be narrowed down by timing, and an empty key is always
rejected.

The three old catch-all routes (`GET /api/list/:col`, `GET /api/get/:col/:id`,
`POST /api/set/:col/:id`) have been **deleted**, not guarded. Nothing used
them, and `POST /api/set/:col/:id` accepted a collection name from the URL and
a document from the body — an authenticated arbitrary write is still an
arbitrary write.

### Generating and rotating keys

```bash
node -e "const c=require('crypto');for(const k of ['TUTOR_CHILD_KEY','TUTOR_ADMIN_KEY'])console.log(k+'='+c.randomBytes(24).toString('base64url'))"
```

Put both in `.env` for local work and in Netlify's environment variables for
production. To rotate, change the value in both places — the child's page shows
its one-time setup screen again on the next load, and the dashboard re-prompts.

### What is still not protected

The keys are bearer secrets in `localStorage`, so this stops the open internet,
not someone holding an unlocked device. There is no per-child scoping either:
the admin key reaches every child in the database. For one family that is the
right trade; if this ever serves more than one, that assumption needs revisiting.

The pipeline scripts (`fetch-latest`, `save-grading`, `save-session`, …) talk
to MongoDB through `scripts/db.js` and never call the API, so none of this
affects the daily loop.

---

## What is already set up

`netlify.toml`:

```toml
[build]
  publish = "public"              # static pages, served from the CDN
  functions = "netlify/functions"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200                    # rewrite, not a redirect
```

So `public/` (the child's page, the dashboard, `theme.css`, `ollie-lines.js`, `ollie-voice.js`, `ollie-kit/`,
`assets/`) is served as static files, and every `/api/*` call is rewritten into
one Lambda that wraps the whole Express app via `serverless-http`.

There is no build step. Nothing is compiled; Netlify just publishes `public/`
and bundles the function with its dependencies from `package.json`.

## The path rewrite, and why `netlify/functions/api.js` looks like that

The rewrite replaces the leading `/api` with the function path, so the function
can receive `/.netlify/functions/api/sessions/next` — while every route in
`app.js` is registered under `/api`. Left alone, Express matches nothing and
**the entire API 404s** while the site itself looks perfectly fine. This is the
single most common first-deploy failure with Express on Netlify.

`netlify/functions/api.js` puts `/api` back via a `serverless-http` request
hook. Which path the function actually receives varies by Netlify version, so
the hook only rewrites when the function prefix is present and leaves an
already-correct path untouched — both cases route identically.

## Before the first deploy

### 1. Environment variables

`.env` is gitignored and never reaches the bundle, so the values must be set in
**Site settings → Environment variables**:

| Variable | Value |
|---|---|
| `MONGODB_URI` | the same Atlas connection string as your local `.env` |
| `MONGODB_DB` | `maths-tutor` (or whatever your local `.env` uses) |
| `TUTOR_CHILD_KEY` | the same value as your local `.env` |
| `TUTOR_ADMIN_KEY` | the same value as your local `.env` |
| `TUTOR_TZ` | the child's time zone, e.g. `Asia/Kolkata`. Optional locally (defaults to this machine's zone) but **set it on Netlify**, which runs in UTC — without it a session finished at 00:30 local counts as yesterday and the streak breaks |

Without the Mongo pair, `connect()` throws its *"copy .env.example → .env"*
message and every API call returns 500 — confusing, because that text is
written for a local developer. Without the key pair, every API call returns
503 with a message naming the missing variables.

The first four are required. There is no partial-config mode for them.

### 2. MongoDB Atlas network access

This is the one Atlas rule that differs from local use — [database.md](database.md)
covers the rest of the setup.

**Netlify Functions have no static egress IP.** Atlas must allow `0.0.0.0/0`
under Network Access, or the connection never establishes.

This one fails as a **timeout**, not as an auth error, so it reads like the
function is broken when it is actually being refused at the network layer. If
your API hangs for ten seconds and then 500s, check this before anything else.

Allowing all IPs is only acceptable because the database user is scoped and the
password is the real credential — which is also why that password must never
end up in `public/`.

### 3. Node version

`package.json` sets `engines.node >= 18`. Netlify's default is fine; pin it with
`NODE_VERSION` in the environment variables if you want it reproducible.

## Testing it without deploying

```bash
npm i -g netlify-cli
netlify dev
```

`netlify dev` runs the redirect rules and the function locally, which is the
only way to exercise the path rewrite before it is live. Plain `npm start` runs
`server.js`, which serves Express directly with no rewrite at all — so it will
happily pass while the deployed version 404s.

Check at minimum:

```bash
curl -s "http://localhost:8888/api/sessions/next?childId=sam" | head -c 200
```

## A second site: the public demo

`TUTOR_DEMO=on` serves a demo anyone can play without a key, writing nothing.
It is how you put a live link in the README without handing strangers a key or
letting them wear the demo out.

Set it up as a **second Netlify site on the same repository and branch** — the
demo is a difference in configuration, not in code, so it needs no demo branch
to maintain and cannot drift from what people clone.

| Variable | Demo site |
|---|---|
| `TUTOR_DEMO` | `on` |
| `MONGODB_URI` | the same Atlas connection string |
| `MONGODB_DB` | **a demo database** — `demo-tutor`, seeded by `scripts/seed-demo.js` |
| `TUTOR_CHILD_KEY` / `TUTOR_ADMIN_KEY` | not needed; demo mode never consults them |
| `TUTOR_TZ` | optional — only affects the demo's streak display |

What the mode does:

- **No key is required**, so a visitor lands straight in the session rather
  than on the key prompt.
- **Only the child's routes and the dashboard read are reachable.** Deleting a
  session, editing the curriculum or changing the child all return 403 with
  *"This is a read-only demo."*, which the dashboard already surfaces as a
  toast and reverts.
- **Answers and "finish" are accepted and discarded.** The visitor plays a
  whole session and Ollie reacts normally, but nothing reaches the database —
  so the pending session stays pending for the next person, the demo cannot be
  worn out or vandalised, and there is nothing to reseed on a schedule.

It also means the demo dashboard shows the seeded history rather than the
session the visitor just played. That is deliberate: their play was never
stored.

### Why it refuses to start without `MONGODB_DB`

`scripts/db.js` falls back to `maths-tutor` when `MONGODB_DB` is unset. Without
a guard, a demo site with a forgotten or misspelled variable would serve **a
real child's sessions to the open internet with no key**, and would look
perfectly healthy doing it — the pages would load, the dashboard would fill in,
and nothing would be obviously wrong.

So demo mode fails closed on the database name: with `MONGODB_DB` unset, or set
to `maths-tutor`, every `/api` route returns 503 and the log says why. If the
demo site comes up blank, that is the first thing to check.

`scripts/test-demo-mode.js` covers all of this, including the guard.

---

## Things that behave differently once deployed

- **Static files** are served by the CDN, not by Express. `app.js` still has
  `express.static(public)` for local dev; on Netlify it never runs, because the
  rewrite only sends `/api/*` to the function.
- **The connection is cached per container, not per request.** `scripts/db.js`
  caches the in-flight promise so two simultaneous requests on a cold container
  cannot open two clients. Containers are recycled unpredictably, so expect a
  slow first request after any idle period.
- **`close()` is never called in production.** It exists for CLI scripts, which
  hang forever without it. Calling it from a route would drop the pool that the
  next request wants to reuse.
- **Function timeout is 10s** (26s for background functions). Fine for these
  routes; worth remembering before putting anything slow behind the API.
