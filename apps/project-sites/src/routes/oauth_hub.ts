/**
 * ProjectSites OAuth Hub routes.
 *
 * Canonical OAuth connection management:
 * - GET  /api/oauth/providers
 * - GET  /api/oauth/connections
 * - POST /api/oauth/connect/:provider
 * - POST /api/oauth/disconnect/:connectionId
 * - POST /api/oauth/reauth/:connectionId
 *
 * ProjectSites owns OAuth — customers connect providers THROUGH ProjectSites.
 *
 * @module routes/oauth_hub
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import type {
  OAuthProvider,
  OAuthConnection,
  OAuthConnectionStatus,
} from '../services/oauth_connections.js';
import { TOOL_CAPABILITY_REGISTRY } from '../services/capability_registry.js';
import { createNangoClient } from '../services/nango_client.js';

export const oauthHub = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Provider metadata surfaced to the OAuth UX. */
interface ProviderMeta {
  provider: OAuthProvider;
  label: string;
  capabilities: string[];
  scopes: string[];
}

/** Static provider catalog. */
const PROVIDER_CATALOG: ProviderMeta[] = [
  { provider: 'google', label: 'Google', capabilities: ['gmail.send_email', 'gmail.search_threads', 'calendar.create_event', 'calendar.check_availability', 'drive.find_file'], scopes: [] },
  { provider: 'slack', label: 'Slack', capabilities: ['slack.send_message'], scopes: ['chat:write'] },
  { provider: 'github', label: 'GitHub', capabilities: ['github.create_issue'], scopes: ['repo'] },
  { provider: 'hubspot', label: 'HubSpot', capabilities: ['hubspot.create_contact'], scopes: ['crm.objects.contacts.write'] },
  { provider: 'notion', label: 'Notion', capabilities: ['notion.create_page'], scopes: [] },
  { provider: 'airtable', label: 'Airtable', capabilities: ['airtable.create_record'], scopes: [] },
];

/**
 * GET /api/oauth/providers — list available OAuth providers.
 */
oauthHub.get('/api/oauth/providers', async (c) => {
  return c.json({ data: PROVIDER_CATALOG });
});

/**
 * GET /api/oauth/connections — list caller org's active OAuth connections.
 * Never returns encrypted tokens.
 */
oauthHub.get('/api/oauth/connections', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  if (!orgId) return c.json({ error: { message: 'auth required' } }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT id, org_id, site_id, provider, display_name, status, scopes_json,
            token_expires_at, connected_at, updated_at
       FROM mcp_connections WHERE org_id = ? AND deleted_at IS NULL
       ORDER BY connected_at DESC`,
  )
    .bind(orgId)
    .all<Record<string, unknown>>();

  const data = (rows.results ?? []).map((r) => ({
    id: r['id'],
    orgId: r['org_id'],
    siteId: r['site_id'] ?? null,
    provider: r['provider'],
    displayName: r['display_name'],
    status: r['status'],
    scopes: r['scopes_json'] ? (JSON.parse(r['scopes_json'] as string) as string[]) : [],
    tokenExpiresAt: r['token_expires_at'] ?? null,
    connectedAt: r['connected_at'],
    updatedAt: r['updated_at'],
  }));

  return c.json({ data });
});

const ConnectBody = z.object({
  siteId: z.string().optional(),
  requiredScopes: z.array(z.string()).optional(),
  returnUrl: z.string().optional(),
});

/**
 * POST /api/oauth/connect/:provider — start an OAuth connection flow.
 * Returns the Nango connect URL.
 */
oauthHub.post('/api/oauth/connect/:provider', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) return c.json({ error: { message: 'auth required' } }, 401);

  const provider = c.req.param('provider') as OAuthProvider;
  const meta = PROVIDER_CATALOG.find((p) => p.provider === provider);
  if (!meta) return c.json({ error: { message: 'unknown provider' } }, 404);

  let body: z.infer<typeof ConnectBody>;
  try {
    body = ConnectBody.parse(await c.req.json().catch(() => ({})));
  } catch {
    return c.json({ error: { message: 'invalid body' } }, 400);
  }

  const scopes = body.requiredScopes ?? meta.scopes;
  const nangoKey = c.env.NANGO_SECRET_KEY;
  if (!nangoKey) {
    return c.json({ error: { message: 'Nango not configured' } }, 501);
  }

  const nango = createNangoClient(nangoKey);
  try {
    const session = await nango.createConnectSession({
      provider,
      orgId,
      siteId: body.siteId,
      userId,
      requiredScopes: scopes,
    });

    return c.json({
      data: {
        connectUrl: session.connectUrl,
        nangoConnectionId: session.nangoConnectionId,
        providerConfigKey: session.providerConfigKey,
        provider,
        scopes,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: { message: `Nango connect failed: ${msg}` } }, 502);
  }
});

/**
 * POST /api/oauth/disconnect/:connectionId — revoke an OAuth connection.
 */
oauthHub.post('/api/oauth/disconnect/:connectionId', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  if (!orgId) return c.json({ error: { message: 'auth required' } }, 401);

  const connectionId = c.req.param('connectionId');
  const row = await c.env.DB.prepare(
    `SELECT id, provider FROM mcp_connections WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(connectionId, orgId)
    .first<{ id: string; provider: string }>();

  if (!row) return c.json({ error: { message: 'connection not found' } }, 404);

  await c.env.DB.prepare(
    `UPDATE mcp_connections SET status = 'revoked', deleted_at = datetime('now') WHERE id = ?`,
  )
    .bind(connectionId)
    .run();

  return c.json({ data: { disconnected: true, connectionId } });
});

/**
 * POST /api/oauth/reauth/:connectionId — mark a connection for reauth.
 */
oauthHub.post('/api/oauth/reauth/:connectionId', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  if (!orgId) return c.json({ error: { message: 'auth required' } }, 401);

  const connectionId = c.req.param('connectionId');
  const row = await c.env.DB.prepare(
    `SELECT id FROM mcp_connections WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(connectionId, orgId)
    .first<{ id: string }>();

  if (!row) return c.json({ error: { message: 'connection not found' } }, 404);

  await c.env.DB.prepare(
    `UPDATE mcp_connections SET status = 'reauth_required' WHERE id = ?`,
  )
    .bind(connectionId)
    .run();

  return c.json({ data: { reauthRequired: true, connectionId } });
});
