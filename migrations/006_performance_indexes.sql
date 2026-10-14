-- ============================================================
-- PERFORMANCE INDEXES
--
-- Additive only. This file contains nothing but CREATE INDEX
-- statements. It does not create, alter or drop a table or a
-- column, and it never reads, writes, moves or deletes a row.
-- Indexes change no data and no table structure - they only let
-- the planner answer read queries without scanning whole tables.
--
-- Every statement is idempotent (IF NOT EXISTS), so running this
-- file any number of times is safe. Indexes are created with the
-- default (non-unique, non-concurrent) form on purpose: it matches
-- the existing migrations, it adds no uniqueness constraint of its
-- own, and the tables are small enough that the brief lock is
-- irrelevant.
--
-- Each index below is tied to a query the API actually runs.
-- ============================================================


-- ---------- options ----------
--
-- Every quiz screen loads a question's options with
--   WHERE question_id = ANY(...)   /   WHERE question_id = $1
-- and GET /api/questions/:id does the same. Without this index
-- each lookup is a sequential scan of the whole options table.
--
-- This index also matters for writes: the enforce_single_correct_option
-- trigger runs "SELECT count(*) FROM options WHERE question_id = NEW.question_id"
-- after every single-row option insert/update, so seeding a category
-- or bulk-uploading questions currently rescans options once per option.
CREATE INDEX IF NOT EXISTS idx_options_question_id
  ON options (question_id);


-- ---------- categories ----------
--
-- category.subject_id is a foreign key with no supporting index.
-- GET /api/categories?subjectId=... filters on it, and deleting a
-- subject has to find its categories to cascade - both otherwise
-- scan every category.
CREATE INDEX IF NOT EXISTS idx_categories_subject_id
  ON categories (subject_id);


-- ---------- questions ----------
--
-- The hottest read in the app: loading a category to start a quiz
-- runs "SELECT * FROM questions WHERE category_id = $1 ORDER BY created_at DESC".
-- The existing idx_questions_category_id narrows the scan but still
-- leaves an explicit sort. Leading with category_id and carrying
-- created_at DESC serves both the filter and the ordering.
CREATE INDEX IF NOT EXISTS idx_questions_category_created_at
  ON questions (category_id, created_at DESC);


-- ---------- quiz_attempts ----------
--
-- quiz_attempts.category_id is a foreign key with no supporting
-- index. It backs the per-category history lookups and the cascade
-- when a category is deleted.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_category_id
  ON quiz_attempts (category_id);

-- GET /api/categories/:id runs two history queries scoped to the
-- caller and the category, one of them ordered by finish time:
--   WHERE category_id = $1 AND finished_at IS NOT NULL AND user_id = $2
--   ... same ... ORDER BY finished_at DESC LIMIT 10
-- This composite satisfies both, including the sort, in one pass.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_category_finished
  ON quiz_attempts (user_id, category_id, finished_at DESC);


-- ---------- flagged_questions ----------
--
-- GET /api/admin/questions tests each row with
--   EXISTS (... FROM flagged_questions f WHERE f.question_id = q.id AND f.status = 'open')
-- The existing index on question_id alone cannot also filter on
-- status, so this composite lets that check be answered from the
-- index. It equally serves the admin flag-triage list, which reads
-- one question's flags ordered by status.
CREATE INDEX IF NOT EXISTS idx_flagged_questions_question_status
  ON flagged_questions (question_id, status);

-- GET /api/questions/meta (called when opening a quiz and when
-- viewing results) reads the caller's own flags with
--   WHERE user_id = $1 AND question_id = ANY(...)
-- The existing index on user_id alone covers the first column only.
CREATE INDEX IF NOT EXISTS idx_flagged_questions_user_question
  ON flagged_questions (user_id, question_id);


-- ---------- question_difficulty_tags ----------
--
-- Same shape as the flag lookup above: GET /api/questions/meta reads
--   WHERE user_id = $1 AND question_id = ANY(...)
-- so the pair of columns is what wants an index, not user_id alone.
CREATE INDEX IF NOT EXISTS idx_question_difficulty_tags_user_question
  ON question_difficulty_tags (user_id, question_id);


-- ---------- starred_questions ----------
--
-- GET /api/categories/:id/starred-questions lists a category's stars
--   WHERE category_id = $1 ORDER BY starred_at DESC, id DESC
-- The existing single-column index finds the rows but then sorts
-- them. This composite returns them already ordered.
CREATE INDEX IF NOT EXISTS idx_starred_questions_category_starred_at
  ON starred_questions (category_id, starred_at DESC, id DESC);


-- ---------- attempt_answers ----------
--
-- The wrong-answer and question-stats aggregations both pull a
-- category's answers and pick the latest answer per question per
-- attempt:
--   SELECT DISTINCT ON (aa.question_id, aa.attempt_id) ...
--   FROM attempt_answers aa ... WHERE q.category_id = $1
--   ORDER BY aa.question_id, aa.attempt_id, aa.id DESC
-- Leading with (question_id, attempt_id, id DESC) supplies rows in
-- exactly the order that DISTINCT ON needs, so the planner can skip
-- the sort it would otherwise do for every question.
CREATE INDEX IF NOT EXISTS idx_attempt_answers_question_attempt
  ON attempt_answers (question_id, attempt_id, id DESC);
