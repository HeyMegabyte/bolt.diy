CREATE TABLE IF NOT EXISTS aeo_audits (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  org_id TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  issues TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aeo_audits_site_id ON aeo_audits(site_id);
