INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_seo_agent', NULL, 'seo_agent', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Autonomous SEO monitoring: indexing checks, on-page SEO, keyword rank tracking (wins/losses), competitor keyword gap detection. Generates A-F grade with auto-fix suggestions.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/seo_agent/health.spec.ts"]}');
