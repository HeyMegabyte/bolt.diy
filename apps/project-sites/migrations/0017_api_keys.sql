-- Org-level API keys. Store only a SHA-256 hash + an 8-char prefix so we
-- can display "psk_live_AbCdEfGh…" without ever holding the secret again.
-- The full secret is returned exactly once at creation time.
CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  hash          TEXT NOT NULL UNIQUE,
  scopes_json   TEXT,
  last_used_at  TEXT,
  expires_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id, revoked_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(hash);
