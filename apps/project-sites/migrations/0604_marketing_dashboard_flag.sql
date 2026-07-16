INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_marketing_dashboard', NULL, 'marketing_dashboard', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Unified marketing dashboard: 11 default metric widgets across 6 sources, change computation with trend detection, source filtering, grid/list layouts.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/marketing_dashboard/dashboard.spec.ts"]}');
