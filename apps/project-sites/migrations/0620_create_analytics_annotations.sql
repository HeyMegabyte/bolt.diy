CREATE TABLE IF NOT EXISTS analytics_annotations (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  date TEXT NOT NULL,
  note TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_analytics_annotations_site ON analytics_annotations(site_id, deleted_at);
