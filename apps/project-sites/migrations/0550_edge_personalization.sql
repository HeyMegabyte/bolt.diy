-- Migration: 0550_edge_personalization
-- Adds site_personalization_variants table for the edge_personalization feature module.

CREATE TABLE IF NOT EXISTS site_personalization_variants (
  id         TEXT NOT NULL,
  site_id    TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  conditions TEXT NOT NULL DEFAULT '{}',
  priority   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_spv_site_id ON site_personalization_variants(site_id);
