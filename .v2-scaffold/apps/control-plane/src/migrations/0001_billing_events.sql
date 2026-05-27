-- 0001_billing_events.sql
-- Port of apps/project-sites/migrations/0048_billing_events.sql for the v2 control-plane
-- platform D1. Tracks every Stripe charge / meter / refund / dispute / subscription
-- transition + meter reports + manual super-admin adjustments.

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('stripe_webhook', 'meter_report', 'wallet_action', 'manual')),
  stripe_object_id TEXT,
  stripe_event_id TEXT,
  stripe_object_type TEXT,
  amount_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'usd',
  site_id TEXT,
  webhook_event_id TEXT,
  wallet_transaction_id TEXT,
  usage_event_id TEXT,
  metric TEXT,
  payload_pointer TEXT,
  payload_hash TEXT,
  result TEXT NOT NULL DEFAULT 'ok' CHECK (result IN ('ok', 'pending', 'failed', 'disputed', 'refunded')),
  error_message TEXT,
  idempotency_key TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_events_org_occurred
  ON billing_events (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_site_occurred
  ON billing_events (site_id, occurred_at DESC) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_events_event_type
  ON billing_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_object
  ON billing_events (stripe_object_id) WHERE stripe_object_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_events_failures
  ON billing_events (result, occurred_at DESC) WHERE result IN ('failed', 'disputed');
