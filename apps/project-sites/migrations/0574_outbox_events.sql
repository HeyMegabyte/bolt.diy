-- Transactional outbox for the normalized event bus (convergence spec §15–16).
-- Every golden-path state transition writes a CloudEvents-1.0 ProjectSitesEvent
-- row here; a dispatcher drains pending rows to Queues/Workflows/Novu.
-- Idempotent (idempotency_key UNIQUE), tenant-scoped, DLQ-aware (status='failed'
-- + attempts is the dead-letter signal).
CREATE TABLE IF NOT EXISTS outbox_events (
  id              TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  site_id         TEXT,
  trace_id        TEXT NOT NULL,
  producer        TEXT NOT NULL,
  payload         TEXT NOT NULL,                 -- full CloudEvents JSON envelope
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | dispatched | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  dispatched_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events (status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_tenant ON outbox_events (tenant_id, created_at);
