/**
 * @module routes/mcp_site
 * @description MCP-per-site endpoints — every customer site exposes an MCP
 * server so AI agents (ChatGPT/Claude/Perplexity) can transact directly.
 *
 * Spec compliance: MCP 2025-11-25 (Streamable HTTP, JSON-RPC 2.0,
 * OAuth 2.1 + RFC 8707 Resource Indicators). Per-tenant audience binding
 * stops the confused-deputy attack.
 *
 * | Path                                                   | Purpose                                |
 * | ------------------------------------------------------ | -------------------------------------- |
 * | `GET  /{slug}/.well-known/oauth-protected-resource`    | RFC 9728 PRM doc                       |
 * | `GET  /{slug}/.well-known/mcp`                         | SEP-1960 capability doc (forward-compat) |
 * | `POST /{slug}/mcp`                                     | JSON-RPC 2.0 (initialize/tools/call)    |
 * | `GET  /api/sites/:siteId/mcp/tools`                    | Admin: list per-site MCP tools          |
 * | `POST /api/sites/:siteId/mcp/tools`                    | Admin: enable/disable tools             |
 * | `GET  /api/sites/:siteId/mcp/calls`                    | Admin: recent agent calls feed          |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { unauthorized, forbidden } from '@project-sites/shared';
import {
  SITE_MCP_TOOLS,
  dispatchTool,
  mintSiteMcpToken,
  verifySiteMcpToken,
  revokeSiteMcpToken,
} from '../services/mcp_site_tools.js';

type McpCtx = Context<{ Bindings: Env; Variables: Variables }>;
const mcpSite = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Public per-site endpoints (no admin auth — uses MCP OAuth flow) ──────
// Two forms supported:
//   1. Subdomain — `{slug}.projectsites.dev/.well-known/mcp` (canonical)
//   2. Path-based — `projectsites.dev/{slug}/.well-known/mcp` (admin testing)
// `slugFromHost(c)` resolves form #1 by parsing the host header.

function slugFromHost(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const host = c.req.header('host') ?? '';
  // Reject base domain + workers.dev variants. Pick first label only on `.projectsites.dev`.
  const m = host.match(/^([a-z0-9-]+)\.projectsites\.dev$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * `GET /.well-known/oauth-protected-resource` — RFC 9728 Protected
 * Resource Metadata for the subdomain-form MCP server (`{slug}.projectsites.dev`).
 *
 * @throws 404 NOT_FOUND when called on the base domain or the site doesn't exist.
 */
mcpSite.get('/.well-known/oauth-protected-resource', async (c) => {
  const slug = slugFromHost(c);
  if (!slug) return c.json({ error: 'not_a_site_subdomain' }, 404);
  const site = await resolvePublicSite(c, slug);
  if (!site) return c.json({ error: 'site_not_found' }, 404);
  const host = c.req.header('host')!;
  return c.json({
    resource: `https://${host}/mcp`,
    authorization_servers: ['https://auth.projectsites.dev'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['site:read', 'bookings:write'],
    resource_documentation: `https://${host}/.well-known/mcp`,
  });
});

/**
 * `GET /.well-known/mcp` — SEP-1960 capability discovery doc for the
 * subdomain-form MCP server (forward-compat).
 *
 * @throws 404 NOT_FOUND when called on the base domain or the site doesn't exist.
 */
mcpSite.get('/.well-known/mcp', async (c) => {
  const slug = slugFromHost(c);
  if (!slug) return c.json({ error: 'not_a_site_subdomain' }, 404);
  const site = await resolvePublicSite(c, slug);
  if (!site) return c.json({ error: 'site_not_found' }, 404);
  const host = c.req.header('host')!;
  const { data: tools } = await dbQuery<{
    tool_name: string;
    handler_kind: string;
    schema_json: string;
    requires_auth: number;
  }>(
    c.env.DB,
    `SELECT tool_name, handler_kind, schema_json, requires_auth
       FROM mcp_tools WHERE site_id = ? AND enabled = 1`,
    [site.id],
  );
  // Merge DB tools + built-in CRUD tools (SITE_MCP_TOOLS) in the manifest.
  return c.json({
    protocol_version: '2025-11-25',
    transport: 'streamable-http',
    endpoint: `https://${host}/mcp`,
    site_slug: slug,
    tools: [
      ...tools.map((t) => ({
        name: t.tool_name,
        handler: t.handler_kind,
        input_schema: safeParse(t.schema_json),
        requires_auth: t.requires_auth === 1,
      })),
      ...SITE_MCP_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
        requires_auth: true,
      })),
    ],
  });
});

