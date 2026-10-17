-- ============================================================
-- FLASH CARDS - STATS (flash_004)
--
-- Additive only: CREATE INDEX IF NOT EXISTS / INSERT ... ON
-- CONFLICT DO NOTHING. Nothing is altered, renamed or dropped and
-- no existing row is read or written. Safe to run repeatedly and
-- safe on a database that already holds flash_001 / 002 / 003
-- (and the quiz tables, which are never referenced here).
--
-- Why: /flash/stats reads only fc_review_logs and fc_card_state.
-- The existing indexes cover "this card's history"
-- (card_id, reviewed_at) but not the account-wide aggregations the
-- page runs - reviews per day, retention by state, the 30-day due
-- forecast, the state breakdown, and the hardest-cards table. Once
-- an account has more than a few thousand reviews those queries
-- fall back to sequential scans, so this migration adds the
-- leading user_id composites they order and filter on.
-- ============================================================

-- Reviews per day (the heatmap), the think-time trend and the streak:
-- every one of them filters on user_id and a reviewed_at window.
CREATE INDEX IF NOT EXISTS idx_fc_review_logs_user_reviewed_at
  ON fc_review_logs (user_id, reviewed_at);

-- True retention: the same window, but split by the state the card was
-- in *before* the answer (state_before = 2 = Review).
CREATE INDEX IF NOT EXISTS idx_fc_review_logs_user_state_reviewed_at
  ON fc_review_logs (user_id, state_before, reviewed_at);

-- Per-card history within the account (the review log tail for one
-- card, scoped to the caller). Complements the pre-existing
-- (card_id, reviewed_at) index with the user_id leading column.
CREATE INDEX IF NOT EXISTS idx_fc_review_logs_user_card_reviewed_at
  ON fc_review_logs (user_id, card_id, reviewed_at);

-- The 30-day due forecast: unsuspended cards due before a date.
CREATE INDEX IF NOT EXISTS idx_fc_card_state_user_due
  ON fc_card_state (user_id, due);

-- Cards by state (new / learning / review / mastered).
CREATE INDEX IF NOT EXISTS idx_fc_card_state_user_state
  ON fc_card_state (user_id, state);

-- The hardest-cards table: highest struggle_score first.
CREATE INDEX IF NOT EXISTS idx_fc_card_state_user_struggle
  ON fc_card_state (user_id, struggle_score DESC);

-- Resolving the per-folder / per-category filter joins fc_cards on its
-- category; the existing single-column index misses the user scoping.
CREATE INDEX IF NOT EXISTS idx_fc_cards_user_category
  ON fc_cards (user_id, category_id);


-- ============================================================
-- DAILY GOAL
-- The home screen shows progress toward a daily review goal. It is a
-- normal fc_settings row, so it is idempotent and never overwrites a
-- value the user has already changed.
-- ============================================================

INSERT INTO fc_settings (user_id, key, value) VALUES
  ('local', 'daily_goal', '30'::jsonb)
ON CONFLICT (user_id, key) DO NOTHING;
