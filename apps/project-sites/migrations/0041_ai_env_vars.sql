-- AI Environment Variables — customizable per-org/per-site/per-MCP key-value store
-- that the AI and MCP-connectable surfaces can read at inference time. Values are
-- encrypted at rest via the existing AES-GCM `MCP_ENCRYPTION_KEY` (see
-- src/services/ai_crypto.ts). Scope precedence at resolve-time:
--   org → site (overrides org) → mcp (overrides org+site).

CREATE TABLE IF NOT EXISTS ai_env_vars (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('org','site','mcp')),
  site_id TEXT,                            -- present when scope='site'
  mcp_provider TEXT,                       -- present when scope='mcp' (e.g. 'mailchimp','stripe','github')
  key TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,            -- AES-GCM ciphertext base64
  description TEXT,
  is_secret INTEGER NOT NULL DEFAULT 1,    -- 0 = plain visible config, 1 = masked secret
  exposed_to_ai INTEGER NOT NULL DEFAULT 1,-- 0 = mcp-only, 1 = also surfaced to LLM tool context
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

-- D1/SQLite forbids expressions in table-level UNIQUE constraints, so we
-- enforce uniqueness per-scope via three partial unique indexes. Active
-- (non-deleted) rows are unique within their scope tuple.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_env_vars_org ON ai_env_vars(org_id, key) WHERE scope = 'org' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_env_vars_site ON ai_env_vars(org_id, site_id, key) WHERE scope = 'site' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_env_vars_mcp ON ai_env_vars(org_id, mcp_provider, key) WHERE scope = 'mcp' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_env_vars_org_scope ON ai_env_vars(org_id, scope, deleted_at);
CREATE INDEX IF NOT EXISTS idx_env_vars_site ON ai_env_vars(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_env_vars_mcp ON ai_env_vars(org_id, mcp_provider) WHERE mcp_provider IS NOT NULL;
