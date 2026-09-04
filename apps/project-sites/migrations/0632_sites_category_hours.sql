-- 0632_sites_category_hours.sql
-- Persist the declared business CATEGORY + HOURS on the sites row so a `/reset`
-- rebuild can re-thread them into SITE_WORKFLOW. Before this, the reset handler read
-- category ONLY from the request body (empty on admin-UI + the loop's reset-retry) →
-- the identity-woven About fell back to "local service" and NAP hours were dropped on
-- EVERY reset (loop FIRE-75/77 root-caused it: no column to recover from).
-- business_phone / business_email already exist (0001_initial_schema); these two close
-- the gap. Additive + nullable → safe, reversible, zero backfill.
--
-- Applied to prod (project-sites-db-production) via `wrangler d1 execute --remote`
-- on 2026-09-03 (repo pattern: schema changes applied directly, not via the batch
-- migrations runner — avoids re-running 160 historical files). This file is the record.
ALTER TABLE sites ADD COLUMN business_category TEXT;
ALTER TABLE sites ADD COLUMN business_hours TEXT;
