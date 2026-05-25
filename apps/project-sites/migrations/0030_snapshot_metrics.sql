-- 0030_snapshot_metrics.sql
--
-- Snapshot quality matrix — captures Lighthouse + Core Web Vitals + page
-- composition + a11y + SEO at the time a snapshot is frozen. One row per
-- snapshot. Powers the snapshots grid in the admin UI so each frozen build
-- carries an at-a-glance health card.
--
-- Capture pipeline (`SnapshotQualityWorkflow`, `routes/snapshot_quality.ts`):
--   1. Trigger off `POST /api/sites/:siteId/snapshots/:snapshotId/capture`
--      or auto-fire when a snapshot row is inserted (api.ts waitUntil).
--   2. Cloudflare Browser Rendering REST API: full-page 1920x1080 screenshot
--      → R2 `snapshots/{snapshot_id}/screenshot-1920x1080.png`.
--   3. Page composition + JSON-LD + SEO via HTMLRewriter pass on fetched HTML.
--   4. Performance + a11y via Browser Rendering performance/a11y endpoints
--      (graceful fallback when lighthouse-native unavailable).
--   5. Insert (or UPSERT) row with whatever subset of metrics resolved.
--
-- All numeric columns are NULLable — partial captures are still useful and
-- the UI grid degrades gracefully. `error` is non-null only when ALL steps
-- failed catastrophically.

CREATE TABLE IF NOT EXISTS snapshot_metrics (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  -- Lighthouse 0-100 scores
  lh_performance INTEGER,
  lh_accessibility INTEGER,
  lh_best_practices INTEGER,
  lh_seo INTEGER,
  lh_pwa INTEGER,
  -- Core Web Vitals (ms or unitless ratio)
  lcp_ms INTEGER,
  fcp_ms INTEGER,
  tbt_ms INTEGER,
  cls REAL,
  inp_ms INTEGER,
  si_ms INTEGER,
  -- Page composition
  page_size_bytes INTEGER,
  asset_count INTEGER,
  request_count INTEGER,
  dom_node_count INTEGER,
  -- SEO + structured data
  jsonld_block_count INTEGER,
  title_chars INTEGER,
  meta_desc_chars INTEGER,
  h1_count INTEGER,
  internal_links INTEGER,
  outbound_links INTEGER,
  -- A11y
  axe_violations INTEGER,
  axe_critical INTEGER,
  axe_serious INTEGER,
  contrast_failures INTEGER,
  target_size_failures INTEGER,
  -- Screenshot R2 key (relative to SITES_BUCKET)
  screenshot_r2_key TEXT,
  -- Run metadata
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  captured_via TEXT NOT NULL DEFAULT 'workflow', -- workflow|manual|cron
  duration_ms INTEGER,
  error TEXT,
  UNIQUE(snapshot_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_metrics_snapshot
  ON snapshot_metrics(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_metrics_site_captured
  ON snapshot_metrics(site_id, captured_at DESC);
