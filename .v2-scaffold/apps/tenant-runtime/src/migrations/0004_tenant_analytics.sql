-- 0004_tenant_analytics.sql
-- Backlog #27 — Privacy-first per-site analytics. Cookieless, GDPR-clean.
--
-- ONE D1 PER TENANT (ADR-0008) — no `tenant_id` column. The binding IS the
-- tenant boundary. IPs are SHA-256(ip + ua + daily_salt) so the row carries
-- no PII; the salt rotates daily so identifiers are not stable across days
-- (anti-fingerprinting). UA is stored as a coarse family ("Chrome 131") only.

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('pageview','outbound','download','engage','conversion')),
  path TEXT NOT NULL,
  referrer_host TEXT,
  ua_family TEXT,
  screen TEXT,
  locale TEXT,
  visitor_hash TEXT NOT NULL,
  country TEXT,
  event_day TEXT NOT NULL,      -- YYYY-MM-DD (UTC). Cheap daily aggregates.
  created_at INTEGER NOT NULL    -- ms epoch
);

CREATE INDEX IF NOT EXISTS idx_analytics_day_path
  ON analytics_events (event_day, path);
CREATE INDEX IF NOT EXISTS idx_analytics_day_ref
  ON analytics_events (event_day, referrer_host);
CREATE INDEX IF NOT EXISTS idx_analytics_visitor_day
  ON analytics_events (event_day, visitor_hash);
CREATE INDEX IF NOT EXISTS idx_analytics_created
  ON analytics_events (created_at DESC);

-- Daily-rotating salt used to fold (ip + ua) into a non-stable visitor hash.
-- Tenant runtime regenerates the row whenever event_day rolls over UTC.
CREATE TABLE IF NOT EXISTS analytics_daily_salt (
  event_day TEXT PRIMARY KEY,    -- YYYY-MM-DD UTC
  salt TEXT NOT NULL,            -- base64 32 bytes
  created_at INTEGER NOT NULL
);
