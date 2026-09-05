/**
 * @module libs/features/mcp_connections/handlers
 *
 * @description
 * Hono routes for **per-site MCP (Model Context Protocol) connection
 * management** — the admin surface that lists a site's connected providers
 * (Mailchimp, Stripe, HubSpot, GitHub, …) and revokes one. Every route requires
 * both an `orgId` and a `userId` on the request context — the {@link need}
 * helper throws `HTTPError(401)` when either is missing — and guards site
 * ownership through {@link siteOwned} (404, never 403, on a missing/foreign site
 * so cross-org sites never leak). Access tokens are NEVER returned.
 *
 * | Method | Path                                        | Auth         | Purpose                                                |
 * | ------ | ------------------------------------------- | ------------ | ------------------------------------------------------ |
 * | GET    | /api/sites/:siteId/mcp/connections          | orgId+userId | List active MCP provider connections (+ provider list) |
 * | DELETE | /api/sites/:siteId/mcp/connections/:id       | orgId+userId | Revoke a connection + clear its encrypted tokens       |
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 19) — only the route-registration receiver changed (`aiAdmin.` →
 * `mcpConnections.`); the handler bodies are byte-for-byte unchanged. The module
 * imports its error/auth scaffolding (the `need(c)` / `siteOwned(...)` helpers,
 * the `safeJson` parser, and a byte-identical `onError`) from the SHARED
 * `src/lib/ai_admin_kit.ts` kit — no local copies — plus `allProviders` (the MCP
 * provider catalog) and the append-only `auditService` (the revoke path
 * audit-logs `mcp.disconnected` via `c.executionCtx.waitUntil`). It contains ONLY
 * these ai_admin-sourced routes, so exact reproduction = byte-identical behavior.
 * Both routes carry no request body, so there is no `schemas.ts` — param handling
 * is byte-identical to the original.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { need, siteOwned, safeJson, aiAdminOnError } from '../../../src/lib/ai_admin_kit.js';
import { allProviders } from '../../../src/services/mcp_client.js';
import * as auditService from '../../../src/services/audit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const mcpConnections = new Hono<AppContext>();

// Error/auth scaffolding (HTTPError · need · siteOwned · safeJson · onError) is
// shared via src/lib/ai_admin_kit.ts — imported above (route-decomposition
// installment 19). Byte-identical behavior to the ai_admin.ts inline copies; see
// the kit module doc for the siteOwned-vs-requireOwnedSite rationale.
mcpConnections.onError(aiAdminOnError);

/* ────────────────────────── MCP connections (list + disconnect) ────────────────────────── */

/**
 * `GET /api/sites/:siteId/mcp/connections` — List MCP (Model Context
 * Protocol) provider connections for a site.
 *
 * @remarks
 * Returns one row per provider (Mailchimp, Stripe, HubSpot, GitHub, …) with
 * connection status + last-sync timestamp. Never returns access tokens.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 */
mcpConnections.get('/api/sites/:siteId/mcp/connections', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, provider, display_name, status, scopes_json, account_metadata_json, connected_at
     FROM mcp_connections WHERE site_id = ? AND status = 'active'`,
  )
    .bind(siteId)
    .all();
  return c.json({
    data: {
      providers: allProviders(),
      connections: (rows.results ?? []).map((r) => ({
        ...r,
        metadata: safeJson(r['account_metadata_json'] as string | null),
      })),
    },
  });
});

/**
 * `DELETE /api/sites/:siteId/mcp/connections/:id` — Revoke an MCP provider
 * connection and clear its encrypted tokens.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 403 FORBIDDEN when the site is not owned by the caller's org.
 * @throws 404 NOT_FOUND when the connection id doesn't exist on that site.
 */
mcpConnections.delete('/api/sites/:siteId/mcp/connections/:id', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const connectionId = c.req.param('id');
  const connection = await c.env.DB.prepare(
    `SELECT provider FROM mcp_connections WHERE id = ? AND site_id = ?`,
  )
    .bind(connectionId, siteId)
    .first<{ provider: string }>();
  await c.env.DB.prepare(
    `UPDATE mcp_connections SET status = 'revoked', updated_at = datetime('now') WHERE id = ? AND site_id = ?`,
  )
    .bind(connectionId, siteId)
    .run();

  // Resolve the site slug so the audit message reads "…from site 'vito-salon'"
  // instead of a meaningless raw UUID (falls back to the id if the lookup misses).
  const siteRow = await c.env.DB.prepare(`SELECT slug FROM sites WHERE id = ?`)
    .bind(siteId)
    .first<{ slug: string }>();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'mcp.disconnected',
      message: `MCP '${connection?.provider ?? 'unknown'}' disconnected from site '${auditService.auditSiteLabel(siteRow?.slug, siteId)}'`,
      target_type: 'mcp_connection',
      target_id: connectionId,
      metadata_json: { site_id: siteId, provider: connection?.provider ?? null },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: { revoked: true } });
});
