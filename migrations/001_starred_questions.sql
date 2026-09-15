-- ============================================================
-- STARRED QUESTIONS
-- Manually starred/bookmarked questions for later review.
-- Completely independent of attempt_answers / wrong-answer tracking.
-- ============================================================

CREATE TABLE starred_questions (
  id            SERIAL PRIMARY KEY,
  question_id   INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  category_id   INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  starred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id)
);

CREATE INDEX idx_starred_questions_category_id ON starred_questions(category_id);

-- Allow "starred_only" as a quiz attempt mode (alongside 'full' and 'wrong_only').
ALTER TABLE quiz_attempts
  DROP CONSTRAINT IF EXISTS quiz_attempts_mode_check,
  ADD CONSTRAINT quiz_attempts_mode_check CHECK (mode IN ('full', 'wrong_only', 'starred_only'));
