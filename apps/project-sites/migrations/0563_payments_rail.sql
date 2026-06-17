-- Migration 0563: payments_rail feature module tables + feature flag seed

CREATE TABLE IF NOT EXISTS payments_rail_events (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  site_id      TEXT,
  provider     TEXT NOT NULL CHECK(provider IN ('stripe','square')),
  event_type   TEXT NOT NULL,
  amount_cents INTEGER,
  currency     TEXT DEFAULT 'usd',
  status       TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO feature_flags (key, enabled, rollout_percent, stage, description, owner_email)
VALUES (
  'payments_rail',
  0,
  0,
  'experimental',
  'Unified payments rail events for Stripe and Square. Captures payment lifecycle events per org and site for audit, reconciliation, and revenue analytics.',
  'brian@megabyte.space'
);