/**
 * `GET /:slug/.well-known/oauth-protected-resource` — Path-based variant
 * of the PRM doc for admin testing on the base domain.
 *
 * @throws 404 NOT_FOUND when the slug doesn't exist.
 */
mcpSite.get('/:slug/.well-known/oauth-protected-resource', async (c) => {
  const slug = c.req.param('slug');
  const site = await resolvePublicSite(c, slug);
  if (!site) return c.json({ error: 'site_not_found' }, 404);
  const host = c.req.header('host') ?? `${slug}.projectsites.dev`;
  const resource = `https://${host}/mcp`;
  return c.json({
    resource,
    authorization_servers: ['https://auth.projectsites.dev'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['site:read', 'bookings:write'],
    resource_documentation: `https://${host}/.well-known/mcp`,
  });
});

/**
 * `GET /:slug/.well-known/mcp` — Path-based variant of the SEP-1960
 * capability doc for admin testing on the base domain.
 *
 * @throws 404 NOT_FOUND when the slug doesn't exist.
 */
mcpSite.get('/:slug/.well-known/mcp', async (c) => {
  const slug = c.req.param('slug');
  const site = await resolvePublicSite(c, slug);
  if (!site) return c.json({ error: 'site_not_found' }, 404);
  const host = c.req.header('host') ?? `${slug}.projectsites.dev`;
  const { data: tools } = await dbQuery<{
    tool_name: string;
    handler_kind: string;
    schema_json: string;
    requires_auth: number;
  }>(
    c.env.DB,
    `SELECT tool_name, handler_kind, schema_json, requires_auth
       FROM mcp_tools WHERE site_id = ? AND enabled = 1`,
    [site.id],
  );
  return c.json({
    protocol_version: '2025-11-25',
    transport: 'streamable-http',
    endpoint: `https://${host}/mcp`,
    tools: [
      ...tools.map((t) => ({
        name: t.tool_name,
        handler: t.handler_kind,
        input_schema: safeParse(t.schema_json),
        requires_auth: t.requires_auth === 1,
      })),
      ...SITE_MCP_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
        requires_auth: true,
      })),
    ],
  });
});

/**
 * `POST /mcp` — JSON-RPC 2.0 MCP server endpoint on the subdomain form
 * (`{slug}.projectsites.dev/mcp`).
 *
 * @remarks
 * Supports `initialize`, `tools/list`, `tools/call`. OAuth audience
 * binding ties the access token to a single site to prevent
 * confused-deputy attacks.
 *
 * @throws 401 UNAUTHORIZED when Bearer token missing or audience mismatch.
 * @throws 404 NOT_FOUND when called on the base domain or the site doesn't exist.
 */
mcpSite.post('/mcp', async (c) => {
  const slug = slugFromHost(c);
  if (!slug) return c.json(jsonRpcError(-32601, 'not_a_site_subdomain', null), 404);
  return handleMcpPost(c, slug);
});

/**
 * `POST /:slug/mcp` — Path-based variant of the JSON-RPC MCP server for
 * admin testing on the base domain.
 *
 * @throws 401 UNAUTHORIZED when Bearer token missing or audience mismatch.
 * @throws 404 NOT_FOUND when the slug doesn't exist.
 */
mcpSite.post('/:slug/mcp', async (c) => {
  const slug = c.req.param('slug');
  return handleMcpPost(c, slug);
});

