-- Anthropic Memory + Files primitives.
-- Backs the Memory tool (server-side key/value scoped store) and tracks
-- files uploaded to the Anthropic Files API so they can be referenced from
-- multiple chat turns without re-uploading. Skills are bundled at build
-- time and live in apps/project-sites/skills/ — no D1 table needed.

-- ─── Memory ────────────────────────────────────────────────────
-- Scoped key/value store consumed by the Memory tool. `scope_kind` partitions
-- the store by lifetime/tenant (org-wide settings, per-site facts, per-call
-- voice agent scratchpad, per-user assistant preferences). SQLite forbids
-- COALESCE inside UNIQUE expressions, so we use a straight composite unique
-- index — callers MUST upsert via `INSERT … ON CONFLICT (scope_kind, scope_id, key)`.
CREATE TABLE IF NOT EXISTS anthropic_memory (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('org','site','voice_agent','user')),
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_anthropic_memory_scope ON anthropic_memory(scope_kind, scope_id, key);
CREATE INDEX IF NOT EXISTS idx_anthropic_memory_scope ON anthropic_memory(scope_kind, scope_id);
CREATE INDEX IF NOT EXISTS idx_anthropic_memory_expires ON anthropic_memory(expires_at) WHERE expires_at IS NOT NULL;

-- ─── Files ─────────────────────────────────────────────────────
-- Mirror of Anthropic Files API (`/v1/files`, beta header
-- `anthropic-beta: files-api-2025-04-14`). `anthropic_file_id` is the
-- vendor-issued `file_*` id; `org_id` scopes ownership for RBAC + delete.
-- `expires_at` mirrors the vendor TTL so callers can re-upload before
-- stale-reference errors hit chat turns.
CREATE TABLE IF NOT EXISTS anthropic_files (
  id TEXT PRIMARY KEY,
  anthropic_file_id TEXT NOT NULL UNIQUE,
  org_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  purpose TEXT,
  uploaded_at INTEGER NOT NULL,
  expires_at INTEGER,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_anthropic_files_org ON anthropic_files(org_id);
