-- 0003_wave1b_ai.sql
-- Wave 1B AI features (BACKLOG_50 #8, #10, #13, #14, #18).
-- Tracks AI-generated alt text, page podcasts, competitor-gap analyses, and
-- chat-message translations.

-- #8 alt-text suggestions stored alongside the uploaded image.
CREATE TABLE IF NOT EXISTS image_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  uploader_user_id TEXT,
  url TEXT NOT NULL,
  alt_text TEXT,
  alt_text_model TEXT,
  alt_text_generated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_image_assets_tenant
  ON image_assets (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_assets_url
  ON image_assets (tenant_id, url);

-- #10 Podcast records — one per (slug, content-hash) so re-runs over the same
-- markdown body are de-duped via aiCall cache + this row's `content_hash`.
CREATE TABLE IF NOT EXISTS page_podcasts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT,
  slug TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  audio_r2_key TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  script TEXT NOT NULL,
  voice TEXT NOT NULL DEFAULT 'alloy',
  tts_model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_page_podcasts_tenant_slug
  ON page_podcasts (tenant_id, slug, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_podcasts_hash
  ON page_podcasts (tenant_id, slug, content_hash);

-- #13 Competitor-gap analyses. `result_json` holds the LLM-emitted gap list.
CREATE TABLE IF NOT EXISTS competitor_gaps (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  tenant_id TEXT,
  competitor_urls TEXT NOT NULL,
  result_json TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_competitor_gaps_org
  ON competitor_gaps (org_id, created_at DESC);

-- #18 Chat translation cache — keyed by (job, source-text-hash, target-lang)
-- so flicking the toggle off/on doesn't re-bill Workers AI.
CREATE TABLE IF NOT EXISTS chat_translations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  job_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_translations_lookup
  ON chat_translations (job_id, source_hash, target_lang);
