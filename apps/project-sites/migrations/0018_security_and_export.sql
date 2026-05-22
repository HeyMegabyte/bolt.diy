-- Org security defaults (single row per org) + queued export jobs.

CREATE TABLE IF NOT EXISTS org_security (
  org_id              TEXT PRIMARY KEY,
  session_hours       INTEGER NOT NULL DEFAULT 168,
  idle_minutes        INTEGER NOT NULL DEFAULT 60,
  allowed_domains     TEXT,
  require_2fa         INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_exports (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  r2_key      TEXT,
  size_bytes  INTEGER,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_org_exports_org ON org_exports(org_id, created_at DESC);
