/**
 * @module libs/features/site_mcp_server/handlers
 *
 * @description
 * Hono routes for the **per-site MCP server** admin surface (#29) — token
 * management (list / mint / revoke), the exposed tool registry, and 30-day
 * per-tool usage. Backs the `/admin/sites/:id/mcp-server` section.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The per-site MCP feature was built end-to-end — the service logic
 * ({@link mintSiteMcpToken}/{@link revokeSiteMcpToken}/{@link SITE_MCP_TOOLS} in
 * `services/mcp_site_tools.ts`), the D1 tables (`site_mcp_tokens` +
 * `site_mcp_tool_usage`, migrations 0514/0625), and the full Angular section —
 * but **no route ever wired the service to the frontend**. Every endpoint the
 * section calls (`/mcp/tokens`, `/mcp/tools`, `/mcp/tool-usage`) 404'd, so the
 * admin surface rendered "Couldn't load tokens" / "Couldn't load tools" error
 * cards (a dead/false-success-copy contract failure — `contract-sweep.mjs`
 * `sites-mcp-server`, 2026-09-05). This module is the missing wiring.
 *
 * Every route requires an `orgId` + `userId` on the request context ({@link need}
 * throws 401 when either is missing) and guards site ownership through
 * {@link siteOwned} (404, never 403, on a missing/foreign site so cross-org sites
 * never leak — the IDOR guard). Raw tokens are returned exactly ONCE, on mint;
 * only their SHA-256 hash is persisted, and they are never re-shown.
 *
 * | Method | Path                                    | Auth         | Purpose                              |
 * | ------ | --------------------------------------- | ------------ | ------------------------------------ |
 * | GET    | /api/sites/:siteId/mcp/tokens           | orgId+userId | List non-revoked tokens              |
 * | POST   | /api/sites/:siteId/mcp/tokens           | orgId+userId | Mint a token (raw shown once)        |
 * | DELETE | /api/sites/:siteId/mcp/tokens/:tokenId  | orgId+userId | Revoke a token                       |
 * | GET    | /api/sites/:siteId/mcp/tools            | orgId+userId | The site MCP tool registry           |
 * | GET    | /api/sites/:siteId/mcp/tool-usage       | orgId+userId | 30-day per-tool usage counters       |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../../../src/types/env.js';
import { need, siteOwned, aiAdminOnError } from '../../../src/lib/ai_admin_kit.js';
import {
  mintSiteMcpToken,
  revokeSiteMcpToken,
  SITE_MCP_TOOLS,
} from '../../../src/services/mcp_site_tools.js';
import * as auditService from '../../../src/services/audit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const siteMcpServer = new Hono<AppContext>();

// Shared error/auth scaffolding (HTTPError · need · siteOwned · onError) comes
// from src/lib/ai_admin_kit.ts, matching the sibling `mcp_connections` module.
siteMcpServer.onError(aiAdminOnError);

/**
 * Mint-token body. `label` is cosmetic (shown in the admin list), so a malformed
 * or over-long value fails SOFT to 'Default' rather than 400-ing the operator —
 * `.catch({})` on the object swallows any inner-constraint failure.
 */
const MintTokenBody = z
  .object({ label: z.string().trim().min(1).max(80).optional() })
  .catch({});

/**
 * `GET /api/sites/:siteId/mcp/tokens` — List the site's non-revoked MCP tokens.
 *
 * @returns `{ tokens: Array<{ id, label, last_used, created_at }> }` — never the
 *   raw token or its hash. An honest `{ tokens: [] }` when none exist.
 * @throws 401 when org/user context is missing; 404 when the site is missing/foreign.
 * @example
 * GET /api/sites/abc/mcp/tokens → { tokens: [{ id, label: 'CI', last_used: null, created_at }] }
 */
siteMcpServer.get('/api/sites/:siteId/mcp/tokens', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, label, last_used, created_at FROM site_mcp_tokens
      WHERE site_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all();
  return c.json({ tokens: rows.results ?? [] });
});

