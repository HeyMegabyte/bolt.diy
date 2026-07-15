INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_white_label', NULL, 'white_label', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"white_label feature module.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/white_label/spec.ts"]}');
