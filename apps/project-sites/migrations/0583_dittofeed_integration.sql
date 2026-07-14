-- Feature flag: dittofeed_integration
-- Enables Dittofeed customer engagement event pipeline across the platform.
-- When ON: abandoned_builds, first_lead, billing events, lead scanner, and
-- integration health events fan out to Dittofeed via the Segment-compatible API.
-- Default OFF (experimental) — promote to beta after E2E smoke test passes.
--
-- To activate:
--   1. Set DITTOFEED_ADMIN_API_KEY + DITTOFEED_PUBLIC_WRITE_KEY + DITTOFEED_WORKSPACE_ID on Worker
--   2. Set DITTOFEED_BASE_URL=https://engage.projectsites.dev
--   3. Enable in /admin/feature-flags (UPDATE feature_flags SET enabled=1 WHERE flag_name='dittofeed_integration')
--   4. Trigger a test event → verify track event appears in Dittofeed dashboard
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES (
  'flag_dittofeed_integration',
  NULL,
  'dittofeed_integration',
  0,
  '{"stage":"experimental","rollout_percent":0,"description":"Dittofeed customer engagement event pipeline. Fans out platform events to Dittofeed via Segment-compatible API. Enables automated customer journeys, email sequences, and engagement automation for site owners.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/dittofeed/event-pipeline.spec.ts","e2e/dittofeed/admin-api.spec.ts"]}'
);
