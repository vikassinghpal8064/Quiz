-- ============================================================
-- FLASH CARDS - FOCUS SESSION METADATA (flash_003)
--
-- Additive only: CREATE TABLE / CREATE INDEX IF NOT EXISTS,
-- nothing altered or dropped, no existing data touched. Safe to
-- run repeatedly and safe on a database that already holds
-- flash_001 / flash_002 (and the quiz tables).
--
-- Why: a focus session is assembled from four pools (due,
-- struggle, new, coverage) and the study summary reports how many
-- due cards the session could not reach. fc_sessions has nowhere
-- to hold that, and the scheduler history must not be altered to
-- make room, so one small side table records what the builder
-- decided when the session was created.
--
-- Only focus sessions write here; every other mode ignores it.
-- A database without this table still serves due / struggling /
-- all sessions - only mode = focus needs it.
-- ============================================================

-- One row per focus session, 1:1 with fc_sessions. The FK cascades
-- so abandoning a session removes its metadata with it.
CREATE TABLE IF NOT EXISTS fc_session_focus (
  session_id     BIGINT      PRIMARY KEY REFERENCES fc_sessions(id) ON DELETE CASCADE,
  user_id        TEXT        NOT NULL DEFAULT 'local',
  -- N: the size the builder aimed for (clamp of the fraction).
  target_count   INT         NOT NULL DEFAULT 0,
  -- How many queued cards came from each pool.
  due_count      INT         NOT NULL DEFAULT 0,
  struggle_count INT         NOT NULL DEFAULT 0,
  new_count      INT         NOT NULL DEFAULT 0,
  stale_count    INT         NOT NULL DEFAULT 0,
  -- Due cards the target could not fit: the session's backlog.
  leftover_due   INT         NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Metadata is always read one session at a time (by session_id, its
-- primary key), so no extra index is needed for that lookup. This
-- one only helps any future per-user roll-up.
CREATE INDEX IF NOT EXISTS idx_fc_session_focus_user
  ON fc_session_focus (user_id);
