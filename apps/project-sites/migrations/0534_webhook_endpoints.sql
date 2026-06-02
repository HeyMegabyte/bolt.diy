-- Outbound Webhooks (#10) — customer-subscribed endpoints that receive signed,
-- retried deliveries of site events. The signing secret is stored ENCRYPTED at
-- rest (AES-GCM via services/ai_crypto.ts; iv embedded in the blob). url +
-- event_types validated by services/outbound_webhooks.ts before insert. Org+
-- site scoped, soft-deleted. Delivery attempts (a separate webhook_deliveries
-- table) + the dispatch loop land in a later slice.

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id               TEXT PRIMARY KEY,
  site_id          TEXT NOT NULL,
  org_id           TEXT NOT NULL,
  url              TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,   -- AES-GCM blob (never returned to clients)
  event_types      TEXT NOT NULL,   -- JSON array of allowlisted event types
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_site
  ON webhook_endpoints (site_id, deleted_at);
