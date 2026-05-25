-- 0040_media_assets.sql
-- Unified media library backing the projectsites.dev Media studio.
--
-- One row per asset (uploaded | generated | stock | imported), org-scoped.
-- Binary lives in R2 under `media/{org_id}/{asset_id}/{filename}`; this table
-- is the catalog + status machine + attribution store.
--
-- See: apps/project-sites/src/services/media.ts (service surface)
--      apps/project-sites/src/routes/media.ts   (HTTP surface)

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  created_by TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','audio','document','other')),
  source TEXT NOT NULL CHECK (source IN ('uploaded','generated','stock','imported')),
  source_provider TEXT,                  -- 'dall-e-3','sora','veo','elevenlabs','pexels','unsplash','pixabay','google-cse','foursquare','yelp','user'
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  r2_key TEXT NOT NULL,
  thumbnail_r2_key TEXT,
  prompt TEXT,                            -- for generated
  attribution TEXT,                       -- for stock
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','generating','failed','queued')),
  status_message TEXT,
  metadata_json TEXT,
  tags_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_media_org_kind ON media_assets(org_id, kind, deleted_at);
CREATE INDEX IF NOT EXISTS idx_media_org_created ON media_assets(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_status ON media_assets(status) WHERE status IN ('generating','queued');
