-- Migration 0517: Verified review synthesis
--
-- Supports feature #24: Verified Review Synthesis.
-- Fetches a site's Google reviews, verifies origin (google_places only,
-- real author + 1-5 rating), AI-summarizes the verified corpus into a
-- 40-60 word trust paragraph, selects top-3 featured quotes, and computes
-- an aggregate rating. Persisted here. JSON-LD AggregateRating is emitted
-- ONLY from verified data (honesty gate — never fabricated snippets).

CREATE TABLE IF NOT EXISTS review_syntheses (
  id            TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL,
  org_id        TEXT,
  summary       TEXT,                       -- AI 40-60 word trust paragraph ('' when no verified reviews)
  featured_json TEXT,                       -- JSON array of up to 3 verified VerifiedReview objects
  rating_value  REAL,                       -- aggregate ratingValue (0 when none verified)
  review_count  INTEGER,                    -- aggregate reviewCount (0 when none verified)
  source        TEXT DEFAULT 'google_places',
  verified      INTEGER DEFAULT 1,          -- 1 = only verified reviews persisted
  ai_model      TEXT,                       -- model used for the summary (NULL when no verified reviews)
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT,
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_syntheses_site
  ON review_syntheses(site_id)
  WHERE deleted_at IS NULL;

-- Feature flag seed (enabled=0, rollout=0, stage='experimental')
INSERT OR IGNORE INTO feature_flags (key, description, enabled_globally, rollout_pct)
VALUES (
  'review_synthesis',
  'Synthesizes a site''s verified Google reviews into a trust paragraph + AggregateRating JSON-LD. Verified origin only; never fabricates reviews.',
  0,
  0
);
