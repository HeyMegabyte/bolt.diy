-- 0584_native_social_v2.sql
-- Native Social v2 — idempotency + token refresh tracking on existing Pulse Social tables.
-- Extends 0034_pulse_social.sql (social_accounts, pulse_posts, social_publishes, social_analytics_snapshots).
-- No new tables — ALTER only. Idempotent (guards on column existence).

-- correlation_id: workflow passes Idempotency-Key through → D1 unique constraint prevents double-publish.
-- D1 doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, so we catch the error in migration runner.
ALTER TABLE social_publishes ADD COLUMN correlation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_publishes_correlation
  ON social_publishes(correlation_id) WHERE correlation_id IS NOT NULL;

-- Token refresh tracking on social_accounts.
ALTER TABLE social_accounts ADD COLUMN refresh_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE social_accounts ADD COLUMN last_refreshed_at TEXT;

-- Index for the token-refresh cron sweep: find accounts nearing expiry.
CREATE INDEX IF NOT EXISTS idx_social_accounts_refresh
  ON social_accounts(token_expires_at, status, refresh_count)
  WHERE deleted_at IS NULL AND status = 'active';
