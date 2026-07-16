-- 0588_code_export_flag.sql
-- Feature flag seed for Code Export to Self-Hosted CF (#7, ROI 5.00).
-- Gate: flag OFF by default (enabled=0, experimental). Export route returns
-- 404 when disabled. Safe for deploy — no user impact.
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES (
  'flag_code_export',
  NULL,
  'code_export',
  0,
  '{"stage":"experimental","rollout_percent":0,"description":"One-click export of any generated site as a deployable Cloudflare Worker project (wrangler.toml, Hono Worker source, D1 migrations, R2 assets, README). The ultimate lock-in killer — when customers know they can leave, they are more likely to stay. When disabled, GET /api/sites/:siteId/export returns 404. Risk: none (read-only download). Targets: site owners who want code portability or self-hosting. Acceptance: downloaded zip contains ≥6 files, wrangler.toml has typed bindings, README has deploy instructions, npm install + wrangler deploy works.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/code_export/export-download.spec.ts"]}'
);
