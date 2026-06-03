/**
 * @module services/mcp_site_tools
 * @description MCP CRUD tool handlers for per-site external-agent access (#29).
 *
 * Each exported function implements one MCP tool handler that can be called
 * from the `tools/call` dispatch in `mcp_site.ts`.
 *
 * Auth is handled upstream: the caller already verified the per-site MCP token
 * and resolved the site ID before calling these handlers.
 *
 * @packageDocumentation
 */

import type { D1Database } from '@cloudflare/workers-types';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from './db.js';

// ─── Token management ─────────────────────────────────────────────────────────

/**
 * Hash a raw token with SHA-256 for at-rest storage.
 * Uses the Web Crypto API available in Workers.
 */
async function hashToken(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Mint a new random per-site MCP token.
 * Returns the raw token (only shown once) and the stored row id.
 */
export async function mintSiteMcpToken(
  db: D1Database,
  siteId: string,
  userId: string,
  label = 'Default',
): Promise<{ id: string; token: string }> {
  const rawToken = `ps_mcp_${crypto.randomUUID().replace(/-/g, '')}`;
  const tokenHash = await hashToken(rawToken);
  const id = crypto.randomUUID();

  await dbInsert(db, 'site_mcp_tokens', {
    id,
    site_id: siteId,
    token_hash: tokenHash,
    label,
    created_by: userId,
  });

  return { id, token: rawToken };
}

/**
 * Verify a raw MCP token against the stored hash for a site.
 * Updates `last_used` on success.
 */
export async function verifySiteMcpToken(
  db: D1Database,
  siteId: string,
  rawToken: string,
): Promise<boolean> {
  const tokenHash = await hashToken(rawToken);
  const row = await dbQueryOne<{ id: string }>(
    db,
    `SELECT id FROM site_mcp_tokens
      WHERE site_id = ? AND token_hash = ? AND revoked_at IS NULL`,
    [siteId, tokenHash],
  );
  if (!row) return false;

  // Fire-and-forget last_used update — don't await so auth stays fast.
  void dbUpdate(db, 'site_mcp_tokens', { last_used: new Date().toISOString() }, 'id = ?', [row.id]);
  return true;
}

/**
 * Revoke a token by id.
 */
export async function revokeSiteMcpToken(
  db: D1Database,
  tokenId: string,
  siteId: string,
): Promise<void> {
  await dbUpdate(
    db,
    'site_mcp_tokens',
    { revoked_at: new Date().toISOString() },
    'id = ? AND site_id = ?',
    [tokenId, siteId],
  );
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** Canonical list of tools the per-site MCP server exposes. */
export const SITE_MCP_TOOLS: readonly McpToolDef[] = [
  {
    name: 'list_pages',
    description: 'List all pages for this site with their slugs and titles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_page',
    description: 'Read the content of a specific page by slug.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'Page slug e.g. "/about"' } },
      required: ['slug'],
    },
  },
  {
    name: 'update_page_section',
    description: 'Update a specific section within a page.',
    inputSchema: {
      type: 'object',
      properties: {
        slug:        { type: 'string', description: 'Page slug' },
        section_id:  { type: 'string', description: 'Section identifier' },
        content:     { type: 'string', description: 'New HTML or markdown content' },
      },
      required: ['slug', 'section_id', 'content'],
    },
  },
  {
    name: 'create_page',
    description: 'Create a new page on the site.',
    inputSchema: {
      type: 'object',
      properties: {
        slug:    { type: 'string', description: 'URL slug, e.g. "/new-page"' },
        title:   { type: 'string', description: 'Page title' },
        content: { type: 'string', description: 'Page content (HTML or markdown)' },
      },
      required: ['slug', 'title', 'content'],
    },
  },
  {
    name: 'list_form_submissions',
    description: 'List recent form submissions for this site.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results (default 50)' } },
    },
  },
  {
    name: 'list_blog_posts',
    description: 'List blog posts for this site.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results (default 20)' } },
    },
  },
  {
    name: 'create_blog_post',
    description: 'Create a new blog post.',
    inputSchema: {
      type: 'object',
      properties: {
        title:   { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content (HTML or markdown)' },
        slug:    { type: 'string', description: 'URL slug (optional — auto-generated if omitted)' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'get_analytics_summary',
    description: 'Get a 30-day analytics summary for this site.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_media_assets',
    description: 'List media assets (images, videos) for this site.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results (default 30)' } },
    },
  },
] as const;

// ─── Tool handlers ────────────────────────────────────────────────────────────

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** Route a tools/call invocation to the right handler. */
export async function dispatchTool(
  db: D1Database,
  siteId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    // Each handler is async — `await` inside the try so a handler rejection (DB
    // failure, internal throw) is caught here and mapped to the `{ isError: true }`
    // envelope instead of escaping as a rejected promise. (convergence r48)
    switch (toolName) {
      case 'list_pages':
        return await handleListPages(db, siteId);
      case 'read_page':
        return await handleReadPage(db, siteId, args.slug as string);
      case 'update_page_section':
        return await handleUpdatePageSection(db, siteId, args);
      case 'create_page':
        return await handleCreatePage(db, siteId, args);
      case 'list_form_submissions':
        return await handleListFormSubmissions(db, siteId, (args.limit as number) ?? 50);
      case 'list_blog_posts':
        return await handleListBlogPosts(db, siteId, (args.limit as number) ?? 20);
      case 'create_blog_post':
        return await handleCreateBlogPost(db, siteId, args);
      case 'get_analytics_summary':
        return await handleGetAnalyticsSummary(db, siteId);
      case 'list_media_assets':
        return await handleListMediaAssets(db, siteId, (args.limit as number) ?? 30);
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: err instanceof Error ? err.message : 'internal error' }],
      isError: true,
    };
  }
}

