-- ============================================================
-- FLASH CARDS - ROLLBACK for flash_001
--
-- Drops only the objects created by db/flash_001.sql. It never
-- touches a quiz table or any other pre-existing object.
--
-- Tables are dropped children-first so no foreign key is left
-- dangling, which also means this file works without CASCADE: it
-- can only ever remove the fc_ tables. Indexes and the seeded
-- fc_settings rows disappear with their tables.
--
-- IF EXISTS keeps it safe to run on a database where flash_001 was
-- never applied.
-- ============================================================

-- references fc_sessions + fc_cards
DROP TABLE IF EXISTS fc_session_cards;

-- references fc_cards
DROP TABLE IF EXISTS fc_review_logs;
DROP TABLE IF EXISTS fc_media;
DROP TABLE IF EXISTS fc_card_state;

-- references fc_categories
DROP TABLE IF EXISTS fc_import_jobs;
DROP TABLE IF EXISTS fc_cards;

-- references fc_folders (and itself)
DROP TABLE IF EXISTS fc_categories;
DROP TABLE IF EXISTS fc_folders;

-- standalone
DROP TABLE IF EXISTS fc_sessions;
DROP TABLE IF EXISTS fc_settings;
