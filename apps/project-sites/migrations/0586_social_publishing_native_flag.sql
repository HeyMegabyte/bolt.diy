-- 0586_social_publishing_native_flag.sql
-- Feature flag seed for Native Social Publishing (SOCIAL-101).
-- Gate: flag OFF by default (enabled=0, experimental). All /api/social/*
-- routes return 404 when disabled. Safe for deploy — no user impact.
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES (
  'flag_social_publishing_native',
  NULL,
  'social_publishing_native',
  0,
  '{"stage":"experimental","rollout_percent":0,"description":"Native social media posting across 14 platforms. Replaces Postiz. CF Workflows v2 for durable scheduling, Upstash Redis for job queue, D1 for system of record, Tinybird for analytics. When disabled, all /api/social/* routes return 404. Risk: scheduled posts silently undeliverable when off. Targets: site owners composing and scheduling social posts from the admin Social tab. Acceptance: account connect flow completes, post schedules + publishes within 60s of scheduled_at.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/social_publishing_native/account-connect.spec.ts","e2e/social_publishing_native/post-create.spec.ts","e2e/social_publishing_native/post-schedule.spec.ts"]}'
);
