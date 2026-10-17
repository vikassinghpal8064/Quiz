-- ============================================================
-- FLASH CARDS - MEDIA CONTENT HASH (flash_005)
--
-- Additive only: ALTER TABLE ... ADD COLUMN IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS, nothing altered or dropped, no data touched. Safe to run
-- repeatedly and safe on a database that already holds flash_001..004.
--
-- Why: the image pipeline hashes every encoded upload (SHA-256) so that
-- identical bytes are stored once. When the browser asks
-- POST /api/flash/media/sign for a URL and sends the hash, the server looks up
-- fc_media for a row this user already owns with that hash and returns the
-- existing object instead of minting a new upload URL. fc_media had no hash
-- column, so there was nothing to look up.
--
-- Old rows keep a NULL hash: they are simply never matched (their bytes predate
-- the pipeline, so the client has no hash to look for), and they keep working
-- unchanged.
-- ============================================================

-- The content hash of the stored object, lowercase hex SHA-256 (64 chars).
ALTER TABLE fc_media ADD COLUMN IF NOT EXISTS hash text;

-- The de-duplication probe: "does this user already own an object with this
-- content hash?" Scoped by user_id so one account's uploads never collide with
-- another's, and partial on storage_path IS NOT NULL because a row without a
-- stored object (an old Vercel Blob URL) cannot be re-used as an upload target.
CREATE INDEX IF NOT EXISTS idx_fc_media_user_hash
  ON fc_media (user_id, hash)
  WHERE hash IS NOT NULL;
