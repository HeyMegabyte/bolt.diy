-- Per-SITE database allocation (Cloudflare-first doctrine §4/§5).
--
-- Complements tenant_db_assignments (0572 — stable tenant→shard PLACEMENT) by
-- recording, per SITE, which db PLAN it was allocated:
--   none → d1_tenant_db → neon_shared_shard → neon_dedicated_project
-- D1 is the default; Neon is the escape hatch. neon_shared_shard rows reference
-- the tenant's shard (shard_id) + the derived shard-level Hyperdrive binding
-- (HYPERDRIVE_SHARD_n) — NOT one Hyperdrive config per site.
--
-- Additive + reversible: records the allocation decision; moves no tenant data.
CREATE TABLE IF NOT EXISTS site_database_allocations (
  tenant_id               TEXT NOT NULL,
  site_id                 TEXT NOT NULL PRIMARY KEY,
  db_plan                 TEXT NOT NULL,          -- none | d1_tenant_db | neon_shared_shard | neon_dedicated_project
  region                  TEXT NOT NULL DEFAULT 'auto',
  shard_id                TEXT,                   -- shard_index for neon_shared_shard; null otherwise
  hyperdrive_binding_name TEXT,                   -- HYPERDRIVE_SHARD_n (shared) or per-project (dedicated); null for none/d1
  neon_project_id         TEXT,                   -- set for neon_dedicated_project
  neon_database           TEXT,
  neon_schema             TEXT,
  status                  TEXT NOT NULL DEFAULT 'active', -- active | provisioning | migrating | retired
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_site_db_alloc_tenant ON site_database_allocations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_site_db_alloc_plan   ON site_database_allocations (db_plan);
