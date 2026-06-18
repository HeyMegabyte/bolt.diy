-- claimyour.site (#1) — reverse-lookup index on claim_build_sessions.site_id.
-- The build-status callback resolves a finished build's site_id back to its
-- claim session (getSessionBySiteId) to flip building→completed + email the
-- owner. One row per claim build, so this is cheap insurance against a scan as
-- the leads table grows. Additive + idempotent — safe to re-run.
CREATE INDEX IF NOT EXISTS idx_claim_build_sessions_site
  ON claim_build_sessions (site_id);
