-- Public Gallery (idea #34) — opt-in flag on sites so published sites can be
-- listed in the public, indexable gallery (social proof + pSEO + marketplace funnel).
-- Additive + idempotent: D1 has no `ADD COLUMN IF NOT EXISTS`, so re-running this
-- migration after the column exists will error — run once per environment.

ALTER TABLE sites ADD COLUMN gallery_opt_in INTEGER NOT NULL DEFAULT 0;

-- Partial index: only published, opted-in, non-deleted sites are gallery-eligible.
CREATE INDEX IF NOT EXISTS idx_sites_gallery_opt_in
  ON sites (gallery_opt_in, status)
  WHERE gallery_opt_in = 1 AND deleted_at IS NULL;
