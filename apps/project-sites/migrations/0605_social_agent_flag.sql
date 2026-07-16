INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_social_agent', NULL, 'social_agent', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"AI social media agent: content proposals with platform-aware captions/hashtags/image prompts for 10 platforms, optimal posting times, engagement scoring with trend detection.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/social_agent/proposals.spec.ts"]}');
