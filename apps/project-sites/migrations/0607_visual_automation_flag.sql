INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_visual_automation', NULL, 'visual_automation', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"visual_automation feature module.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/visual_automation/spec.ts"]}');
