INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_voice_site_mgmt', NULL, 'voice_site_mgmt', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Voice command parser for site editing: maps spoken commands to edit intents with filler-word filtering, confidence scoring, and verbal confirmation generation. Extends NL Site Management for voice input.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/voice_site_mgmt/parse.spec.ts"]}');
