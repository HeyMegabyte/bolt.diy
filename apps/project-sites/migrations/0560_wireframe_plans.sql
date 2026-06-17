CREATE TABLE IF NOT EXISTS wireframe_plans (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  org_id TEXT,
  prompt TEXT NOT NULL,
  sections TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wireframe_plans_site_id ON wireframe_plans(site_id);
