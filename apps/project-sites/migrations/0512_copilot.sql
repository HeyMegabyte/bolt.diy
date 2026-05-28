-- Migration 0512: Multimodal AI Site Copilot sessions
--
-- Adds persistence for #25 Multimodal AI Site Copilot.
-- Feature flag: multimodal_copilot (enabled=0, rollout=0, stage='experimental').
--
-- Tables:
--   copilot_sessions — one session per visitor interaction (text+audio+image)

CREATE TABLE IF NOT EXISTS copilot_sessions (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  site_id          TEXT NOT NULL,
  site_slug        TEXT NOT NULL,
  -- Input signals (all optional — visitor may send any combination)
  has_text         INTEGER NOT NULL DEFAULT 0,
  has_audio        INTEGER NOT NULL DEFAULT 0,
  has_image        INTEGER NOT NULL DEFAULT 0,
  -- Whisper transcript (from audio, if present)
  transcript       TEXT,
  -- GPT-4o vision description (from image, if present)
  image_description TEXT,
  -- Combined intent classification
  intent           TEXT CHECK (intent IN ('book','quote','support','browse','unknown')),
  -- JSON object of extracted fields (name, email, phone, date, service, etc.)
  extracted_fields TEXT NOT NULL DEFAULT '{}',
  -- Suggested route to redirect the visitor to
  suggested_route  TEXT,
  -- Latency breakdown (ms)
  whisper_ms       INTEGER,
  vision_ms        INTEGER,
  classify_ms      INTEGER,
  total_ms         INTEGER,
  -- Visitor tracking (best-effort, privacy-safe)
  visitor_id       TEXT,
  anon_id          TEXT,
  -- Status for async processing
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','done','error')),
  error_message    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_copilot_sessions_org_site
  ON copilot_sessions(org_id, site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_copilot_sessions_site_slug
  ON copilot_sessions(site_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_copilot_sessions_intent
  ON copilot_sessions(site_id, intent)
  WHERE intent IS NOT NULL;
