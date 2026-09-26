# MCQ Quiz App

A full-stack multiple-choice quiz app. React + Vite frontend with a set of Vercel
serverless API functions backed by a Neon (Postgres) database.

Students pick a subject → category, take a **full test** over all questions or a
**practice session** over only questions they've got wrong before, and review
their answers afterward with explanations. Admins can add questions one at a
time or bulk-upload via CSV at `/admin/upload`.

## Tech stack

- **Frontend:** React 19, Vite, Tailwind CSS v4, React Router, Framer Motion
- **Backend:** Vercel serverless functions under `/api` (Node.js)
- **Database:** Neon (Postgres) via `@neondatabase/serverless`

## Prerequisites

- Node.js 20.19+ (or 22.12+)
- A [Neon](https://neon.tech) account (free tier is fine)
- Optional: the [Vercel CLI](https://vercel.com/docs/cli) for deployments

## 1. Set up the database on Neon

1. In the Neon console, create a project (region near your users).
2. Open **SQL Editor**, paste the contents of [`schema.sql`](./schema.sql), and
   run it.
3. Copy the project's **connection string** (the one starting with
   `postgresql://` or `postgres://`). It looks like:

   ```
   postgresql://user:password@ep-xxxxx.region.aws.neon.tech/dbname?sslmode=require
   ```

Alternatively, if you have `psql` installed:

```bash
psql "postgresql://user:password@ep-xxxxx.region.aws.neon.tech/dbname?sslmode=require" -f schema.sql
```

## 2. Set the `DATABASE_URL` environment variable

The API reads the connection string from `DATABASE_URL`.

### Locally

```bash
cp .env.example .env
```

Then edit `.env` and replace the placeholder with your real Neon connection
string:

```
DATABASE_URL="postgresql://user:password@ep-xxxxx.region.aws.neon.tech/dbname?sslmode=require"
```

> `.env` is git-ignored, so the connection string is never committed. Only
> `.env.example` (with a placeholder) is tracked.

### Auth and password-reset variables

Accounts are required for everything except the login, register and
password-reset pages. Add these to `.env` (and to your Vercel project
settings) as well:

| Variable | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | yes | Signs the 7-day session cookie. At least 32 characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Changing it logs everyone out. |
| `APP_URL` | yes | Public origin used to build reset links, e.g. `https://your-app.vercel.app`. No trailing slash. |
| `RESEND_API_KEY` | for real emails | Resend API key (`re_…`) from <https://resend.com/api-keys>. |
| `RESEND_FROM_EMAIL` | for real emails | Verified sender. `onboarding@resend.dev` works only for your own Resend account address; anything else needs a verified domain. |

If `RESEND_API_KEY` is unset the app still runs: "forgot password" writes the
reset link to the server console instead of sending mail. The API always replies
with the same generic message so it never reveals whether an address is
registered.

### Making someone an admin

Registration always creates a `role = 'user'` account; there is deliberately no
public way to become an admin. Promote yourself once:

```sql
UPDATE users SET role = 'admin' WHERE username = 'your-username';
```

Then log out and back in so the new role is picked up.

### About email addresses

`username` and `phone_number` are unique, and username uniqueness is
case-insensitive. `email` is **not** unique, so a whole class or family can
share one address.

### On Vercel

Add `DATABASE_URL` as an environment variable for the project:

- **Dashboard:** Project → **Settings → Environment Variables** → add
  `DATABASE_URL` → set its value → save. Do this for all relevant
  environments (Production / Preview / Development).
- **CLI:**

  ```bash
  vercel env add DATABASE_URL
  ```

  Paste the connection string when prompted, pick which environments
  (Production, Preview, Development), and confirm.

Add `JWT_SECRET`, `APP_URL`, `RESEND_API_KEY` and `RESEND_FROM_EMAIL` the same
way. `JWT_SECRET` and `APP_URL` are required for the app to work at all; the two
Resend values are only needed to actually send reset emails.

## 3. Run locally

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`).

The dev server also runs the `/api/*` serverless functions locally (via a small
built-in middleware that mimics Vercel), so `npm run dev` is all you need — no
separate API process. Point the app at a real `DATABASE_URL` (step 2) and the
pages will load real data.

Build & lint:

```bash
npm run build   # production build into dist/
npm run lint    # oxlint
```

## 4. Deploy to Vercel

**Option A — push to GitHub/GitLab and import:**

1. Push this repo to your Git host.
2. In Vercel, **Add New → Project**, select the repo. Vercel auto-detects Vite
   (build `npm run build`, output `dist`), and picks up the `/api` functions.
3. Add the `DATABASE_URL` environment variable (Production) under **Settings →
   Environment Variables**, then **Deploy**.

**Option B — CLI:**

```bash
npm i -g vercel
vercel            # first time: follow the prompts; it deploys a preview URL
vercel --prod     # promote to production
```

Add the env var before deploying if you didn't set it in the dashboard:

```bash
vercel env add DATABASE_URL
```

After deploying, memories-free: run the schema once (step 1), set `DATABASE_URL`,
and the app is live.

## Project structure

```
api/            # Vercel serverless functions (subjects, categories, questions, attempts, results, ...)
  _lib/auth.js  # JWT issue/verify, session cookie, requireAuth / requireAdmin
  _lib/email.js # Resend client
  auth/         # register, login, logout, me, forgot-password, reset-password
migrations/     # Ordered SQL migrations; run with `node scripts/migrate.mjs`
schema.sql      # Canonical schema: users, password_reset_tokens, subjects,
                # categories, questions, options, quiz_attempts, attempt_answers,
                # starred_questions
shared/         # Validation rules shared by the API and the React forms
src/pages/      # Dashboard, CategoryList, QuizIntro, QuizTaking, Results, AdminUpload,
                # Login, Register, ForgotPassword, ResetPassword
src/components/ # Cards, modals, toasts, page transitions, auth provider and route guards
src/lib/        # CSV parser, auth context, auth form styles
scripts/        # Verification suites (see below)
```

## Verification suites

Each script talks to the real database and cleans up everything it creates, so
they can be run any time. They `exit(1)` on the first failure.

```bash
node scripts/verify_auth.mjs      # accounts, roles, per-user isolation, reset flow
node scripts/verify_routing.mjs   # dev-server API router resolves every /api route
node scripts/verify_schema.mjs    # schema.sql executes and matches the live DB
node scripts/verify_new_only.mjs  # the "new only" quiz mode
node scripts/verify_edit_delete.mjs
```

## CSV upload format

At `/admin/upload`, bulk questions via CSV with the columns:

```
question, option1, option2, option3, option4, correct_option, explanation
```

`correct_option` is 1–4. An optional header row is skipped; quote fields that
contain commas.# Quiz
