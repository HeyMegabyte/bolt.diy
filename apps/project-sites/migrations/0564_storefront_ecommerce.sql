-- Migration 0564: storefront_ecommerce feature module tables + feature flag seed

CREATE TABLE IF NOT EXISTS storefront_products (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  site_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  price_cents   INTEGER NOT NULL DEFAULT 0,
  currency      TEXT DEFAULT 'usd',
  status        TEXT NOT NULL DEFAULT 'draft',
  image_url     TEXT,
  metadata_json TEXT,
  created_at    TEXT,
  updated_at    TEXT,
  deleted_at    TEXT
);

INSERT OR IGNORE INTO feature_flags (key, enabled, rollout_percent, stage, description, owner_email)
VALUES (
  'storefront_ecommerce',
  0,
  0,
  'experimental',
  'Per-site product storefront for selling physical or digital goods. Each org can list products with price, images, and status (draft/active/archived) tied to a specific site.',
  'brian@megabyte.space'
);
