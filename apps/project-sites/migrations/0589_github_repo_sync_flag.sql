-- 0589_github_repo_sync_flag.sql
-- Feature flag seed for GitHub Repository Sync (2026-07-15).
-- Every site gets a private GitHub repo at github.com/projectsites-dev/{siteId}.
-- On build complete: commit + push all generated files. On rollback: git revert + redeploy.
-- Gate: flag OFF by default (enabled=0, experimental). No repos created when off.
-- Requires GITHUB_REPO_TOKEN set in wrangler secrets.
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES (
  'flag_github_repo_sync',
  NULL,
  'github_repo_sync',
  0,
  '{"stage":"experimental","rollout_percent":0,"description":"Every projectsites.dev site gets a private GitHub repo at github.com/projectsites-dev/{siteId} as canonical source-of-truth. On build complete: commit + push all generated files. On rollback request: git revert + trigger redeploy. Requires GITHUB_REPO_TOKEN set in wrangler secrets. When disabled, no repos are created or synced. Risk: none when off (no-op). Targets: site owners who want git-based version control, rollback capability, and code portability. Acceptance: repo created on site creation, commit pushed on build complete, rollback reverts to target commit and triggers redeploy.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/github_repo/sync-rollback.spec.ts"]}'
);
