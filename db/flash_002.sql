-- ============================================================
-- FLASH CARDS - MEDIA INDEXES + STORAGE COLUMNS (flash_002)
--
-- Additive only: CREATE INDEX IF NOT EXISTS / ALTER TABLE ... ADD COLUMN
-- IF NOT EXISTS, nothing altered or dropped, no data touched. Safe to run
-- repeatedly and safe on a database that already holds flash_001 (and the
-- quiz tables).
--
-- Why: image / audio blocks mirror their object into fc_media on every card
-- save (see api/_lib/flashCards.js mediaRowsFromSides), and a card delete/edit
-- reads fc_media by card_id and re-checks an object path across the user's rows
-- before deleting it (api/_lib/flashMedia.js deleteUnreferencedMedia). fc_media
-- had no index on either the card or the object path, so those lookups were
-- sequential scans.
--
-- The storage_* columns were added when media moved from Vercel Blob to
-- Supabase Storage: storage_path is the object key inside the bucket (so a
-- delete never has to parse a URL) and storage_provider records which provider
-- wrote the row. Old rows keep their original URL and a NULL storage_path, so
-- they stay readable and are simply never deleted from a bucket.
-- ============================================================

-- Card -> its media (also speeds up the FK cascade on card delete).
CREATE INDEX IF NOT EXISTS idx_fc_media_card_id
  ON fc_media (card_id);

-- "Is this object still referenced by any of this user's rows?" - the
-- pre-delete re-check before an object is removed from the bucket.
CREATE INDEX IF NOT EXISTS idx_fc_media_user_url
  ON fc_media (user_id, url);

-- Where the object lives inside the bucket, and which provider wrote it.
ALTER TABLE fc_media ADD COLUMN IF NOT EXISTS storage_provider text DEFAULT 'supabase';
ALTER TABLE fc_media ADD COLUMN IF NOT EXISTS storage_path text;

-- Deletion re-checks an object path across the user's rows by this pair.
CREATE INDEX IF NOT EXISTS idx_fc_media_user_storage_path
  ON fc_media (user_id, storage_path);
