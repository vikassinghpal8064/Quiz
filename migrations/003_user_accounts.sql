-- ============================================================
-- USER ACCOUNTS (admin + regular user)
--
-- Additive only. Creates two new tables and adds two nullable
-- ownership columns. No existing row in questions, options,
-- subjects, categories, quiz_attempts, attempt_answers or
-- starred_questions is deleted or modified.
--
-- Pre-existing quiz_attempts / starred_questions rows are left
-- with user_id = NULL. We deliberately do NOT backfill an owner
-- for historical data.
-- ============================================================

-- ---------- users ----------
-- username UNIQUE and phone_number UNIQUE each create a unique
-- btree index (users_username_key, users_phone_number_key).
-- email is intentionally NOT unique, so it gets a plain index.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone_number  TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ---------- password_reset_tokens ----------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports "invalidate all outstanding tokens for this user" and
-- periodic expiry sweeps.
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON password_reset_tokens (expires_at);

-- ---------- ownership on existing tables ----------
-- Nullable so pre-accounts rows survive untouched.
-- ON DELETE SET NULL (not CASCADE): deleting an account must never
-- silently destroy quiz history. The rows stay, ownerless.
ALTER TABLE quiz_attempts
  ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE starred_questions
  ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;

-- Scopes every per-user history query (wrong / starred / new /
-- question-stats) to one owner.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_starred_questions_user_id ON starred_questions (user_id);

-- ---------- starred_questions: per-user stars ----------
-- Was UNIQUE(question_id) -> now UNIQUE(question_id, user_id) so two
-- users can each star the same question independently.
--
-- Safe with zero data movement: the old UNIQUE(question_id) already
-- guaranteed question_id was distinct across all 114 existing rows,
-- so the new (question_id, user_id) key cannot conflict.
ALTER TABLE starred_questions
  DROP CONSTRAINT IF EXISTS starred_questions_question_id_key;

ALTER TABLE starred_questions
  ADD CONSTRAINT starred_questions_question_id_user_id_key
  UNIQUE (question_id, user_id);
