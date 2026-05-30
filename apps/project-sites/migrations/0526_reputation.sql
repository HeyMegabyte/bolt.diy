-- Migration 0526: Reputation suite
--
-- Supports the reputation feature module (ideas #10, #11, #13):
--   #10 review-request engine   — review_requests          (logged asks)
--   #13 reputation monitor      — reputation_platforms     (per-platform rating snapshot)
--                                 reputation_reviews_cache (normalized cached reviews)
-- #11 (reply drafts) is stateless — drafts are returned to the caller, not persisted here.
-- Additive only; every table is org/site-scoped with the standard
-- id / created_at / updated_at / deleted_at lifecycle columns.

-- #10 — sent review-request log
CREATE TABLE IF NOT EXISTS review_requests (
  id          TEXT PRIMARY KEY,
  org_id      TEXT,
  site_id     TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient   TEXT NOT NULL,                       -- email address or E.164 phone
  message     TEXT NOT NULL,                       -- the personalized ask delivered
  link        TEXT NOT NULL,                       -- Google review deep-link
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT,
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_requests_site
  ON review_requests(site_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_review_requests_org
  ON review_requests(org_id) WHERE deleted_at IS NULL;

-- #13 — per-platform rating snapshot (populated by an external sync)
CREATE TABLE IF NOT EXISTS reputation_platforms (
  id            TEXT PRIMARY KEY,
  org_id        TEXT,
  site_id       TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('google', 'yelp', 'facebook', 'tripadvisor')),
  profile_url   TEXT,
  rating        REAL,                              -- last-synced average, 0-5
  review_count  INTEGER,                           -- last-synced total review count
  synced_at     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT,
  deleted_at    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reputation_platforms_site_platform
  ON reputation_platforms(site_id, platform) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reputation_platforms_org
  ON reputation_platforms(org_id) WHERE deleted_at IS NULL;

-- #13 — normalized cached reviews (non-Google platforms read from here)
CREATE TABLE IF NOT EXISTS reputation_reviews_cache (
  id           TEXT PRIMARY KEY,
  org_id       TEXT,
  site_id      TEXT NOT NULL,
  platform     TEXT NOT NULL CHECK (platform IN ('google', 'yelp', 'facebook', 'tripadvisor')),
  text         TEXT NOT NULL,
  author       TEXT NOT NULL,
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_time  TEXT NOT NULL,                      -- human-relative or ISO time string
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT,
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_reputation_reviews_cache_site
  ON reputation_reviews_cache(site_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reputation_reviews_cache_org
  ON reputation_reviews_cache(org_id) WHERE deleted_at IS NULL;
