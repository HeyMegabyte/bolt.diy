-- Migration: site_health table for Site Health Auto-Rebuild Worker
-- Worker: infra/monitor/worker.ts (cron: every 5 min)
--
-- Tracks consecutive health-check failures per site.
-- After 3 consecutive failures, the Worker enqueues an auto-rebuild.
-- On any successful check, consecutive_failures resets to 0.

CREATE TABLE IF NOT EXISTS site_health (
  site_id              TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_failure_at      TEXT,
  last_status_code     INTEGER,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_health_failures
  ON site_health(consecutive_failures)
  WHERE consecutive_failures >= 2;
