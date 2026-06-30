/**
 * Capability execution routes.
 *
 * POST /api/capabilities/execute — execute a capability through the router
 * GET  /api/capabilities          — list all registered capabilities
 *
 * @module routes/capabilities
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import type { OAuthProvider } from '../services/oauth_connections.js';
import { listAllCapabilities } from '../services/capability_registry.js';
import { executeCapability } from '../services/capability_router.js';
import { createNangoClient, createNoopNangoClient } from '../services/nango_client.js';
import { createComposioAdapter, noopComposioAdapter } from '../services/composio_adapter.js';
import { createPipedreamAdapter, noopPipedreamAdapter } from '../services/pipedream_adapter.js';

export const capabilities = new Hono<{ Bindings: Env; Variables: Variables }>();

const ExecuteCapabilitySchema = z.object({
  provider: z.enum(['google', 'slack', 'github', 'hubspot', 'notion', 'airtable', 'other']),
  action: z.string().min(1).max(128),
  capability: z.string().min(1).max(128).optional(),
  input: z.record(z.unknown()).default({}),
  siteId: z.string().optional(),
});

/**
 * POST /api/capabilities/execute — execute a capability through the Capability Router.
 *
 * The router enforces: auth → connection → scopes → native → composio → pipedream.
 * Never exposes tokens. Emits audit + metering.
 */
capabilities.post('/api/capabilities/execute', zValidator('json', ExecuteCapabilitySchema), async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) return c.json({ error: { message: 'auth required' } }, 401);

  const body = c.req.valid('json');

  const nango = c.env.NANGO_SECRET_KEY
    ? createNangoClient(c.env.NANGO_SECRET_KEY)
    : createNoopNangoClient();

  const composio = c.env.COMPOSIO_API_KEY
    ? createComposioAdapter(c.env as { COMPOSIO_API_KEY?: string })
    : noopComposioAdapter;

  const pipedream = c.env.PIPEDREAM_CLIENT_ID
    ? createPipedreamAdapter()
    : noopPipedreamAdapter;

  const getConnection = async (org: string, provider: OAuthProvider) => {
    const row = await c.env.DB.prepare(
      `SELECT id, org_id, site_id, provider, display_name, status, scopes_json,
              connected_at, updated_at
         FROM mcp_connections
        WHERE org_id = ? AND provider = ? AND status = 'active' AND deleted_at IS NULL
        ORDER BY connected_at DESC LIMIT 1`,
    )
      .bind(org, provider)
      .first<{
        id: string; org_id: string; site_id: string | null; provider: string;
        display_name: string; status: string; scopes_json: string | null;
        connected_at: string; updated_at: string;
      }>();
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.org_id,
      siteId: row.site_id ?? undefined,
      userId,
      provider: row.provider as OAuthProvider,
      providerAccountId: '',
      nangoConnectionId: row.id,
      nangoProviderConfigKey: row.provider,
      scopes: row.scopes_json ? (JSON.parse(row.scopes_json) as string[]) : [],
      status: row.status as 'active' | 'expired' | 'revoked' | 'reauth_required' | 'disabled',
      createdAt: row.connected_at,
      updatedAt: row.updated_at,
    };
  };

  const result = await executeCapability(
    {
      orgId,
      siteId: body.siteId,
      userId,
      provider: body.provider as OAuthProvider,
      capability: body.capability ?? body.action,
      action: body.action,
      input: body.input,
    },
    {
      nango,
      composio,
      pipedream,
      getConnection,
      emitAudit: (event) => { c.executionCtx.waitUntil(Promise.resolve()); },
      emitMetering: (event) => { c.executionCtx.waitUntil(Promise.resolve()); },
    },
  );

  if (!result.success) {
    return c.json({ error: result.error }, result.error?.code === 'NO_CONNECTION' ? 404 : 400);
  }

  return c.json({ data: result.data });
});

/**
 * GET /api/capabilities — list all registered capabilities across providers.
 */
capabilities.get('/api/capabilities', async (c) => {
  const all = listAllCapabilities();
  return c.json({
    data: all.map(({ provider, action, entry }) => ({
      provider,
      action,
      preferredRuntime: entry.preferred,
      fallbacks: entry.fallbacks,
      requiredScopes: entry.requiredScopes,
      meteringUnit: entry.meteringUnit,
    })),
  });
});