async function handleMcpPost(c: McpCtx, slug: string): Promise<Response> {
  const site = await resolvePublicSite(c, slug);
  if (!site) return c.json(jsonRpcError(-32601, 'site not found', null), 404);
  let body: { jsonrpc: string; id: number | string | null; method: string; params?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonRpcError(-32700, 'parse error', null), 400);
  }
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return c.json(jsonRpcError(-32600, 'invalid request', body.id ?? null), 400);
  }
  const startedAt = Date.now();
  let status: 'ok' | 'error' | 'rate_limited' | 'unauthorized' = 'ok';
  let response: unknown;
  try {
    switch (body.method) {
      case 'initialize':
        response = { protocolVersion: '2025-11-25', serverInfo: { name: `projectsites:${slug}`, version: '1.0.0' } };
        break;
      case 'tools/list': {
        const { data: tools } = await dbQuery<{
          tool_name: string;
          schema_json: string;
          requires_auth: number;
        }>(
          c.env.DB,
          `SELECT tool_name, schema_json, requires_auth FROM mcp_tools
             WHERE site_id = ? AND enabled = 1`,
          [site.id],
        );
        response = {
          tools: [
            ...tools.map((t) => ({
              name: t.tool_name,
              inputSchema: safeParse(t.schema_json),
              requiresAuth: t.requires_auth === 1,
            })),
            ...SITE_MCP_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
              requiresAuth: true,
            })),
          ],
        };
        break;
      }
      case 'tools/call': {
        const params = (body.params as { name?: string; arguments?: Record<string, unknown> }) ?? {};
        if (!params.name) {
          status = 'error';
          response = jsonRpcError(-32602, 'tool name required', body.id).error;
        } else {
          // Verify per-site MCP token for CRUD tools that mutate site data.
          const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
          if (!bearer || !(await verifySiteMcpToken(c.env.DB, site.id, bearer))) {
            status = 'unauthorized';
            response = jsonRpcError(-32001, 'unauthorized', body.id).error;
          } else {
            response = await dispatchTool(
              c.env.DB,
              site.id,
              params.name,
              (params.arguments ?? {}) as Record<string, unknown>,
            );
            if ((response as { isError?: boolean }).isError) status = 'error';
          }
        }
        break;
      }
      default:
        status = 'error';
        response = jsonRpcError(-32601, `method ${body.method} not found`, body.id).error;
    }
  } catch (err) {
    status = 'error';
    response = jsonRpcError(-32603, err instanceof Error ? err.message : 'internal error', body.id).error;
  }
  const latencyMs = Date.now() - startedAt;
  // Log call asynchronously to keep p99 fast.
  c.executionCtx.waitUntil(
    dbInsert(c.env.DB, 'mcp_calls', {
      id: crypto.randomUUID(),
      site_id: site.id,
      tool_name:
        body.method === 'tools/call' ? (body.params as { name?: string })?.name ?? '?' : body.method,
      agent_user_agent: c.req.header('user-agent') ?? null,
      agent_client_id: null,
      result_status: status,
      latency_ms: latencyMs,
      request_id: c.get('requestId') ?? null,
    }),
  );
  return c.json({ jsonrpc: '2.0', id: body.id, result: response });
}

// ─── Admin: per-site MCP tool management (requires site ownership) ────────

/**
 * `GET /api/sites/:siteId/mcp/tools` — Admin: list per-site MCP tools
 * exposed by the site's MCP server with enable/disable status.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site isn't owned by the caller's org.
 */
mcpSite.get('/api/sites/:siteId/mcp/tools', async (c) => {
  const siteId = c.req.param('siteId');
  await assertSiteOwnership(c, siteId);
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, tool_name, handler_kind, schema_json, requires_auth,
            scopes_json, enabled, updated_at
       FROM mcp_tools WHERE site_id = ? ORDER BY tool_name`,
    [siteId],
  );
  return c.json({ tools: data });
});

const toolPatchSchema = z.object({
  tool_name: z.string().min(2).max(64),
  enabled: z.boolean(),
});

/**
 * `POST /api/sites/:siteId/mcp/tools` — Admin: enable or disable individual
 * MCP tools per site.
 *
 * @remarks
 * Body: {@link toolPatchSchema}.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site isn't owned by the caller's org.
 */
mcpSite.post('/api/sites/:siteId/mcp/tools', zValidator('json', toolPatchSchema), async (c) => {
  const siteId = c.req.param('siteId');
  await assertSiteOwnership(c, siteId);
  const body = c.req.valid('json');
  await c.env.DB.prepare(
    `UPDATE mcp_tools SET enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE site_id = ? AND tool_name = ?`,
  )
    .bind(body.enabled ? 1 : 0, siteId, body.tool_name)
    .run();
  return c.json({ ok: true });
});

/**
 * `GET /api/sites/:siteId/mcp/calls` — Admin: recent agent-call feed
 * (tool name, agent identity, status, latency).
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site isn't owned by the caller's org.
 */
mcpSite.get('/api/sites/:siteId/mcp/calls', async (c) => {
  const siteId = c.req.param('siteId');
  await assertSiteOwnership(c, siteId);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, tool_name, called_at, agent_user_agent, agent_client_id,
            result_status, latency_ms
       FROM mcp_calls
       WHERE site_id = ? ORDER BY called_at DESC LIMIT ?`,
    [siteId, limit],
  );
  return c.json({ calls: data });
});

