-- edge_personalization: rules-based visitor variant selection (no PII).
-- Missing table resurrected 2026-08-13 (fire-25). service.ts INSERTs
-- (id, site_id, name, conditions, priority, created_at); conditions is a JSON
-- blob of {geo?,device?,referrer?,hour?,isReturn?}. Empty field = wildcard.
CREATE TABLE IF NOT EXISTS site_personalization_variants (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personalization_site ON site_personalization_variants(site_id, priority DESC);
