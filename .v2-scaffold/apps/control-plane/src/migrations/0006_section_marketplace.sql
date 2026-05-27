-- 0006_section_marketplace.sql
-- Backlog #34 — Section library marketplace (scaffold).
-- Schema-first install + browse pipeline. Moderation + revenue-share are
-- deferred; status defaults to 'draft' until an admin promotes to 'published'.

-- Wave 2A also tacks on:
--   #39 customer-managed invoices (Stripe Invoicing on tenant Connect acct)
--   #40 refund-as-credit ledger
--   #41 crew schedule heatmap (queries existing bookings/jobs tables)
--   #42 per-job carbon footprint persistence
--   #43 SQL AI history table

-- ── #34 Marketplace catalog + per-site installs ─────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_sections (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  author_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT,
  preview_image_url TEXT,
  html_blob_r2_key TEXT NOT NULL,
  props_schema_json TEXT NOT NULL DEFAULT '{}',
  downloads INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','flagged','archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_sections_slug
  ON marketplace_sections (slug);
CREATE INDEX IF NOT EXISTS idx_marketplace_sections_status
  ON marketplace_sections (status, downloads DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_sections_category
  ON marketplace_sections (category, downloads DESC);

CREATE TABLE IF NOT EXISTS section_installs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  installed_by TEXT,
  installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  uninstalled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_section_installs_pair
  ON section_installs (site_id, section_id) WHERE uninstalled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_section_installs_site
  ON section_installs (site_id, installed_at DESC);

-- ── #39 Customer-managed invoices (drafted on behalf of tenant Connect acct) ─
CREATE TABLE IF NOT EXISTS managed_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  stripe_invoice_id TEXT,
  stripe_customer_id TEXT,
  customer_email TEXT NOT NULL,
  line_items_json TEXT NOT NULL,   -- [{description, amount_cents, quantity}]
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','paid','uncollectible','void','sent','failed')),
  hosted_invoice_url TEXT,
  pdf_url TEXT,
  metadata_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_managed_invoices_tenant
  ON managed_invoices (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_managed_invoices_status
  ON managed_invoices (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_invoices_stripe
  ON managed_invoices (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;

-- ── #40 Refund-in-credits ledger ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT,
  customer_email TEXT,
  type TEXT NOT NULL
    CHECK (type IN ('refund_credit','consume','adjust','expire','grant')),
  amount_cents INTEGER NOT NULL,    -- positive = credit, negative = debit
  currency TEXT NOT NULL DEFAULT 'usd',
  reference TEXT,                   -- charge_id / payment_intent / booking_id
  reason TEXT,
  metadata_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_tenant_customer
  ON wallet_transactions (tenant_id, customer_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference
  ON wallet_transactions (reference);

-- ── #42 Per-job carbon footprint (persist alongside job for analytics rollups)
CREATE TABLE IF NOT EXISTS job_carbon_estimates (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  co2_kg REAL NOT NULL,
  distance_miles REAL NOT NULL,
  vehicle_type TEXT NOT NULL,
  duration_hours REAL NOT NULL,
  equivalent_text TEXT NOT NULL,
  factors_version TEXT NOT NULL DEFAULT 'epa-2024',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_job_carbon_tenant
  ON job_carbon_estimates (tenant_id, created_at DESC);

-- ── #43 SQL AI proposals history ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sql_ai_proposals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  actor_user_id TEXT,
  intent TEXT NOT NULL,
  proposed_sql TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  executed INTEGER NOT NULL DEFAULT 0,
  dry_run_plan TEXT,
  rejected_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sql_ai_site
  ON sql_ai_proposals (site_id, created_at DESC);
