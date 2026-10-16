-- ============================================================
-- FLASH CARDS - CORE SCHEMA (flash_001)
--
-- Additive only. Every table is CREATE TABLE IF NOT EXISTS and
-- every index is CREATE INDEX IF NOT EXISTS. Nothing that already
-- exists is altered, moved or dropped, and no existing row is read
-- or written. Safe to run repeatedly, and safe to run on a database
-- that already holds the quiz tables (subjects, categories,
-- questions, options, users, quiz_attempts, ...). The quiz tables
-- are never referenced here.
--
-- All objects are prefixed fc_. Every table carries
-- user_id TEXT NOT NULL DEFAULT 'local' so anonymous / single-user
-- data ("local") coexists with per-account data added later.
--
-- Conventions follow the existing schema: SERIAL surrogate ids,
-- TIMESTAMPTZ created_at DEFAULT now(), snake_case columns.
-- Session ids are BIGINT because fc_card_state.last_seen_session is
-- BIGINT.
--
-- Delete behaviour:
--   folder -> categories            CASCADE
--   parent category -> children     CASCADE
--   category -> cards               CASCADE
--   card -> state / media / logs    CASCADE
--   session -> session_cards        CASCADE
--   import job -> category          SET NULL (the job row survives)
-- ============================================================


-- ---------- fc_folders ----------
-- Top level grouping ("Decks"). Pure metadata for organisation.
CREATE TABLE IF NOT EXISTS fc_folders (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT        NOT NULL DEFAULT 'local',
  name        TEXT        NOT NULL,
  description TEXT,
  color       TEXT,
  icon        TEXT,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- fc_categories ----------
-- Belongs to a folder and may nest under a parent category.
CREATE TABLE IF NOT EXISTS fc_categories (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT        NOT NULL DEFAULT 'local',
  folder_id   INT         NOT NULL REFERENCES fc_folders(id)    ON DELETE CASCADE,
  parent_id   INT                  REFERENCES fc_categories(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- fc_cards ----------
-- front / back hold arbitrary card JSON (text, image refs, etc.).
-- tags is an array so it can be searched with the GIN index below.
CREATE TABLE IF NOT EXISTS fc_cards (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT        NOT NULL DEFAULT 'local',
  category_id INT         NOT NULL REFERENCES fc_categories(id) ON DELETE CASCADE,
  card_type   TEXT        NOT NULL DEFAULT 'basic',
  front       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  back        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  tags        TEXT[]      NOT NULL DEFAULT '{}',
  source      TEXT,
  source_ref  TEXT,
  suspended   BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- fc_card_state ----------
-- One scheduling row per card (spaced repetition). card_id is both
-- the primary key and the FK, so a card can never have two states.
-- Scheduler columns (stability, difficulty, ...) are nullable so a
-- brand-new card can exist with state = new and no review history.
CREATE TABLE IF NOT EXISTS fc_card_state (
  card_id           INT         PRIMARY KEY REFERENCES fc_cards(id) ON DELETE CASCADE,
  user_id           TEXT        NOT NULL DEFAULT 'local',
  state             SMALLINT    NOT NULL DEFAULT 0,
  due               TIMESTAMPTZ,
  stability         REAL,
  difficulty        REAL,
  reps              INT         NOT NULL DEFAULT 0,
  lapses            INT         NOT NULL DEFAULT 0,
  last_review       TIMESTAMPTZ,
  avg_think_ms      INT,
  struggle_score    REAL        NOT NULL DEFAULT 0,
  last_seen_session BIGINT
);


-- ---------- fc_media ----------
-- Images / audio attached to a card side ('front' | 'back').
CREATE TABLE IF NOT EXISTS fc_media (
  id       SERIAL PRIMARY KEY,
  user_id  TEXT NOT NULL DEFAULT 'local',
  card_id  INT  NOT NULL REFERENCES fc_cards(id) ON DELETE CASCADE,
  side     TEXT,
  kind     TEXT,
  url      TEXT,
  mime     TEXT,
  bytes    INT
);


-- ---------- fc_review_logs ----------
-- Append-only history of every answer. id is BIGSERIAL because this
-- is the highest-volume table. session_id intentionally has no FK
-- (logs outlive a session and may be written without one).
CREATE TABLE IF NOT EXISTS fc_review_logs (
  id               BIGSERIAL   PRIMARY KEY,
  user_id          TEXT        NOT NULL DEFAULT 'local',
  card_id          INT         NOT NULL REFERENCES fc_cards(id) ON DELETE CASCADE,
  session_id       BIGINT,
  rating           SMALLINT,
  think_ms         INT,
  total_ms         INT,
  state_before     SMALLINT,
  stability_before REAL,
  stability_after  REAL,
  is_echo          BOOLEAN     NOT NULL DEFAULT false,
  reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- fc_sessions ----------
-- One study sitting. scope_type / scope_id describe what was studied
-- (e.g. a folder or a category) without hard-coding a single FK.
CREATE TABLE IF NOT EXISTS fc_sessions (
  id              BIGSERIAL   PRIMARY KEY,
  user_id         TEXT        NOT NULL DEFAULT 'local',
  scope_type      TEXT,
  scope_id        INT,
  mode            TEXT,
  fraction        REAL,
  planned_count   INT         NOT NULL DEFAULT 0,
  completed_count INT         NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ
);


-- ---------- fc_session_cards ----------
-- The ordered queue a session works through. Composite primary key
-- prevents the same card appearing twice in one session.
CREATE TABLE IF NOT EXISTS fc_session_cards (
  user_id    TEXT NOT NULL DEFAULT 'local',
  session_id BIGINT NOT NULL REFERENCES fc_sessions(id) ON DELETE CASCADE,
  card_id    INT    NOT NULL REFERENCES fc_cards(id)    ON DELETE CASCADE,
  position   INT    NOT NULL DEFAULT 0,
  reason     TEXT,
  PRIMARY KEY (session_id, card_id)
);


-- ---------- fc_import_jobs ----------
-- Tracks a bulk import. category_id is nullable and SET NULL so the
-- job's history survives if its target category is later removed.
CREATE TABLE IF NOT EXISTS fc_import_jobs (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT        NOT NULL DEFAULT 'local',
  source_type TEXT,
  filename    TEXT,
  category_id INT                  REFERENCES fc_categories(id) ON DELETE SET NULL,
  status      TEXT        NOT NULL DEFAULT 'pending',
  total       INT         NOT NULL DEFAULT 0,
  created     INT         NOT NULL DEFAULT 0,
  error_log   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------- fc_settings ----------
-- Key/value settings per user. "key" is a non-reserved keyword in
-- Postgres and is usable unquoted as a column name.
CREATE TABLE IF NOT EXISTS fc_settings (
  user_id TEXT  NOT NULL DEFAULT 'local',
  key     TEXT  NOT NULL,
  value   JSONB,
  PRIMARY KEY (user_id, key)
);


-- ============================================================
-- INDEXES (only reads, never data)
-- ============================================================

-- Scheduler picks the next due card.
CREATE INDEX IF NOT EXISTS idx_fc_card_state_due
  ON fc_card_state (due);

-- "Struggling cards" view / ordering.
CREATE INDEX IF NOT EXISTS idx_fc_card_state_struggle_score
  ON fc_card_state (struggle_score);

-- Listing a category's cards, and the category -> card cascade.
CREATE INDEX IF NOT EXISTS idx_fc_cards_category_id
  ON fc_cards (category_id);

-- Tag search (tags @> ARRAY[...]).
CREATE INDEX IF NOT EXISTS idx_fc_cards_tags
  ON fc_cards USING GIN (tags);

-- Per-card review history, newest first.
CREATE INDEX IF NOT EXISTS idx_fc_review_logs_card_reviewed_at
  ON fc_review_logs (card_id, reviewed_at);


-- ============================================================
-- DEFAULT SETTINGS
-- Idempotent: ON CONFLICT DO NOTHING never overwrites a value the
-- user has already changed.
-- ============================================================

INSERT INTO fc_settings (user_id, key, value) VALUES
  ('local', 'desired_retention',   '0.9'::jsonb),
  ('local', 'new_cards_per_day',   '20'::jsonb),
  ('local', 'focus_fraction',      '0.25'::jsonb),
  ('local', 'focus_min',           '10'::jsonb),
  ('local', 'focus_max',           '60'::jsonb),
  ('local', 'struggle_slow_ratio', '1.75'::jsonb),
  ('local', 'struggle_weights',    '{"time":0.35,"again":0.3,"lapse":0.2,"hard":0.15}'::jsonb)
ON CONFLICT (user_id, key) DO NOTHING;
