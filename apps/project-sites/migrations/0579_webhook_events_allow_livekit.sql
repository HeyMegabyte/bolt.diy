-- 0579 — widen webhook_events.provider CHECK to include 'livekit'.
--
-- The LiveKit voice-receptionist webhook (/webhooks/livekit) persists + de-dupes
-- events via webhook_events with provider 'livekit'. The original 0001 CHECK
-- (`provider IN ('stripe','dub','chatwoot','novu','lago')`) omitted it, so inserts
-- failed silently and idempotency never registered (drift vs the TS WebhookProvider
-- union in @project-sites/shared, which now includes 'livekit').
--
-- SQLite cannot ALTER a CHECK constraint, so rebuild the table. Verified 0 rows in
-- webhook_events at apply time (2026-06-27) — the copy is a no-op — but written as a
-- safe rename-copy-drop so it is correct regardless of row count. Schema, indexes,
-- and the UNIQUE(provider, event_id) idempotency constraint are identical to 0001;
-- only the provider CHECK is extended by 'livekit'.

DROP TABLE IF EXISTS webhook_events_new;

CREATE TABLE webhook_events_new (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES orgs(id),
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'dub', 'chatwoot', 'novu', 'lago', 'livekit')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_pointer TEXT,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'failed', 'quarantined')),
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  UNIQUE (provider, event_id)
);

INSERT INTO webhook_events_new SELECT * FROM webhook_events;

DROP TABLE webhook_events;

ALTER TABLE webhook_events_new RENAME TO webhook_events;

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_event ON webhook_events (provider, event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events (status) WHERE status IN ('received', 'processing');
