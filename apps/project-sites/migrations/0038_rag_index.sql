-- Migration 0038: RAG chunks mirror for Cloudflare Vectorize
--
-- Authoritative D1 source for every chunk we have embedded into the
-- `projectsites-rag` Vectorize index. Lets us re-index after schema or
-- model changes without losing the original text + metadata.

CREATE TABLE IF NOT EXISTS rag_chunks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  org_id TEXT,
  text TEXT NOT NULL,
  metadata_json TEXT,
  embedded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_kind_source ON rag_chunks(kind, source_id);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_org ON rag_chunks(org_id);
