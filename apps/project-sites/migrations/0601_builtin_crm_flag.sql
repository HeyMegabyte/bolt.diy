INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_builtin_crm', NULL, 'builtin_crm', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Built-in CRM: lead scoring engine (0-100, hot/warm/cold), pipeline stage manager (new→contacted→qualified→proposal→negotiation→won/lost), deal value tracker, next-action recommender. Replaces separate CRM subscription for SMBs.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/builtin_crm/crm.spec.ts"]}');
