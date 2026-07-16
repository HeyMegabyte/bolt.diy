INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_local_seo_suite', NULL, 'local_seo_suite', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Local SEO auditor: NAP consistency checker across directories, rating-aware review reply suggester, directory coverage tracker. Detects name/address/phone discrepancies, generates tone-appropriate review responses (grateful/apologetic/neutral).","owner_email":"brian@megabyte.space","e2e_tests":["e2e/local_seo_suite/audit.spec.ts"]}');
