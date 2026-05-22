-- 0022_usage_metering.sql
-- #99 Usage-based pricing — meter ai_calls, bytes_egress, image_generations
-- per org, aggregate nightly, and forward to Stripe for overage billing.
--
-- See: src/services/usage_metering.ts, src/routes/api.ts (/api/billing/usage*).

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT REFERENCES sites(id),
  metric TEXT NOT NULL CHECK (metric IN ('ai_calls', 'bytes_egress', 'image_generations')),
  value INTEGER NOT NULL CHECK (value >= 0),
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- 0 = not yet sent to Stripe, 1 = already billed (subscription_item_usage_record).
  billed INTEGER NOT NULL DEFAULT 0,
  -- Stripe subscription_item id used when the row was billed (for replay).
  stripe_subscription_item_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_events_org_metric_ts
  ON usage_events (org_id, metric, ts);
CREATE INDEX IF NOT EXISTS idx_usage_events_unbilled
  ON usage_events (org_id, billed) WHERE billed = 0;

-- Nightly aggregates per metric — one row per (org, day, metric).
-- The aggregate view is read by the /api/billing/usage/this-month endpoint so
-- it never scans the full usage_events table on hot path.
CREATE VIEW IF NOT EXISTS v_usage_daily_ai_calls AS
  SELECT org_id, substr(ts, 1, 10) AS day, SUM(value) AS total
  FROM usage_events WHERE metric = 'ai_calls'
  GROUP BY org_id, day;

CREATE VIEW IF NOT EXISTS v_usage_daily_bytes_egress AS
  SELECT org_id, substr(ts, 1, 10) AS day, SUM(value) AS total
  FROM usage_events WHERE metric = 'bytes_egress'
  GROUP BY org_id, day;

CREATE VIEW IF NOT EXISTS v_usage_daily_image_generations AS
  SELECT org_id, substr(ts, 1, 10) AS day, SUM(value) AS total
  FROM usage_events WHERE metric = 'image_generations'
  GROUP BY org_id, day;
