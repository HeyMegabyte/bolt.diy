-- Round D: per-site credit caps + org ownership transfers (14-day pending).

CREATE TABLE IF NOT EXISTS site_credit_caps (
  org_id              TEXT NOT NULL,
  site_id             TEXT NOT NULL,
  monthly_credit_cap  INTEGER,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, site_id)
);

CREATE TABLE IF NOT EXISTS org_transfers (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  from_user_id  TEXT NOT NULL,
  to_email      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_org_transfers_org_status ON org_transfers(org_id, status, created_at DESC);
