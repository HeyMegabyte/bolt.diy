CREATE TABLE IF NOT EXISTS site_tags (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  emoji TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_tags_org ON site_tags(org_id, deleted_at);
CREATE TABLE IF NOT EXISTS site_tag_assignments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_tag_assign_site ON site_tag_assignments(site_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_site_tag_assign_tag ON site_tag_assignments(tag_id, deleted_at);
