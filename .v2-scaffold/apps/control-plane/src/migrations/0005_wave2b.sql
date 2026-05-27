-- 0005_wave2b.sql
-- Wave 2B features (BACKLOG_50 #31, #32, #37, #45, #47, #48).
-- Whisper-generated VTT caption cache + multi-stop bundle discount ledger.

-- #31 Whisper caption cache. Keyed by SHA-256 of the source audio/video URL
-- so the same R2 object is transcribed exactly once. WebVTT body stored in
-- R2 under `captions/{video_hash}.vtt`; this row holds the metadata.
CREATE TABLE IF NOT EXISTS video_captions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  video_hash TEXT NOT NULL,
  source_url TEXT NOT NULL,
  vtt_r2_key TEXT NOT NULL,
  vtt_url TEXT NOT NULL,
  language TEXT,
  segments_json TEXT NOT NULL,
  model TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_video_captions_hash
  ON video_captions (video_hash);
CREATE INDEX IF NOT EXISTS idx_video_captions_tenant
  ON video_captions (tenant_id, created_at DESC);

-- #32 Multi-stop bundle discount ledger. One row per quote that triggered the
-- 12% bundle discount — auditable so finance can reconcile fees.
CREATE TABLE IF NOT EXISTS bundle_discounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  crew_id TEXT,
  bundle_date TEXT NOT NULL,
  booking_ids TEXT NOT NULL,
  booking_count INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL DEFAULT 12,
  base_application_fee_cents INTEGER NOT NULL,
  discounted_application_fee_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_bundle_discounts_customer
  ON bundle_discounts (tenant_id, customer_id, bundle_date DESC);
