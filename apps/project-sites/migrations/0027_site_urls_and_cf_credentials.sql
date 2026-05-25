-- 0027_site_urls_and_cf_credentials.sql
--
-- Multi-URL analytics aggregation + per-org Cloudflare credential storage.
--
-- ## What this migration adds
--
-- 1. `site_urls` — every URL bound to a `site_id`. One row per (site, hostname).
--    The PRIMARY url mirrors `sites.primary_hostname`; alternates are
--    user-added (custom domains, staging clones, vanity URLs). Analytics
--    aggregation in `services/multi_url_analytics.ts` queries Cloudflare
--    GraphQL once per row and sums the result.
--
-- 2. `cf_credentials` — per-org `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`
--    blob. The worker's bundled `CF_API_TOKEN` is account-scoped (Megabyte
--    Labs) — orgs that bring their own credentials see traffic for THEIR
--    zones too (custom domains, external sites pointed at us). Stored
--    AES-GCM encrypted via the existing `MCP_ENCRYPTION_KEY` helper.
--
-- ## Backfill
--
-- Every existing row in `sites` with a non-null `primary_hostname` gets a
-- matching `site_urls` row with `is_primary = 1`. Sites without
-- `primary_hostname` fall back to `{slug}.projectsites.dev`.
--
-- ## Indexes
--
-- - `idx_site_urls_site_id` — list-URLs-per-site query path.
-- - `idx_site_urls_hostname` — host→site reverse lookup for cache invalidation.
-- - `idx_cf_credentials_org` — single-row-per-org guard (UNIQUE).

CREATE TABLE IF NOT EXISTS site_urls (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  -- Cached at insert time so the analytics aggregator doesn't have to
  -- re-resolve the zone per request. NULL until the first analytics call
  -- successfully resolves the zone for this hostname.
  zone_id TEXT,
  account_id TEXT,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  UNIQUE(hostname),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_urls_site_id ON site_urls(site_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_site_urls_hostname ON site_urls(hostname) WHERE deleted_at IS NULL;

-- Backfill: every site's primary hostname becomes a site_urls row. The
-- canonical hostname for projectsites.dev-hosted sites is `{slug}.projectsites.dev`;
-- custom domains live in the `hostnames` table and get folded in below.
-- (The `sites` table itself has no `primary_hostname` column — that's the
-- `hostnames` table's job — so we backfill from both sources.)
INSERT OR IGNORE INTO site_urls (id, site_id, hostname, is_primary, added_at)
SELECT
  lower(hex(randomblob(16))),
  id,
  slug || '.projectsites.dev',
  1,
  COALESCE(created_at, CURRENT_TIMESTAMP)
FROM sites
WHERE deleted_at IS NULL
  AND slug IS NOT NULL;

-- Fold every active row in `hostnames` (custom domains) into site_urls.
-- `is_primary = 0` because the slug subdomain remains the canonical primary.
INSERT OR IGNORE INTO site_urls (id, site_id, hostname, is_primary, added_at)
SELECT
  lower(hex(randomblob(16))),
  site_id,
  hostname,
  0,
  COALESCE(created_at, CURRENT_TIMESTAMP)
FROM hostnames
WHERE deleted_at IS NULL
  AND status = 'active';

CREATE TABLE IF NOT EXISTS cf_credentials (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  -- AES-GCM encrypted JSON: { api_key, email }. Decrypted only inside
  -- the worker via decryptCfCredentials() in services/cf_credentials.ts.
  encrypted_blob TEXT NOT NULL,
  -- IV used for the AES-GCM seal — 12 bytes base64.
  iv TEXT NOT NULL,
  -- Track last successful validation so the UI can show "Last validated
  -- 2 hours ago" vs "stale, please re-validate".
  last_validated_at TIMESTAMP,
  -- Account ID extracted from the most recent successful /accounts call.
  -- Cached for the zone-resolution path so we don't re-fetch the user's
  -- account list on every analytics query.
  last_validated_account_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  UNIQUE(org_id)
);

CREATE INDEX IF NOT EXISTS idx_cf_credentials_org ON cf_credentials(org_id) WHERE deleted_at IS NULL;
