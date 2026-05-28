-- Migration 0515: Public API token system
--
-- Adds api_tokens table for the Public API v1 surface.
-- Tokens are hashed on write (SHA-256 hex) so plaintext is never stored.
-- Scopes follow the pattern: resource:action (e.g. sites:read, media:write).
--
-- Feature flag: public_api_v1 (enabled=false, experimental by default)

CREATE TABLE IF NOT EXISTS api_tokens (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES orgs(id),
  name            TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  -- JSON array of scope strings, e.g. '["sites:read","media:read"]'
  scopes          TEXT NOT NULL DEFAULT '["sites:read"]',
  last_used_at    TEXT,
  expires_at      TEXT,
  revoked_at      TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_org_id
  ON api_tokens(org_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash
  ON api_tokens(token_hash)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_tokens_expires_at
  ON api_tokens(expires_at)
  WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

-- Track v1 API usage for rate-limiting and analytics
CREATE TABLE IF NOT EXISTS api_token_usage (
  id           TEXT PRIMARY KEY,
  token_id     TEXT NOT NULL REFERENCES api_tokens(id),
  endpoint     TEXT NOT NULL,
  method       TEXT NOT NULL,
  status_code  INTEGER,
  duration_ms  INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_token_usage_token_id
  ON api_token_usage(token_id, created_at);
