-- 0596_nl_site_management_flag.sql
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_nl_site_management', NULL, 'nl_site_management', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Natural language site editing — type commands like \"change my hero headline to Best Pizza\" and get structured edit intents parsed. Resolves 40+ section aliases (hero, about, services, testimonials, contact, footer, faq, pricing, hours, phone, address, email, banner, holiday_hours). When disabled, command endpoint returns 404. Risk: none (read-only intent parsing, no mutations).","owner_email":"brian@megabyte.space","e2e_tests":["e2e/nl_site_management/parse.spec.ts"]}');