// ─── Admin: per-site MCP token management ─────────────────────────────────

/**
 * `GET /api/sites/:siteId/mcp/tokens` — list non-revoked tokens (hashes hidden).
 */
mcpSite.get('/api/sites/:siteId/mcp/tokens', async (c) => {
  const siteId = c.req.param('siteId');
  await assertSiteOwnership(c, siteId);
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, label, last_used, created_at, created_by
       FROM site_mcp_tokens
      WHERE site_id = ? AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [siteId],
  );
  return c.json({ tokens: data });
});

const mintTokenSchema = z.object({ label: z.string().min(1).max(64).optional() });

/**
 * `POST /api/sites/:siteId/mcp/tokens` — mint a new token. Raw token returned once.
 */
mcpSite.post('/api/sites/:siteId/mcp/tokens', zValidator('json', mintTokenSchema), async (c) => {
  const siteId = c.req.param('siteId');
  await assertSiteOwnership(c, siteId);
  const userId = c.get('userId');
  if (!userId) throw unauthorized();
  const { label } = c.req.valid('json');
  const result = await mintSiteMcpToken(c.env.DB, siteId, userId, label ?? 'Default');
  return c.json(result, 201);
});

/**
 * `DELETE /api/sites/:siteId/mcp/tokens/:tokenId` — revoke a token.
 */
mcpSite.delete('/api/sites/:siteId/mcp/tokens/:tokenId', async (c) => {
  const siteId = c.req.param('siteId');
  await assertSiteOwnership(c, siteId);
  const tokenId = c.req.param('tokenId');
  await revokeSiteMcpToken(c.env.DB, tokenId, siteId);
  return c.json({ ok: true });
});

/**
 * `GET /api/sites/:siteId/mcp/tool-usage` — per-tool daily usage (last 30d).
 */
mcpSite.get('/api/sites/:siteId/mcp/tool-usage', async (c) => {
  const siteId = c.req.param('siteId');
  await assertSiteOwnership(c, siteId);
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT tool_name, day, call_count, error_count
       FROM site_mcp_tool_usage
      WHERE site_id = ? AND day >= date('now','-30 days')
      ORDER BY day DESC, call_count DESC`,
    [siteId],
  );
  return c.json({ usage: data });
});

// ─── helpers ──────────────────────────────────────────────────────────────

interface SiteRow {
  id: string;
  slug: string;
  org_id: string;
}

async function resolvePublicSite(
  c: { env: Env },
  slug: string,
): Promise<SiteRow | null> {
  return await dbQueryOne<SiteRow>(
    c.env.DB,
    'SELECT id, slug, org_id FROM sites WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
    [slug],
  );
}

async function assertSiteOwnership(
  c: { env: Env; get: (k: string) => string | undefined },
  siteId: string,
): Promise<string> {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const row = await dbQueryOne<{ org_id: string }>(
    c.env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [siteId],
  );
  if (!row || row.org_id !== orgId) throw forbidden('Site not accessible');
  return orgId;
}

function jsonRpcError(
  code: number,
  message: string,
  id: number | string | null,
): { jsonrpc: '2.0'; id: number | string | null; error: { code: number; message: string } } {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export { mcpSite };