/**
 * `POST /api/sites/:siteId/mcp/tokens` — Mint a new per-site MCP token. The raw
 * token is returned ONCE and never stored (only its SHA-256 hash is persisted).
 *
 * @returns `{ id, token }` — `token` is the one-time raw secret to copy.
 * @throws 401 when org/user context is missing; 404 when the site is missing/foreign;
 *   500 (via mintSiteMcpToken) when the D1 insert drops (never a dead credential).
 * @example
 * POST /api/sites/abc/mcp/tokens { "label": "CI" } → { id, token: "ps_mcp_…" }
 */
siteMcpServer.post('/api/sites/:siteId/mcp/tokens', async (c) => {
  const { orgId, userId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = MintTokenBody.parse(await c.req.json().catch(() => ({})));
  const label = body.label ?? 'Default';
  const { id, token } = await mintSiteMcpToken(c.env.DB, siteId, userId, label);
  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'mcp.token_minted',
      message: `MCP token '${label}' minted for site '${siteId}'`,
      target_type: 'site_mcp_token',
      target_id: id,
      metadata_json: { site_id: siteId, label },
      request_id: c.get('requestId'),
    }),
  );
  return c.json({ id, token });
});

/**
 * `DELETE /api/sites/:siteId/mcp/tokens/:tokenId` — Revoke a token. Idempotent —
 * revoking an already-revoked / unknown id is a no-op (still 200). A dropped
 * revoke UPDATE throws inside {@link revokeSiteMcpToken} (a live-credential
 * security failure must never report success).
 *
 * @returns `{ ok: true }`.
 * @throws 401 when org/user context is missing; 404 when the site is missing/foreign.
 * @example
 * DELETE /api/sites/abc/mcp/tokens/tok_1 → { ok: true }
 */
siteMcpServer.delete('/api/sites/:siteId/mcp/tokens/:tokenId', async (c) => {
  const { orgId, userId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const tokenId = c.req.param('tokenId');
  await revokeSiteMcpToken(c.env.DB, tokenId, siteId);
  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'mcp.token_revoked',
      message: `MCP token '${tokenId}' revoked from site '${siteId}'`,
      target_type: 'site_mcp_token',
      target_id: tokenId,
      metadata_json: { site_id: siteId },
      request_id: c.get('requestId'),
    }),
  );
  return c.json({ ok: true });
});

/**
 * `GET /api/sites/:siteId/mcp/tools` — The canonical registry of tools the
 * site's MCP server exposes to external agents (static, code-defined).
 *
 * @returns `{ tools: SITE_MCP_TOOLS }` — `{ name, description, inputSchema }` each.
 * @throws 401 when org/user context is missing; 404 when the site is missing/foreign.
 * @example
 * GET /api/sites/abc/mcp/tools → { tools: [{ name: 'list_pages', … }, …] }
 */
siteMcpServer.get('/api/sites/:siteId/mcp/tools', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  return c.json({ tools: SITE_MCP_TOOLS });
});

/**
 * `GET /api/sites/:siteId/mcp/tool-usage` — Per-tool call/error counters over the
 * last 30 days, powering the admin usage chart + the "calls today" header pill.
 *
 * @returns `{ usage: Array<{ tool_name, day, call_count, error_count }> }` — honest
 *   `{ usage: [] }` when a site has no recorded calls yet.
 * @throws 401 when org/user context is missing; 404 when the site is missing/foreign.
 * @example
 * GET /api/sites/abc/mcp/tool-usage → { usage: [{ tool_name: 'list_pages', day: '2026-09-05', call_count: 3, error_count: 0 }] }
 */
siteMcpServer.get('/api/sites/:siteId/mcp/tool-usage', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT tool_name, day, call_count, error_count FROM site_mcp_tool_usage
      WHERE site_id = ? AND day >= date('now', '-30 days') ORDER BY day DESC`,
  )
    .bind(siteId)
    .all();
  return c.json({ usage: rows.results ?? [] });
});
