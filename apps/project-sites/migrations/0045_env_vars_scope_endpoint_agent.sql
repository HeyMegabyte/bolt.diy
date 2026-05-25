-- AI Environment Variables — extend scope to include 'endpoint' and 'agent'
-- so any AI/Endpoint context with MCPs can carry custom env vars. SQLite
-- forbids ALTER on CHECK constraints, so we use the table-swap pattern:
--   1. Add new columns additively (safe).
--   2. Build a parallel `ai_env_vars_new` with the wider CHECK.
--   3. Copy rows, swap, recreate per-scope partial unique indexes.
--
-- Scope precedence at resolve-time (see services/ai_env_vars.ts):
--   org → site → mcp → endpoint → agent (each later scope overrides earlier)

-- Step 1: additive column adds (safe even if migration retried).
ALTER TABLE ai_env_vars ADD COLUMN endpoint_id TEXT;
ALTER TABLE ai_env_vars ADD COLUMN agent_id TEXT;

-- Step 2: rebuild table with expanded CHECK constraint via swap.
CREATE TABLE ai_env_vars_new (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('org','site','mcp','endpoint','agent')),
  site_id TEXT,                            -- present when scope='site'
  mcp_provider TEXT,                       -- present when scope='mcp'
  endpoint_id TEXT,                        -- present when scope='endpoint'
  agent_id TEXT,                           -- present when scope='agent'
  key TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,           -- AES-GCM ciphertext base64
  description TEXT,
  is_secret INTEGER NOT NULL DEFAULT 1,
  exposed_to_ai INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

INSERT INTO ai_env_vars_new
  (id, org_id, scope, site_id, mcp_provider, endpoint_id, agent_id, key,
   value_encrypted, description, is_secret, exposed_to_ai, created_by,
   created_at, updated_at, deleted_at)
SELECT id, org_id, scope, site_id, mcp_provider, endpoint_id, agent_id, key,
       value_encrypted, description, is_secret, exposed_to_ai, created_by,
       created_at, updated_at, deleted_at
  FROM ai_env_vars;

DROP TABLE ai_env_vars;
ALTER TABLE ai_env_vars_new RENAME TO ai_env_vars;

-- Step 3: recreate partial unique indexes for all five scopes + lookup indexes.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_env_vars_org
  ON ai_env_vars(org_id, key)
  WHERE scope = 'org' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_env_vars_site
  ON ai_env_vars(org_id, site_id, key)
  WHERE scope = 'site' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_env_vars_mcp
  ON ai_env_vars(org_id, mcp_provider, key)
  WHERE scope = 'mcp' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_env_vars_endpoint
  ON ai_env_vars(org_id, endpoint_id, key)
  WHERE scope = 'endpoint' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_env_vars_agent
  ON ai_env_vars(org_id, agent_id, key)
  WHERE scope = 'agent' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_env_vars_org_scope
  ON ai_env_vars(org_id, scope, deleted_at);
CREATE INDEX IF NOT EXISTS idx_env_vars_site
  ON ai_env_vars(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_env_vars_mcp
  ON ai_env_vars(org_id, mcp_provider) WHERE mcp_provider IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_env_vars_endpoint
  ON ai_env_vars(org_id, endpoint_id) WHERE endpoint_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_env_vars_agent
  ON ai_env_vars(org_id, agent_id) WHERE agent_id IS NOT NULL;
