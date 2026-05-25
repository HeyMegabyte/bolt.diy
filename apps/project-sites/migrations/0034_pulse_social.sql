-- 0034_pulse_social.sql
-- Pulse Social — Postiz-equivalent social media scheduler. All Cloudflare
-- serverless: Workers + D1 + R2 + KV + Workflows + Cron.
--
-- Tables:
--   social_accounts             - per-org OAuth-connected platform accounts (tokens AES-GCM encrypted)
--   social_posts                - drafts/scheduled posts (one row per logical post)
--   social_publishes            - per-(post,account) publish attempts (1:N)
--   social_analytics_snapshots  - hourly metric snapshots per publish

CREATE TABLE IF NOT EXISTS social_accounts (
  id                        TEXT PRIMARY KEY,
  org_id                    TEXT NOT NULL,
  created_by                TEXT NOT NULL,
  platform                  TEXT NOT NULL,             -- twitter|linkedin|facebook|instagram|threads|bluesky|reddit|mastodon|discord|slack|telegram
  external_id               TEXT,                      -- platform account id
  handle                    TEXT,                      -- @brian, etc
  display_name              TEXT,
  avatar_url                TEXT,
  access_token_encrypted    TEXT,                      -- AES-GCM via ai_crypto
  access_token_iv           TEXT,                      -- inline (iv prefix in blob); column kept for future split-key migration
  refresh_token_encrypted   TEXT,
  refresh_token_iv          TEXT,
  token_expires_at          TEXT,
  scopes                    TEXT,
  status                    TEXT NOT NULL DEFAULT 'active',  -- active|expired|revoked|error
  last_error                TEXT,
  metadata_json             TEXT,                      -- extra per-platform fields (page_id for FB, server URL for Mastodon, etc)
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at                TEXT,
  UNIQUE(org_id, platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_social_accounts_org
  ON social_accounts(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_accounts_status
  ON social_accounts(status, token_expires_at) WHERE deleted_at IS NULL;

-- NOTE: A legacy `social_posts` table already exists in production with a
-- different schema (caption/image_r2_key columns from an earlier per-site
-- Instagram-only feature). We namespace ours as `pulse_posts` to avoid
-- collision. All Pulse Social FKs reference pulse_posts.
CREATE TABLE IF NOT EXISTS pulse_posts (
  id                        TEXT PRIMARY KEY,
  org_id                    TEXT NOT NULL,
  site_id                   TEXT,                      -- optional FK to sites
  created_by                TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'draft',  -- draft|scheduled|publishing|published|partial|failed
  scheduled_at              TEXT,                      -- UTC ISO
  published_at              TEXT,
  content                   TEXT NOT NULL,
  per_platform_overrides    TEXT,                      -- JSON {twitter: {content, ...}, linkedin: {...}}
  media_keys                TEXT,                      -- JSON [{r2_key, mime, width, height, alt, type:image|video}]
  account_ids               TEXT,                      -- JSON [social_account_id] - target accounts
  hashtags                  TEXT,                      -- JSON [string]
  mentions                  TEXT,                      -- JSON [{platform, handle}]
  link                      TEXT,
  thread_id                 TEXT,                      -- group thread/tweetstorm posts
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at                TEXT
);
CREATE INDEX IF NOT EXISTS idx_pulse_posts_org_scheduled
  ON pulse_posts(org_id, scheduled_at, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pulse_posts_due
  ON pulse_posts(scheduled_at, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pulse_posts_org_status
  ON pulse_posts(org_id, status, updated_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS social_publishes (
  id                        TEXT PRIMARY KEY,
  post_id                   TEXT NOT NULL,
  account_id                TEXT NOT NULL,
  platform                  TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'queued',  -- queued|publishing|succeeded|failed|skipped
  external_post_id          TEXT,
  external_url              TEXT,
  attempts                  INTEGER NOT NULL DEFAULT 0,
  last_attempt_at           TEXT,
  last_error                TEXT,
  succeeded_at              TEXT,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(post_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_social_publishes_post   ON social_publishes(post_id);
CREATE INDEX IF NOT EXISTS idx_social_publishes_account ON social_publishes(account_id);
CREATE INDEX IF NOT EXISTS idx_social_publishes_succeeded
  ON social_publishes(succeeded_at) WHERE status = 'succeeded';

CREATE TABLE IF NOT EXISTS social_analytics_snapshots (
  id                        TEXT PRIMARY KEY,
  publish_id                TEXT NOT NULL,
  captured_at               TEXT NOT NULL DEFAULT (datetime('now')),
  impressions               INTEGER,
  reach                     INTEGER,
  likes                     INTEGER,
  comments                  INTEGER,
  shares                    INTEGER,
  clicks                    INTEGER,
  saves                     INTEGER,
  raw_json                  TEXT
);
CREATE INDEX IF NOT EXISTS idx_social_analytics_publish_captured
  ON social_analytics_snapshots(publish_id, captured_at DESC);
