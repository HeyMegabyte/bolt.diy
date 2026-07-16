/**
 * @module libs/features/mcp_per_tenant/service
 *
 * Per-site MCP tool definition generator — makes every ProjectSites.dev site
 * an MCP server at mcp.{slug}.projectsites.dev. Pure schema generation,
 * zero I/O, deterministic.
 *
 * Generated tools per site:
 * - read_page     — fetch any page by path
 * - list_pages    — enumerate all site pages
 * - create_page   — create a new page (draft)
 * - update_page   — update page content
 * - delete_page   — soft-delete a page
 * - upload_media  — upload an image/file
 * - list_media    — list media assets
 * - read_analytics — get site analytics summary
 * - manage_seo    — read/write SEO metadata
 *
 * Each tool has a Zod input schema, output schema, description, and
 * per-tool rate limit classification. AI agents connect via OAuth 2.1
 * and get exactly these tools scoped per site.
 */
import type { z } from 'zod';

// ── Types ───────────────────────────────────────────────────────────────────

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  rateLimitClass: 'read' | 'write' | 'destructive';
}

export interface SiteMcpManifest {
  siteId: string;
  siteSlug: string;
  serverUrl: string;
  generatedAt: string;
  tools: McpToolDefinition[];
  toolCount: number;
  authMethod: 'oauth2_1' | 'bearer_token';
  oauthScopes: string[];
}

// ── Tool generators ─────────────────────────────────────────────────────────

function readPageTool(): McpToolDefinition {
  return {
    name: 'read_page',
    description: 'Fetch the full content of any page on the site by its path (e.g. /about, /services). Returns page title, HTML content, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Page path, e.g. /about or /services/pricing' },
        format: { type: 'string', enum: ['html', 'markdown', 'text'], description: 'Output format (default: html)' },
      },
      required: ['path'],
    },
    rateLimitClass: 'read',
  };
}

function listPagesTool(): McpToolDefinition {
  return {
    name: 'list_pages',
    description: 'List all pages on the site with their paths, titles, and last-modified dates. Supports pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max pages to return (default: 50)' },
        offset: { type: 'integer', minimum: 0, description: 'Pagination offset (default: 0)' },
        filter: { type: 'string', description: 'Optional substring filter on page titles' },
      },
    },
    rateLimitClass: 'read',
  };
}

function createPageTool(): McpToolDefinition {
  return {
    name: 'create_page',
    description: 'Create a new page on the site. The page starts as a draft and must be published separately. Returns the new page ID and URL.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'URL path for the new page, e.g. /new-service' },
        title: { type: 'string', description: 'Page title (displayed in browser tab and H1)' },
        content: { type: 'string', description: 'Page content as HTML' },
        metaDescription: { type: 'string', description: 'SEO meta description (120-156 chars)' },
      },
      required: ['path', 'title', 'content'],
    },
    rateLimitClass: 'write',
  };
}

function updatePageTool(): McpToolDefinition {
  return {
    name: 'update_page',
    description: 'Update an existing page\'s content, title, or metadata. Only changed fields need to be provided.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Page path to update, e.g. /about' },
        title: { type: 'string', description: 'New page title (optional)' },
        content: { type: 'string', description: 'New page content as HTML (optional)' },
        metaDescription: { type: 'string', description: 'New SEO meta description (optional)' },
      },
      required: ['path'],
    },
    rateLimitClass: 'write',
  };
}

function deletePageTool(): McpToolDefinition {
  return {
    name: 'delete_page',
    description: 'Soft-delete a page. The page is archived and can be restored within 30 days.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Page path to delete, e.g. /old-page' },
        confirm: { type: 'boolean', description: 'Must be true to confirm deletion' },
      },
      required: ['path', 'confirm'],
    },
    rateLimitClass: 'destructive',
  };
}

function uploadMediaTool(): McpToolDefinition {
  return {
    name: 'upload_media',
    description: 'Upload an image or file to the site\'s media library. Returns the public URL and media ID.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Filename with extension, e.g. hero.jpg' },
        content: { type: 'string', description: 'Base64-encoded file content' },
        contentType: { type: 'string', description: 'MIME type, e.g. image/jpeg' },
        alt: { type: 'string', description: 'Alt text for images (required for accessibility)' },
      },
      required: ['name', 'content', 'contentType'],
    },
    rateLimitClass: 'write',
  };
}

function listMediaTool(): McpToolDefinition {
  return {
    name: 'list_media',
    description: 'List all media assets in the site\'s library with URLs, sizes, and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max items (default: 50)' },
        kind: { type: 'string', enum: ['image', 'video', 'document', 'all'], description: 'Filter by media kind' },
      },
    },
    rateLimitClass: 'read',
  };
}

function readAnalyticsTool(): McpToolDefinition {
  return {
    name: 'read_analytics',
    description: 'Get site analytics: visitors, pageviews, leads, bounce rate, top pages, and traffic sources for a given time range.',
    inputSchema: {
      type: 'object',
      properties: {
        timeRange: { type: 'string', enum: ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'last_month'], description: 'Time range for analytics data' },
        metric: { type: 'string', enum: ['visitors', 'pageviews', 'leads', 'bounce_rate', 'top_pages', 'traffic_sources', 'all'], description: 'Specific metric or all' },
      },
    },
    rateLimitClass: 'read',
  };
}

function manageSeoTool(): McpToolDefinition {
  return {
    name: 'manage_seo',
    description: 'Read or update SEO metadata for any page: title tag, meta description, OG tags, JSON-LD, canonical URL.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Page path' },
        action: { type: 'string', enum: ['read', 'update'], description: 'Read current SEO data or update it' },
        title: { type: 'string', description: 'New SEO title (50-60 chars, update only)' },
        metaDescription: { type: 'string', description: 'New meta description (120-156 chars, update only)' },
        canonicalUrl: { type: 'string', description: 'New canonical URL (update only)' },
      },
      required: ['path', 'action'],
    },
    rateLimitClass: 'write',
  };
}

// ── Main export ─────────────────────────────────────────────────────────────

const ALL_TOOLS: McpToolDefinition[] = [
  readPageTool(), listPagesTool(), createPageTool(), updatePageTool(),
  deletePageTool(), uploadMediaTool(), listMediaTool(),
  readAnalyticsTool(), manageSeoTool(),
];

/**
 * Generates the complete MCP server manifest for a site.
 *
 * This manifest is served at mcp.{slug}.projectsites.dev and tells AI agents
 * what tools are available, their input schemas, rate limits, and auth method.
 *
 * @param siteId - The site's database ID.
 * @param siteSlug - The site's URL slug.
 * @returns A complete SiteMcpManifest ready for the MCP server endpoint.
 */
export function generateMcpManifest(siteId: string, siteSlug: string): SiteMcpManifest {
  return {
    siteId,
    siteSlug,
    serverUrl: `https://mcp.${siteSlug}.projectsites.dev`,
    generatedAt: new Date().toISOString(),
    tools: ALL_TOOLS,
    toolCount: ALL_TOOLS.length,
    authMethod: 'oauth2_1',
    oauthScopes: ['site:read', 'site:write', 'site:media', 'site:analytics'],
  };
}
