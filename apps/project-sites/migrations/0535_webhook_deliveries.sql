-- Outbound Webhooks (#10) delivery log — one row per delivery ATTEMPT, written
-- by the dispatch orchestrator (reuses services/outbound_webhooks.ts
-- attemptDelivery). Powers the per-site delivery history + debugging. Append-only.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  site_id     TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  ok          INTEGER NOT NULL,
  attempt     INTEGER NOT NULL DEFAULT 1,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_site ON webhook_deliveries (site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at);