// ─── Individual tool handlers ─────────────────────────────────────────────────

async function handleListPages(db: D1Database, siteId: string): Promise<ToolResult> {
  const { data } = await dbQuery<{ slug: string; title: string; created_at: string }>(
    db,
    `SELECT slug, title, created_at FROM site_pages
      WHERE site_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`,
    [siteId],
  );
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

async function handleReadPage(db: D1Database, siteId: string, slug: string): Promise<ToolResult> {
  if (!slug) return { content: [{ type: 'text', text: 'slug is required' }], isError: true };
  const row = await dbQueryOne<{ slug: string; title: string; content: string }>(
    db,
    'SELECT slug, title, content FROM site_pages WHERE site_id = ? AND slug = ? AND deleted_at IS NULL',
    [siteId, slug],
  );
  if (!row) return { content: [{ type: 'text', text: `Page not found: ${slug}` }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
}

async function handleUpdatePageSection(
  db: D1Database,
  siteId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const { slug, section_id, content } = args as { slug: string; section_id: string; content: string };
  if (!slug || !section_id || content === undefined) {
    return { content: [{ type: 'text', text: 'slug, section_id, and content are required' }], isError: true };
  }
  // Read the current page content, update the section, write back.
  const row = await dbQueryOne<{ id: string; content: string }>(
    db,
    'SELECT id, content FROM site_pages WHERE site_id = ? AND slug = ? AND deleted_at IS NULL',
    [siteId, slug],
  );
  if (!row) return { content: [{ type: 'text', text: `Page not found: ${slug}` }], isError: true };

  // Store the section override in a lightweight JSON patch column.
  await dbUpdate(
    db,
    'site_pages',
    { content: JSON.stringify({ ...safeParse(row.content), [section_id]: content }) },
    'id = ?',
    [row.id],
  );
  return { content: [{ type: 'text', text: `Section "${section_id}" updated on ${slug}.` }] };
}

async function handleCreatePage(
  db: D1Database,
  siteId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const { slug, title, content } = args as { slug: string; title: string; content: string };
  if (!slug || !title || content === undefined) {
    return { content: [{ type: 'text', text: 'slug, title, and content are required' }], isError: true };
  }
  const id = crypto.randomUUID();
  await dbInsert(db, 'site_pages', { id, site_id: siteId, slug, title, content });
  return { content: [{ type: 'text', text: `Page created: ${slug} (id: ${id})` }] };
}

async function handleListFormSubmissions(
  db: D1Database,
  siteId: string,
  limit: number,
): Promise<ToolResult> {
  const { data } = await dbQuery<Record<string, unknown>>(
    db,
    `SELECT id, form_slug, data, created_at FROM form_submissions
      WHERE site_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
    [siteId, Math.min(limit, 200)],
  );
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

async function handleListBlogPosts(
  db: D1Database,
  siteId: string,
  limit: number,
): Promise<ToolResult> {
  const { data } = await dbQuery<Record<string, unknown>>(
    db,
    `SELECT id, slug, title, published_at, created_at FROM blog_posts
      WHERE site_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
    [siteId, Math.min(limit, 100)],
  );
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

async function handleCreateBlogPost(
  db: D1Database,
  siteId: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const { title, content } = args as { title: string; content: string };
  const slug = (args.slug as string | undefined) ??
    `/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  if (!title || content === undefined) {
    return { content: [{ type: 'text', text: 'title and content are required' }], isError: true };
  }
  const id = crypto.randomUUID();
  await dbInsert(db, 'blog_posts', { id, site_id: siteId, slug, title, content });
  return { content: [{ type: 'text', text: `Blog post created: ${slug} (id: ${id})` }] };
}

async function handleGetAnalyticsSummary(
  db: D1Database,
  siteId: string,
): Promise<ToolResult> {
  const { data } = await dbQuery<Record<string, unknown>>(
    db,
    `SELECT metric, SUM(value) AS total
       FROM analytics_daily
      WHERE site_id = ? AND date >= date('now','-30 days')
      GROUP BY metric
      ORDER BY metric`,
    [siteId],
  );
  return { content: [{ type: 'text', text: JSON.stringify({ period: '30d', metrics: data }, null, 2) }] };
}

async function handleListMediaAssets(
  db: D1Database,
  siteId: string,
  limit: number,
): Promise<ToolResult> {
  const { data } = await dbQuery<Record<string, unknown>>(
    db,
    `SELECT id, filename, kind, source, r2_path, created_at FROM media_assets
      WHERE site_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
    [siteId, Math.min(limit, 100)],
  );
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ─── util ─────────────────────────────────────────────────────────────────────

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
