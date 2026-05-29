-- Migration 0522: Comparison + Alternative Pages Engine
--
-- Supports feature #31 — auto /vs/{competitor} + /alternatives/{competitor}.
--
-- competitors: registry of competing products per site. Each has a pricing
-- URL that a weekly scheduled Worker re-fetches via Browser Rendering REST.
--
-- comparison_pages: one row per (site, competitor, kind). kind in
-- ('vs','alternatives') so we can ship both shapes off the same data source.

CREATE TABLE IF NOT EXISTS competitors (
  id              TEXT PRIMARY KEY,
  site_id         TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  org_id          TEXT NOT NULL,
  slug            TEXT NOT NULL,           -- "stripe", "square"
  name            TEXT NOT NULL,
  homepage_url    TEXT,
  pricing_url     TEXT,
  pricing_json    TEXT,                    -- {plans:[{name,price_usd,...}], scraped_at}
  pricing_scraped_at TEXT,
  screenshot_r2   TEXT,
  features_json   TEXT,                    -- {has_x: bool, has_y: bool, ...}
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitors_slug
  ON competitors(site_id, slug)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS comparison_pages (
  id              TEXT PRIMARY KEY,
  site_id         TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  org_id          TEXT NOT NULL,
  competitor_slug TEXT NOT NULL,
  kind            TEXT NOT NULL            -- 'vs' or 'alternatives'
                    CHECK (kind IN ('vs','alternatives')),
  route_slug      TEXT NOT NULL,
  content_json    TEXT,
  jsonld_json     TEXT,                    -- ItemList + FAQPage
  comparison_table_json TEXT,              -- side-by-side feature/pricing rows
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','published','rejected')),
  published_at    TEXT,
  r2_path         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comparison_pages_unique
  ON comparison_pages(site_id, competitor_slug, kind)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_comparison_pages_status
  ON comparison_pages(site_id, status)
  WHERE deleted_at IS NULL;

INSERT OR IGNORE INTO feature_flags (key, description, enabled_globally, rollout_pct)
VALUES (
  'comparison_pages',
  'Comparison + Alternative Pages: /vs/{competitor} + /alternatives/{competitor} with weekly pricing refresh.',
  0,
  0
);
