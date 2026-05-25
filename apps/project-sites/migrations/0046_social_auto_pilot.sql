-- 0046_social_auto_pilot.sql
-- Pulse Social — Auto-Pilot autonomous composer config.
--
-- One row per org. When `enabled = 1`, the every-minute cron picks the row
-- up once `next_run_at <= now` and fires the autonomous composer which
-- drafts posts (status='draft' in pulse_posts) using `prompt` as the
-- system prompt + `target_networks_json` as the platform list. The user
-- reviews the drafts before publish — auto-pilot does NOT auto-publish
-- by default (safety rail).

CREATE TABLE IF NOT EXISTS social_auto_pilot (
  org_id                TEXT PRIMARY KEY,
  enabled               INTEGER NOT NULL DEFAULT 0,
  prompt                TEXT NOT NULL DEFAULT '',
  cadence_hours         INTEGER NOT NULL DEFAULT 24,
  target_networks_json  TEXT,                              -- JSON [PlatformId]
  last_run_at           INTEGER,                           -- epoch ms
  next_run_at           INTEGER,                           -- epoch ms
  created_at            INTEGER NOT NULL,                  -- epoch ms
  updated_at            INTEGER NOT NULL                   -- epoch ms
);

-- Cron sweep index: enabled rows past due, ordered by oldest first.
CREATE INDEX IF NOT EXISTS idx_social_auto_pilot_next_run
  ON social_auto_pilot(next_run_at)
  WHERE enabled = 1;
