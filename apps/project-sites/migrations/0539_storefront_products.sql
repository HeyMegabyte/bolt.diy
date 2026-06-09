-- Storefront e-commerce — per-site product catalog (flag: storefront_ecommerce).
-- Owner-managed products that a published site can sell. Additive + idempotent.
-- D1 has no `ADD COLUMN IF NOT EXISTS`, so the CREATE TABLE runs once per env.

CREATE TABLE IF NOT EXISTS storefront_products (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  site_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  price_cents     INTEGER NOT NULL DEFAULT 0,             -- minor units (cents)
  currency        TEXT NOT NULL DEFAULT 'USD',            -- ISO 4217
  image_url       TEXT,
  sku             TEXT,
  stock           INTEGER,                                -- null = untracked/unlimited
  status          TEXT NOT NULL DEFAULT 'active',         -- active|hidden|archived
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

-- List a site's live catalog fast (newest first).
CREATE INDEX IF NOT EXISTS idx_storefront_products_site
  ON storefront_products (site_id, created_at)
  WHERE deleted_at IS NULL;

-- Tenant scope guard for org-level queries.
CREATE INDEX IF NOT EXISTS idx_storefront_products_org
  ON storefront_products (org_id)
  WHERE deleted_at IS NULL;
