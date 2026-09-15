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
schema.sql      # Postgres schema: subjects, categories, questions, options, quiz_attempts, attempt_answers
src/pages/      # Dashboard, CategoryList, QuizIntro, QuizTaking, Results, AdminUpload
src/components/ # Cards, modals, toasts, page transitions, loading skeletons, empty states
src/lib/        # CSV parser
```

## CSV upload format

At `/admin/upload`, bulk questions via CSV with the columns:

```
question, option1, option2, option3, option4, correct_option, explanation
```

`correct_option` is 1–4. An optional header row is skipped; quote fields that
contain commas.# Quiz
