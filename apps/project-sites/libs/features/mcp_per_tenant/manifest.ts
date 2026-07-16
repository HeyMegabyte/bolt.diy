export const manifest = {
  slug: 'mcp_per_tenant',
  name: 'MCP Server Per Tenant Site',
  description:
    'Every generated site becomes an MCP server at mcp.{slug}.projectsites.dev. AI agents connect via OAuth 2.1 and get 9 typed tools: read_page, list_pages, create_page, update_page, delete_page, upload_media, list_media, read_analytics, manage_seo.',
  flagKey: 'mcp_per_tenant',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
