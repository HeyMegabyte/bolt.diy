-- Migration 0500: Feature flags + tenant service registry + boot telemetry + tenant infra
--
-- Adds canonical persistence layer for:
--   1. flag_overrides         — per-tenant/per-org feature flag overrides (D1 source of truth)
--   2. customer_services      — per-tenant installed service registry (Listmonk, Cal.com, etc.)
--   3. boot_events            — Container DO boot/restart telemetry for cold-start UX
--   4. tenant_infra           — Per-tenant Neon project + Hyperdrive config index
--
-- All tables: UUID PK, ISO-8601 timestamps, soft-delete via deleted_at.
-- All foreign keys reference sites(id) — matches existing schema.

-- ── flag_overrides ─────────────────────────────────────────────────────────
-- Resolution order (see src/modules/feature_flags/services.ts#getFlag):
--   1. tenant override   (scope='tenant', scope_id=site_id)
--   2. org override      (scope='org',    scope_id=org_id)
--   3. Flagship rule eval (KV snapshot)
--   4. Registry default
CREATE TABLE IF NOT EXISTS flag_overrides (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL CHECK (scope IN ('tenant', 'org', 'global')),
  scope_id     TEXT NOT NULL,
  flag_key     TEXT NOT NULL,
  value_json   TEXT NOT NULL,
  set_by       TEXT,
  reason       TEXT,
  set_at       TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,
  deleted_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_flag_overrides_unique
  ON flag_overrides(scope, scope_id, flag_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_flag_overrides_scope_id
  ON flag_overrides(scope, scope_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_flag_overrides_flag_key
  ON flag_overrides(flag_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_flag_overrides_expires_at
  ON flag_overrides(expires_at)
  WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

-- ── customer_services ──────────────────────────────────────────────────────
-- One row per (site_id, service_id). Tracks which third-party services
-- (Listmonk, Cal.com, Chatwoot, Ghost, etc.) a tenant has provisioned, with
-- the corresponding DO id, Neon database, Hyperdrive config, and Bitwarden
-- vault key reference (no plaintext credentials in D1).
CREATE TABLE IF NOT EXISTS customer_services (
  id                          TEXT PRIMARY KEY,
  site_id                     TEXT NOT NULL,
  service_id                  TEXT NOT NULL,
  enabled                     INTEGER NOT NULL DEFAULT 0,
  do_id                       TEXT,
  neon_database               TEXT,
  neon_role                   TEXT,
  neon_connection_secret_ref  TEXT,
  hyperdrive_id               TEXT,
  image_tag                   TEXT,
  admin_url                   TEXT,
  region                      TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','provisioning','active','suspended','error','destroyed')),
  status_error                TEXT,
  last_active_at              TEXT,
  provisioned_at              TEXT,
  destroyed_at                TEXT,
  metadata_json               TEXT,
  deleted_at                  TEXT,
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_services_unique
  ON customer_services(site_id, service_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_services_site_id
  ON customer_services(site_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_services_status
  ON customer_services(status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_services_last_active
  ON customer_services(last_active_at)
  WHERE deleted_at IS NULL;

-- ── boot_events ───────────────────────────────────────────────────────────
-- Container DO boot + restart telemetry. Surfaces in admin UI to drive the
-- cold-start hold-on screen and the restart-cap-strict policy. One row per
-- boot attempt.
CREATE TABLE IF NOT EXISTS boot_events (
  id            TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL,
  service_id    TEXT NOT NULL,
  do_id         TEXT,
  phase         TEXT NOT NULL CHECK (phase IN ('cold_boot','warm_boot','restart','idle_evict','crash')),
  duration_ms   INTEGER,
  success       INTEGER NOT NULL DEFAULT 0,
  error_code    TEXT,
  error_message TEXT,
  metadata_json TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_boot_events_site_service
  ON boot_events(site_id, service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_boot_events_phase
  ON boot_events(phase, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_boot_events_created_at
  ON boot_events(created_at DESC);

-- ── tenant_infra ──────────────────────────────────────────────────────────
-- Per-tenant infrastructure record: Neon project, default region, status of
-- the multi-DB provisioning workflow. One row per site.
CREATE TABLE IF NOT EXISTS tenant_infra (
  id                       TEXT PRIMARY KEY,
  site_id                  TEXT NOT NULL UNIQUE,
  neon_project_id          TEXT,
  neon_project_name        TEXT,
  neon_region              TEXT,
  neon_branch_id           TEXT,
  hyperdrive_default_id    TEXT,
  bitwarden_collection_id  TEXT,
  provision_workflow_id    TEXT,
  provision_status         TEXT NOT NULL DEFAULT 'pending'
                             CHECK (provision_status IN ('pending','provisioning','active','failed','destroyed')),
  provision_error          TEXT,
  provisioned_at           TEXT,
  destroyed_at             TEXT,
  metadata_json            TEXT,
  deleted_at               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_infra_status
  ON tenant_infra(provision_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_infra_neon_project
  ON tenant_infra(neon_project_id)
  WHERE neon_project_id IS NOT NULL;
