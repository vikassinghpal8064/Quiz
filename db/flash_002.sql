-- ============================================================
-- FLASH CARDS - MEDIA INDEXES (flash_002)
--
-- Additive only: CREATE INDEX IF NOT EXISTS, nothing altered or
-- dropped, no data touched. Safe to run repeatedly and safe on a
-- database that already holds flash_001 (and the quiz tables).
--
-- Why: image / audio blocks mirror their blob URL into fc_media on
-- every card save (see api/_lib/flashCards.js mediaRowsFromSides),
-- and a card delete/ edit reads fc_media by card_id and re-checks a
-- URL across the user's rows before deleting a blob
-- (api/_lib/flashMedia.js deleteUnreferencedBlobs). fc_media had no
-- index on either column, so those lookups were sequential scans.
-- ============================================================

-- Card -> its media (also speeds up the FK cascade on card delete).
CREATE INDEX IF NOT EXISTS idx_fc_media_card_id
  ON fc_media (card_id);

-- "Is this blob URL still referenced by any of this user's rows?" - the
-- pre-delete re-check before a blob is removed from the store.
CREATE INDEX IF NOT EXISTS idx_fc_media_user_url
  ON fc_media (user_id, url);
