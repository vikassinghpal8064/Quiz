-- ============================================================
-- NEW QUESTIONS MODE
-- Widens the existing quiz_attempts.mode CHECK constraint to
-- also allow 'new_only'. No table, column, or row is touched.
--
-- 'new_only' is derived entirely from existing data; it needs no
-- new table or column. A question is "new" for a category when its
-- id appears in neither attempt_answers (for attempts in that
-- category) nor starred_questions.
-- ============================================================

ALTER TABLE quiz_attempts
  DROP CONSTRAINT IF EXISTS quiz_attempts_mode_check,
  ADD CONSTRAINT quiz_attempts_mode_check CHECK (mode IN ('full', 'wrong_only', 'starred_only', 'new_only'));
