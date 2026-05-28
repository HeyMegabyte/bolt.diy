-- Migration 0514: Site MCP Tokens (#29 Per-Site MCP Server — auth tokens)
-- Per-site Bearer tokens for external agents (Claude, GPT, Cursor) to call
-- the site's MCP CRUD tools.

CREATE TABLE IF NOT EXISTS site_mcp_tokens (
  id         TEXT NOT NULL PRIMARY KEY,
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,  -- SHA-256 hex of the raw token (never store raw)
  label      TEXT NOT NULL DEFAULT 'Default',
  created_by TEXT NOT NULL,  -- user_id
  last_used  TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (site_id, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_site_mcp_tokens_site_id ON site_mcp_tokens(site_id);
CREATE INDEX IF NOT EXISTS idx_site_mcp_tokens_hash    ON site_mcp_tokens(token_hash);

-- Per-tool usage counters for the admin chart
CREATE TABLE IF NOT EXISTS site_mcp_tool_usage (
  id         TEXT    NOT NULL PRIMARY KEY,
  site_id    TEXT    NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  tool_name  TEXT    NOT NULL,
  day        TEXT    NOT NULL, -- ISO date YYYY-MM-DD
  call_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),

  UNIQUE (site_id, tool_name, day)
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_usage_site  ON site_mcp_tool_usage(site_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_usage_day   ON site_mcp_tool_usage(day);

-- Feature flag: per-site MCP CRUD tools (#29)
-- Note: parent flag `site_mcp_server` (already exists) enables the server itself.
-- This flag enables the additional CRUD tools + token management.
INSERT OR IGNORE INTO feature_flags (key, description, enabled_globally, rollout_pct)
VALUES (
  'site_mcp_tools',
  'Per-site MCP CRUD tools (#29) — list_pages, read_page, update_page_section, create_page, list_form_submissions, list_blog_posts, create_blog_post, get_analytics_summary, list_media_assets. Auth via per-site MCP token.',
  0,
  0
);
