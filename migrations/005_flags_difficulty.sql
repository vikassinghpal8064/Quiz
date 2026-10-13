-- ============================================================
-- FLAGS + DIFFICULTY TAGS
--
-- Additive only. Creates two new tables and their indexes. No
-- existing table, column, or row is created, dropped or altered.
--
-- Both tables are per (question, user):
--   * a user may flag a question once and re-file the flag later
--   * a user may tag a question easy/medium/hard once
--
-- category_id is deliberately NOT stored here: a question's category
-- is already questions.category_id and is derived by joining.
-- ============================================================

-- ---------- flagged_questions ----------
-- One row per (question, user). status drives the admin triage:
-- 'open' flags are what flag_count and the Flagged filter count.
CREATE TABLE IF NOT EXISTS flagged_questions (
  id          SERIAL PRIMARY KEY,
  question_id INT  NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id     INT  NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('wrong_answer_key','typo','unclear_question','wrong_explanation','other')),
  comment     TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by INT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (question_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_flagged_questions_user_id     ON flagged_questions (user_id);
CREATE INDEX IF NOT EXISTS idx_flagged_questions_question_id ON flagged_questions (question_id);
CREATE INDEX IF NOT EXISTS idx_flagged_questions_status      ON flagged_questions (status);

-- ---------- question_difficulty_tags ----------
-- One row per (question, user). updated_at is bumped by the endpoint
-- on every change.
CREATE TABLE IF NOT EXISTS question_difficulty_tags (
  id          SERIAL PRIMARY KEY,
  question_id INT  NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id     INT  NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  difficulty  TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_question_difficulty_tags_user_id     ON question_difficulty_tags (user_id);
CREATE INDEX IF NOT EXISTS idx_question_difficulty_tags_question_id ON question_difficulty_tags (question_id);
