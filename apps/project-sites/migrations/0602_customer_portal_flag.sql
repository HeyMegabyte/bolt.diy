INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_customer_portal', NULL, 'customer_portal', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Client portal: magic-link auth, per-client page access control, 30-day expiry, sub-page path matching. Password-protected pages per client for agencies, consultants, law firms.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/customer_portal/portal.spec.ts"]}');
