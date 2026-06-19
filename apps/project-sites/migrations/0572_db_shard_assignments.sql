-- Sharded-Hyperdrive: STABLE tenant → shard assignments
-- (docs/architecture/scale-to-zero-apps-routing.md § 7).
--
-- Why a table and not just the hash: `assignShard()` is a pure hash mod
-- shardCount, so GROWING the shard pool (adding Hyperdrive shards as the platform
-- scales to 10k+ tenants) would REMAP most existing tenants to different shards —
-- catastrophic, since a tenant's data lives on its shard's Neon instance. This
-- table PERSISTS the assignment at first use, so resharding only routes NEW
-- tenants to the new shards; existing tenants keep their recorded slot. The hash
-- is just the initial placement.
--
-- Additive + reversible: no tenant data is moved here, only the shard index.
CREATE TABLE IF NOT EXISTS tenant_db_assignments (
  tenant_id   TEXT PRIMARY KEY,                 -- org / instance id
  shard_index INTEGER NOT NULL,                 -- 0 .. (MAX_HYPERDRIVE_SHARDS-1)
  db_name     TEXT,                             -- logical DB on the shard (isolation); null until provisioned
  assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_db_assignments_shard
  ON tenant_db_assignments (shard_index);

-- Shard metadata: which Neon instance + Hyperdrive config backs each shard.
-- Populated by the (decision-gated) provisioner; the binding name is derived
-- (`HYPERDRIVE_SHARD_n`) so it isn't stored.
CREATE TABLE IF NOT EXISTS db_shards (
  shard_index          INTEGER PRIMARY KEY,     -- 0 .. 24
  neon_project_id      TEXT,                    -- the Neon instance backing this shard
  hyperdrive_config_id TEXT,                    -- CF Hyperdrive config id (null until provisioned)
  region               TEXT,
  status               TEXT NOT NULL DEFAULT 'planned', -- planned | active | draining
  tenant_count         INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
