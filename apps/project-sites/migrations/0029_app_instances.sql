-- 0029_app_instances.sql
--
-- "Apps" tab — self-hostable open-source apps deployed onto CF Workers
-- Containers with auto-provisioned aux infra (Neon Postgres, Upstash
-- Redis, R2 buckets). One row per deployed instance scoped to an org.
--
-- ## Encryption
--
-- `env_encrypted` stores the AES-GCM encrypted JSON blob of the resolved
-- env-var map (per `ai_crypto.ts` using `MCP_ENCRYPTION_KEY`). The IV is
-- inlined per `ai_crypto.encrypt`, so `env_iv` is a placeholder kept for
-- forward-compat with key-rotation pipelines.
--
-- ## Status machine
--
--   provisioning → starting → running → stopped | error | destroyed
--
-- ## Provisioned aux IDs
--
-- We persist the IDs of every aux resource we created on behalf of this
-- instance so the DELETE flow can deprovision them transactionally (no
-- orphaned Neon projects, no orphaned Upstash DBs, no orphaned R2 buckets).

CREATE TABLE IF NOT EXISTS app_instances (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  app_slug TEXT NOT NULL,
  subdomain TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  env_encrypted TEXT,
  env_iv TEXT,
  neon_project_id TEXT,
  upstash_database_id TEXT,
  r2_bucket_name TEXT,
  do_instance_id TEXT,
  last_started_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_instances_org
  ON app_instances(org_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_instances_subdomain
  ON app_instances(subdomain) WHERE deleted_at IS NULL;
