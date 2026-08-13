-- Migration 0625: apply the site_mcp_tokens + site_mcp_tool_usage tables to prod.
-- The DDL was authored in 0514_site_mcp_tokens.sql but that migration ALSO ended
-- with an `INSERT ... INTO feature_flags (enabled_globally, rollout_pct)` using a
-- legacy flag-table schema that does not exist in prod (runtime flags live in
-- `flag_overrides`). That trailing INSERT failed, so 0514 was never applied and the
-- two tables were MISSING in production — which made per-site MCP token minting
-- lie-success (mintSiteMcpToken returned a token that never persisted) and the
-- tokens list lie-empty. Resurrected 2026-08-13 (fire-26). Idempotent; the flag
-- INSERT is intentionally omitted (the tools already resolve; the flag is legacy).
CREATE TABLE IF NOT EXISTS site_mcp_tokens (
  id         TEXT NOT NULL PRIMARY KEY,
  site_id    TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT 'Default',
  created_by TEXT NOT NULL,
  last_used  TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, token_hash)
);
CREATE INDEX IF NOT EXISTS idx_site_mcp_tokens_site_id ON site_mcp_tokens(site_id);
CREATE INDEX IF NOT EXISTS idx_site_mcp_tokens_hash    ON site_mcp_tokens(token_hash);

CREATE TABLE IF NOT EXISTS site_mcp_tool_usage (
  id          TEXT    NOT NULL PRIMARY KEY,
  site_id     TEXT    NOT NULL,
  tool_name   TEXT    NOT NULL,
  day         TEXT    NOT NULL,
  call_count  INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, tool_name, day)
);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_usage_site ON site_mcp_tool_usage(site_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_usage_day  ON site_mcp_tool_usage(day);
