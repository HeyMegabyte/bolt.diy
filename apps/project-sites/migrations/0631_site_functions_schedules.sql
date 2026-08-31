-- Stage 6.1 (ADR-0035) — per-site cron schedules for `functions/_scheduled.*`.
-- WfP dispatch-namespace scripts do NOT support native cron, so the platform
-- worker's own cron (`index.ts scheduled()`, wrangler `* * * * *`) reads this
-- table each minute, cron-matches, and dispatches `/api/_ps/scheduled` to each due
-- site's WfP script. `deploySiteFunctions` replaces a site's rows on every live
-- deploy (from the crons declared in `_scheduled.*`) and clears them on removal.
-- Additive; no existing data touched.
CREATE TABLE IF NOT EXISTS site_functions_schedules (
  id         TEXT PRIMARY KEY NOT NULL,
  site_id    TEXT NOT NULL,
  cron       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_site_functions_schedules_site
  ON site_functions_schedules (site_id);
