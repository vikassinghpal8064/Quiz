CREATE TABLE subjects (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon_name   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  subject_id  INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id             SERIAL PRIMARY KEY,
  category_id    INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  question_text  TEXT NOT NULL,
  explanation    TEXT,
  image_url      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_questions_category_id ON questions(category_id);

CREATE TABLE options (
  id          SERIAL PRIMARY KEY,
  question_id INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct  BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================
-- ACCOUNTS
-- ============================================================
-- Created before quiz_attempts / starred_questions because both
-- reference it.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  -- Intentionally NOT unique: a whole class or family can share one
  -- address. That also means registration cannot be used to probe
  -- whether an email is registered.
  email         TEXT NOT NULL,
  phone_number  TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);

-- Looked up case-insensitively on login and on forgot-password. The
-- username index also enforces case-insensitive username uniqueness in
-- the database, so a concurrent pair of registrations cannot slip
-- "Alice" and "alice" past the application-level pre-check.
CREATE UNIQUE INDEX idx_users_username_lower ON users(lower(username));
CREATE INDEX        idx_users_email_lower    ON users(lower(email));

-- Password reset tokens. One row per request; only the newest unused,
-- unexpired row is redeemable. Tokens are random 32-byte hex strings.
CREATE TABLE password_reset_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user_id    ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- ============================================================
-- QUIZ ACTIVITY
-- ============================================================
-- user_id is NULLABLE on purpose: it is NULL for every row that predates
-- accounts. The app always writes the current user's id, and reads are
-- strictly scoped by user_id, so those ownerless legacy rows are simply
-- never attributed to anybody. ON DELETE SET NULL means deleting an
-- account orphans its history instead of destroying it.

CREATE TABLE quiz_attempts (
  id               SERIAL PRIMARY KEY,
  user_id          INT REFERENCES users(id) ON DELETE SET NULL,
  category_id      INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  mode             TEXT NOT NULL CHECK (mode IN ('full', 'wrong_only', 'starred_only', 'new_only')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  score            INT,
  total_questions  INT
);

CREATE INDEX idx_quiz_attempts_user_id ON quiz_attempts(user_id);

CREATE TABLE attempt_answers (
  id                  SERIAL PRIMARY KEY,
  attempt_id          INT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id         INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option_id  INT NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  is_correct          BOOLEAN NOT NULL
);

CREATE INDEX idx_attempt_answers_attempt_id  ON attempt_answers(attempt_id);
CREATE INDEX idx_attempt_answers_question_id ON attempt_answers(question_id);

-- A star is per (question, user), so any number of users can star the
-- same question independently. See the note above on NULL user_id.
CREATE TABLE starred_questions (
  id            SERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(id) ON DELETE SET NULL,
  question_id   INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  category_id   INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  starred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id, user_id)
);

CREATE INDEX idx_starred_questions_user_id     ON starred_questions(user_id);
CREATE INDEX idx_starred_questions_category_id ON starred_questions(category_id);

-- ============================================================
-- EXACTLY ONE CORRECT OPTION PER QUESTION
-- ============================================================
-- PostgreSQL has no built-in constraint for "count where true = 1"
-- across rows, so we use a CONSTRAINT trigger that fires after each
-- INSERT/UPDATE statement on options (deferrable, initially immediate).
-- Because it is checked at statement end, it sees the final state of a
-- multi-row INSERT (where the correct option may not be the first row).

CREATE OR REPLACE FUNCTION enforce_single_correct_option()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT count(*) FROM options WHERE question_id = NEW.question_id AND is_correct = true) != 1 THEN
    RAISE EXCEPTION 'Each question must have exactly one correct option (question_id %)', NEW.question_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_single_correct_option
  AFTER INSERT OR UPDATE OF is_correct ON options
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_correct_option();
