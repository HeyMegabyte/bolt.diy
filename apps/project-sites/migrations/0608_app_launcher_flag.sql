INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_app_launcher', NULL, 'app_launcher', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"App launch controller: provisions per-tenant infra (Neon/Upstash/R2), registers CNAME→instance KV mapping, injects encrypted credentials into app_runtime DO, returns instance metadata + cost estimate.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/app_launcher/launch.spec.ts"]}');
