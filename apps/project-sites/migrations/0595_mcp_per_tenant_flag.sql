-- 0595_mcp_per_tenant_flag.sql
INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_mcp_per_tenant', NULL, 'mcp_per_tenant', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Every generated site becomes an MCP server at mcp.{slug}.projectsites.dev with 9 typed tools (read/list/create/update/delete pages, upload/list media, read analytics, manage SEO). AI agents connect via OAuth 2.1 with per-site scoped tokens. When disabled, MCP endpoints return 404. Risk: none when off (no-op).","owner_email":"brian@megabyte.space","e2e_tests":["e2e/mcp_per_tenant/manifest.spec.ts"]}');
