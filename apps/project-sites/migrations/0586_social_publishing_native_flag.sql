-- 0586_social_publishing_native_flag.sql
-- Feature flag seed for Native Social Publishing (SOCIAL-101).
-- PROMOTED 2026-07-15: stage=beta, enabled=1, rollout_percent=25.
-- All 10 Tier-0 items (SOCIAL-100 through SOCIAL-109) shipped: D1 schema v2,
-- 18 platform adapters, Upstash Redis queues, CF Workflows v2, admin UI.
-- Safe for 25% rollout — routes return 200 for 25% of sessions, 404 for 75%.
-- Full 100% after 1 week without P1 per [[feature-flags]] promotion discipline.
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES (
  'flag_social_publishing_native',
  NULL,
  'social_publishing_native',
  1,
  '{"stage":"beta","rollout_percent":25,"description":"Native social media posting across 14 platforms. Replaces Postiz. CF Workflows v2 for durable scheduling, Upstash Redis for job queue, D1 for system of record, Tinybird for analytics. When disabled, all /api/social/* routes return 404. Risk: scheduled posts silently undeliverable when off. Targets: site owners composing and scheduling social posts from the admin Social tab. Acceptance: account connect flow completes, post schedules + publishes within 60s of scheduled_at. PROMOTED to beta 2026-07-15 — SOCIAL-100 through SOCIAL-109 all shipped.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/social_publishing_native/account-connect.spec.ts","e2e/social_publishing_native/post-create.spec.ts","e2e/social_publishing_native/post-schedule.spec.ts"]}'
);
