-- AN5 — daily rollup of visitor_events → per-site/per-day aggregates.
-- Lets owner-analytics answer "last 30 days" in O(days) rows instead of
-- scanning O(events) raw rows. Populated by the `rollupAnalyticsDaily` cron
-- (src/services/analytics_rollup.ts), wired into the Worker scheduled() handler.
-- Additive + idempotent: re-running a day UPSERTs the same row.

CREATE TABLE IF NOT EXISTS analytics_daily (
  site_id         TEXT NOT NULL,
  org_id          TEXT NOT NULL,
  day             TEXT NOT NULL,                       -- 'YYYY-MM-DD' (UTC)
  pageviews       INTEGER NOT NULL DEFAULT 0,          -- event_type='pageview'
  unique_sessions INTEGER NOT NULL DEFAULT 0,          -- COUNT(DISTINCT session_id)
  conversions     INTEGER NOT NULL DEFAULT 0,          -- event_type='conversion'
  total_events    INTEGER NOT NULL DEFAULT 0,          -- all events that day
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (site_id, day)
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_site_day ON analytics_daily (site_id, day);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_org_day  ON analytics_daily (org_id, day);
