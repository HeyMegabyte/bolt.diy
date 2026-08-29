-- 0613_sites_functions_deployed_at.sql
-- Stage 3.1 dispatch signal (ADR-0035 §30). Records whether a site has a live
-- `functions/` worker on Workers-for-Platforms: an ISO timestamp when a bundle
-- is deployed, NULL when removed / never deployed.
--   Writer: deploySiteFunctions → recordFunctionsDeploy (functions_deploy.ts)
--   Reader: siteHasDeployedFunctions → the site_serving /api/* dispatch guard
-- so dispatch decides routing WITHOUT probing WfP on the hot path.
-- Additive + nullable → safe two-way door (no data loss, reversible by ignoring).
ALTER TABLE sites ADD COLUMN functions_deployed_at TEXT;
