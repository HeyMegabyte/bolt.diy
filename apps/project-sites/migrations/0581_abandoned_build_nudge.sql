-- 0581_abandoned_build_nudge.sql
-- Abandoned-build recovery nudge (#27): track the last recovery-email timestamp
-- per site so the scheduled sweep is idempotent + throttled (never re-nudges within
-- the re-nudge window). NULL = never nudged. Epoch milliseconds.
-- Additive + nullable → zero blast radius (blast-radius-minimization).
ALTER TABLE sites ADD COLUMN nudged_at INTEGER;

-- Partial-ish index to make the cron scan cheap: finished, never-recently-nudged.
CREATE INDEX IF NOT EXISTS idx_sites_nudge_scan
  ON sites (status, nudged_at)
  WHERE deleted_at IS NULL;
