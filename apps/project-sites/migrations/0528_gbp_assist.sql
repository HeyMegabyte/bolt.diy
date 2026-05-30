-- 0528 — Google Business Profile (GBP) Assist (idea #9).
--
-- One row per site tracking GBP status detection, the AI-generated content
-- pack, and the guided setup-checklist done-state. Additive + idempotent:
-- existing rows are untouched; the table is created only if missing.
--
-- MVP scope: GBP API *write* needs Google approval, so this stores a guided
-- claim/create deep-link + an SEO-optimized content pack the owner pastes
-- into the GBP console — never a silent auto-create.
--
--   - place_id       — detected Places ID when a profile already exists.
--   - status         — 'has_profile' | 'no_profile' | 'unknown'.
--   - content_pack   — JSON GbpContentPack (categories, 750-char description,
--                      services, attributes, first post).
--   - checklist_state — JSON map of checklist step id -> done boolean.

CREATE TABLE IF NOT EXISTS gbp_profiles (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  place_id TEXT,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('has_profile', 'no_profile', 'unknown')),
  content_pack TEXT,
  checklist_state TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gbp_profiles_site ON gbp_profiles (site_id) WHERE deleted_at IS NULL;
