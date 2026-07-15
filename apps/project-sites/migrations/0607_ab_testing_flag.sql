INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_ab_testing', NULL, 'ab_testing', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"ab_testing feature module.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/ab_testing/spec.ts"]}');
