-- 0024 — `spend_alerts` table for org-scoped billing alert rules.
--
-- Backs `POST/GET/DELETE /api/billing/spend-alerts`. Frontend used to stash
-- alert rules in localStorage; we now persist per org with one row per named
-- alert so the nightly Cron worker can fan-out notifications.
--
-- Columns:
--   - `trigger_type` enum {balance_below, monthly_spend_above, rate_spike}.
--     `balance_below` fires when `credits.getBalance(org) < threshold_credits`.
--     `monthly_spend_above` fires when `usage_events` rollup for the calendar
--     month exceeds the threshold. `rate_spike` fires when burn-rate (credits
--     per hour, 24h moving avg) is ≥ threshold over a 1h sliding window.
--   - `threshold_credits` is INTEGER credits (the same unit credits.ts uses
--     for billing math). Integer comparison is cheaper than a JSON parse.
--   - `channels_json` is a JSON array — `["email"]` today, future-proof for
--     Slack/Discord/PagerDuty without a schema change.
--   - `last_fired_at` + `fire_count` let the cron worker rate-limit alerts
--     so a single low-balance condition doesn't generate 24 emails/day.
--
-- Indexes:
--   - `idx_spend_alerts_org` for the GET-list pagination path.
--   - `idx_spend_alerts_trigger` for the cron sweep fan-out.

CREATE TABLE IF NOT EXISTS spend_alerts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  site_id TEXT REFERENCES sites(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('balance_below', 'monthly_spend_above', 'rate_spike')
  ),
  threshold_credits INTEGER NOT NULL CHECK (threshold_credits >= 0),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  channels_json TEXT NOT NULL DEFAULT '["email"]',
  last_fired_at TEXT,
  fire_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_spend_alerts_org
  ON spend_alerts (org_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_spend_alerts_trigger
  ON spend_alerts (trigger_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_spend_alerts_site
  ON spend_alerts (site_id) WHERE deleted_at IS NULL AND site_id IS NOT NULL;
