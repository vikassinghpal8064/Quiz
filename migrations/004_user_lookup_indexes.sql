-- ============================================================
-- ALIGN users WITH THE CANONICAL SCHEMA
--
-- Additive only. No existing row is deleted or modified. Safe on a
-- database that already has user accounts.
-- ============================================================

-- ---------- case-insensitive lookup indexes ----------
--
-- The app looks users up case-insensitively in two places:
--   login / forgot-password  : WHERE lower(email) = lower($1)
--   register duplicate check: WHERE lower(username) = lower($1)
--
-- Without these indexes both are sequential scans, and more
-- importantly lower(username) is not enforced as unique, so a
-- concurrent pair of registrations could slip "Alice" and "alice"
-- past the application-level pre-check. This index makes the
-- database itself reject that.

-- Enforces case-insensitive username uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (lower(username));

-- Supports the login and forgot-password email lookups.
CREATE INDEX IF NOT EXISTS idx_users_email_lower
  ON users (lower(email));

-- Supports the expiry sweep over outstanding reset tokens.
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON password_reset_tokens (expires_at);
