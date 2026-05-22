-- 0019_ai_chat_context.sql
-- Extends per-site AI settings with web-research permission + Google Drive
-- connection state, plus a richer ai_context_files store that supersedes the
-- minimal ai_chat_context_files from migration 0013 by adding source tracking
-- (upload vs drive), drive file ids for idempotent sync, and a soft-delete
-- column.  The legacy ai_chat_context_files table is preserved untouched —
-- the new endpoints write to ai_context_files; the old endpoints continue to
-- read/write the legacy table until they are migrated.

ALTER TABLE ai_site_settings ADD COLUMN allow_web_research INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_site_settings ADD COLUMN drive_folder_id TEXT;
ALTER TABLE ai_site_settings ADD COLUMN drive_folder_name TEXT;
ALTER TABLE ai_site_settings ADD COLUMN drive_access_token_enc TEXT;
ALTER TABLE ai_site_settings ADD COLUMN drive_refresh_token_enc TEXT;
ALTER TABLE ai_site_settings ADD COLUMN drive_last_synced_at TEXT;

CREATE TABLE IF NOT EXISTS ai_context_files (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  extracted_text TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'drive')),
  drive_file_id TEXT,
  drive_modified_time TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_context_files_site ON ai_context_files (site_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_ai_context_files_drive
  ON ai_context_files (site_id, drive_file_id) WHERE drive_file_id IS NOT NULL;

-- Per-site Google Drive OAuth states. Mirrors the github_backup_states /
-- mcp_oauth_states pattern: the original `oauth_states` table has a CHECK
-- constraint locking `provider` to ('google') and a user-auth shape, so we
-- maintain a separate per-site table that carries a site_id foreign key.
CREATE TABLE IF NOT EXISTS google_drive_oauth_states (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  state TEXT NOT NULL UNIQUE,
  redirect_url TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_drive_oauth_states_state ON google_drive_oauth_states (state);
CREATE INDEX IF NOT EXISTS idx_drive_oauth_states_site
  ON google_drive_oauth_states (site_id) WHERE deleted_at IS NULL;
