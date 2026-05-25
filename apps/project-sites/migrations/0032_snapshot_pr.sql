-- 0032_snapshot_pr.sql
-- Item #7: Editor → GitHub PR flow (replaces force-push).
-- Adds three columns to site_snapshots so we can link each snapshot to its
-- companion GitHub branch + PR:
--   github_branch_name   - the snapshot-{snapshot_id}-{ts} branch name
--   github_pr_number     - the GitHub PR number (INTEGER)
--   github_pr_html_url   - the canonical PR URL on github.com
--
-- All three nullable: snapshots can exist without a PR (older snapshots,
-- snapshots created before a github_integration was linked, snapshots from
-- sites that never opt in to the GitHub mirror). The frontend chip only
-- renders when github_pr_number IS NOT NULL.

ALTER TABLE site_snapshots ADD COLUMN github_branch_name TEXT;
ALTER TABLE site_snapshots ADD COLUMN github_pr_number INTEGER;
ALTER TABLE site_snapshots ADD COLUMN github_pr_html_url TEXT;

-- Index by site_id partial on rows that DO have a PR — used by the
-- snapshots listing query to JOIN PR metadata without a full table scan.
CREATE INDEX IF NOT EXISTS idx_site_snapshots_with_pr
  ON site_snapshots(site_id, created_at DESC) WHERE github_pr_number IS NOT NULL;
