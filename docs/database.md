# Connecting the database

Read this if you have never set up a database before. It assumes nothing, and
it is the step most people get stuck on — so if something here does not match
what you see, that is worth telling us about rather than working around.

**The short version:** this app keeps everything in MongoDB. You need a free
MongoDB account, and one long line of text from it pasted into a file called
`.env`. Then run `npm run check` and it tells you whether it worked.

---

## What the database is actually for

Two collections, and they stay small:

- **`children`** — one document. The child's name and age, their approved topic
  list, and their progress on every topic.
- **`sessions`** — one document per day's work. The questions, what the child
  typed, the marks, and the feedback card.

A year of daily sessions is a few megabytes. The free tier is 512 MB. You are
not going to outgrow it, and you will never be asked for a card.

---

## Option A — MongoDB Atlas (recommended)

Atlas is MongoDB's hosted service. The free tier ("M0") is permanently free,
not a trial. Budget ten minutes.

Atlas changes its wording from time to time, so the four things you need are
listed here by **what they are**, not by exact button labels. If a label has
moved, the thing itself still exists under a similar name.

### 1. An account and a cluster

Sign up at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas), then
create a cluster and **choose the M0 / Free option**. Anything else costs money.

The defaults are all fine. Pick whichever region is nearest you. The cluster
takes a few minutes to finish creating; you can carry on while it does.

> You get one free cluster per project. If you already have one for something
> else, make a new project rather than paying for a second cluster.

### 2. A database user

This is the part that confuses nearly everyone, so to be explicit:

> **The database user is not your Atlas login.** Your Atlas account is the
> email and password you sign in to the website with. The database *user* is a
> separate username and password that the app uses to read and write data.
> They are two different accounts. Mixing them up is the single most common
> cause of "authentication failed".

Under **Database Access**, create a user. Let Atlas generate the password and
**copy it somewhere now** — it will not show it to you again.

Give it **"Read and write to any database"**. The app writes constantly: every
answer, mark and feedback card is a write. A read-only user will connect fine
and then fail the first time you grade anything.

> If you choose your own password, use **letters and numbers only.** A password
> containing `@ : / ? # %` breaks the connection string in a way whose error
> message points nowhere near the real cause. See the troubleshooting table.

### 3. Network access

Under **Network Access**, add your computer's IP address. Atlas has a button
that fills in your current one.

Two things worth knowing now rather than later:

- **Home IP addresses usually change.** A rule that worked last month can stop
  working for no visible reason. If everything suddenly times out, check here
  first.
- **If you deploy this** (so the child can use it on their own device), there is
  no fixed address to add, and you will need a different rule. That case is
  covered in [deploy.md](deploy.md) — don't worry about it yet.

### 4. The connection string

Find the **Connect** button on your cluster, choose the **Drivers** option
(Node.js), and copy the string. It looks like this:

```
mongodb+srv://dbUser:<db_password>@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority
```

**Replace `<db_password>`, angle brackets and all, with the password from step
2.** Atlas hands you the string with that placeholder still in it, and leaving
it is the most common mistake there is.

Right:

```
mongodb+srv://dbUser:Xk29fPq7mZ@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority
```

Wrong — placeholder left in:

```
mongodb+srv://dbUser:<db_password>@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority
```

Wrong — angle brackets removed but the password not actually pasted:

```
mongodb+srv://dbUser:db_password@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority
```

You do **not** need to add a database name to the string. The app sets its own
(`maths-tutor`); anything after the `/` is ignored.

### 5. Paste it in and check

```bash
cp .env.example .env
```

Open `.env` in any text editor and put the string after `MONGODB_URI=`, with no
quotes and no spaces around the `=`:

```
MONGODB_URI=mongodb+srv://dbUser:Xk29fPq7mZ@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority
```

Then:

```bash
npm run check
```

That is the whole point of this step. It tells you in plain English whether the
connection works, whether the user can write, and if not, which of the four
usual causes it is. It never prints your password.

A working result:

```
✓ Connected, and the database answered.

  children: 0
  sessions: 0

✓ This user can write, which the app needs.
```

`.env` is gitignored, so your password is never committed. Do not paste the
connection string into anything public — it is the only credential protecting
the data.

---

## Option B — MongoDB on your own machine

If you would rather not use a hosted service, install MongoDB locally
([instructions](https://www.mongodb.com/docs/manual/administration/install-community/)),
start it, and use:

```
MONGODB_URI=mongodb://localhost:27017
```

No user, no password, no network rules. The trade-off: the data lives only on
that machine, nothing backs it up, and you cannot deploy the child's page to a
real URL — a deployed site cannot reach `localhost`. Fine for trying things
out; Atlas is the better home for a child's actual history.

---

## When it does not work

Run `npm run check` first — it already explains most of these. This table is
for looking up the driver's own words if you have seen them somewhere else.

| What you see | What it really means |
|---|---|
| `MONGODB_URI is not set` | No `.env` file, or the line is empty. `cp .env.example .env` and fill it in. |
| `Invalid scheme, expected connection string to start with "mongodb://"` | A web address got pasted instead of the connection string — usually the Atlas page you were looking at, rather than the string behind **Connect**. |
| `querySrv ENOTFOUND _mongodb._tcp.cluster0...` | The cluster address is wrong. Nearly always the `<db_password>` placeholder left in; otherwise a typo, or a deleted cluster. **If your `MONGODB_URI` contains `<` or `>` anywhere, that is the bug.** |
| `querySrv ENOTFOUND` naming something that looks like **part of your password** | Your password contains `@ : / ? # ` or `%`, which ends the password early and makes the rest read as a server name. Change that user's password in Atlas to letters and numbers only. |
| `bad auth : Authentication failed` | The address is right; the credentials are not. Almost always the Atlas *login* used instead of the *database user* from step 2. Reset that user's password under Database Access. |
| Hangs ten to thirty seconds, then a server-selection timeout | Your IP is not on the access list (step 3), or your local MongoDB is not running. This fails as silence rather than a refusal, which is why it reads like the app is broken. |
| Connects, then grading fails when saving | The database user is read-only. Give it "Read and write to any database". `npm run check` catches this before you hit it. |

---

## Looking after the data

- **It is the real record.** The child's history, every verdict and every
  session lives here and nowhere else. The repo is gitignored against it on
  purpose.
- **Atlas free tier has no automatic backups.** For a year of a child's
  progress, an occasional manual export is worth the two minutes:
  [`mongodump`](https://www.mongodb.com/docs/database-tools/mongodump/), or
  **Collections → Export** in the Atlas UI.
- **Changing the database name** is `MONGODB_DB` in `.env`. Useful for keeping a
  throwaway copy to experiment on, which is how `seed-demo.js --remove`
  suggests previewing alongside real data.

---

## Next

Back to the [README](../README.md) for the two access keys and `/setup-child`.
