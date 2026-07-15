-- 0594_conversational_analytics_flag.sql
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_conversational_analytics', NULL, 'conversational_analytics', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Natural language analytics query intent parser. Maps questions like \"how many visitors last week?\" to structured metric queries. Regex-based pattern matching handles 80% of queries; LLM fallback for ambiguous ones. When disabled, query endpoint returns 404. Risk: none (read-only intent parsing).","owner_email":"brian@megabyte.space","e2e_tests":["e2e/conversational_analytics/parse.spec.ts"]}');
