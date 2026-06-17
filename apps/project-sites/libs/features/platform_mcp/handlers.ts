/**
 * @module libs/features/platform_mcp/handlers
 * @description Platform-level MCP server so external agent tools (Claude Code,
 * Cursor, Cline, any MCP client) connect to projectsites.dev and manage the
 * caller's sites. JSON-RPC 2.0 — the same shape as the per-site server
 * (`mcp_site.ts`), but account-scoped via an API token instead of a site token.
 *
 * | Method | Path                  | Purpose                                   |
 * | ------ | --------------------- | ----------------------------------------- |
 * | GET    | /api/mcp              | Human/agent discovery manifest + how-to   |
 * | POST   | /api/mcp              | JSON-RPC: initialize / tools/list / tools/call |
 *
 * Auth: `Authorization: Bearer psk_…` (a scoped Public API token minted at
 * /admin/api-tokens). `initialize` + `tools/list` are open (static catalog, no
 * data); `tools/call` requires a valid token + the tool's scope. Flag-gated:
 * 404 when `platform_mcp` is off (never 403 — don't leak existence).
 *
 * @packageDocumentation
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { verifyApiToken, extractBearerToken } from '../../../src/services/api_tokens.js';
import { dbInsert } from '../../../src/services/db.js';
import { JsonRpcRequestSchema, ToolCallParamsSchema } from './schemas.js';
import { FLAG_KEY, PLATFORM_MCP_TOOLS, dispatchPlatformTool } from './service.js';

/** Known tool names — audit logging records only these (never caller-supplied junk). */
const KNOWN_TOOLS = new Set<string>(PLATFORM_MCP_TOOLS.map((t) => t.name));

type AppContext = { Bindings: Env; Variables: Variables };

export const platformMcp = new Hono<AppContext>();

const SERVER = { name: 'projectsites.dev', version: '1.0.0' } as const;
const PROTOCOL_VERSION = '2025-11-25';

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id: (id ?? null) as null, error: { code, message } };
}

/** GET /api/mcp — discovery manifest (also what a human sees when they curl it). */
platformMcp.get('/api/mcp', async (c) => {
  if (!(await isFlagOn(c.env, FLAG_KEY, {}))) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  return c.json({
    server: SERVER,
    protocolVersion: PROTOCOL_VERSION,
    transport: 'jsonrpc-2.0 over HTTP POST',
    endpoint: '/api/mcp',
    auth: {
      type: 'bearer',
      header: 'Authorization: Bearer psk_<your-token>',
      get_a_token: 'https://projectsites.dev/admin/api-tokens',
      scopes: ['sites:read', 'sites:write'],
    },
    tools: PLATFORM_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    claude_code: {
      hint: 'Add to .mcp.json — see libs/features/platform_mcp/README.md',
    },
  });
});

/** POST /api/mcp — JSON-RPC 2.0. */
platformMcp.post('/api/mcp', async (c) => {
  if (!(await isFlagOn(c.env, FLAG_KEY, {}))) return c.json(jsonRpcError(null, -32601, 'not found'), 404);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(jsonRpcError(null, -32700, 'parse error'), 400);
  }
  const parsed = JsonRpcRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const id = (raw as { id?: unknown })?.id ?? null;
    return c.json(jsonRpcError(id, -32600, 'invalid request'), 400);
  }
  const body = parsed.data;
  const startedAt = Date.now();
  let status: 'ok' | 'error' | 'unauthorized' = 'ok';
  let result: unknown;

  try {
    switch (body.method) {
      case 'initialize':
        result = { protocolVersion: PROTOCOL_VERSION, serverInfo: SERVER, capabilities: { tools: {} } };
        break;
      case 'tools/list':
        result = {
          tools: PLATFORM_MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        };
        break;
      case 'tools/call': {
        const p = ToolCallParamsSchema.safeParse(body.params);
        if (!p.success) {
          status = 'error';
          result = jsonRpcError(body.id, -32602, 'tool name required').error;
          break;
        }
        const token = await verifyApiToken(c.env.DB, extractBearerToken(c.req.header('authorization') ?? null) ?? '');
        if (!token) {
          status = 'unauthorized';
          result = jsonRpcError(body.id, -32001, 'unauthorized — connect with a psk_ API token (Bearer)').error;
          break;
        }
        const r = await dispatchPlatformTool(c.env, token, p.data.name, p.data.arguments);
        if (r.isError) status = 'error';
        result = r;
        break;
      }
      default:
        status = 'error';
        result = jsonRpcError(body.id, -32601, `method ${body.method} not found`).error;
    }
  } catch (e) {
    status = 'error';
    // Log the real cause server-side; return a generic message (never leak
    // stack traces / SQL / internal object keys to the caller).
    console.warn(JSON.stringify({ event: 'platform_mcp.dispatch_error', method: body.method, error: e instanceof Error ? e.message : String(e) }));
    result = jsonRpcError(body.id, -32603, 'internal server error').error;
  }

  c.executionCtx.waitUntil(
    dbInsert(c.env.DB, 'mcp_calls', {
      id: crypto.randomUUID(),
      site_id: null,
      tool_name:
        body.method === 'tools/call'
          ? (() => {
              const n = (body.params as { name?: string })?.name;
              return n && KNOWN_TOOLS.has(n) ? n : 'unknown';
            })()
          : body.method,
      agent_user_agent: c.req.header('user-agent') ?? null,
      agent_client_id: 'platform',
      result_status: status,
      latency_ms: Date.now() - startedAt,
      request_id: (c as Context<AppContext>).get('requestId') ?? null,
    }).catch(() => undefined),
  );

  if (status === 'unauthorized') {
    // RFC 9728 / MCP auth: answer an unauthenticated tools/call with HTTP 401 +
    // a WWW-Authenticate header pointing at the Protected Resource Metadata, so an
    // OAuth-capable client auto-discovers the authorization server instead of needing
    // the PRM URL out-of-band. The JSON-RPC -32001 body is preserved for clients that
    // read it. (initialize/tools/list stay open 200 — no auth, no data.)
    const host = c.req.header('host') ?? 'projectsites.dev';
    const proto = c.req.header('x-forwarded-proto') ?? 'https';
    const prm = `${proto}://${host}/.well-known/oauth-protected-resource`;
    return c.json({ jsonrpc: '2.0', id: body.id ?? null, result }, 401, {
      'WWW-Authenticate': `Bearer resource_metadata="${prm}"`,
    });
  }
  return c.json({ jsonrpc: '2.0', id: body.id ?? null, result });
});
