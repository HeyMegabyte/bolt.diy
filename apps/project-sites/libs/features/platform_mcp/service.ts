/**
 * @module libs/features/platform_mcp/service
 * @description Business logic for the platform MCP server — the tool catalog and
 * the dispatcher. Tools are scoped to ONE org (the authenticated API token's
 * org) so a Claude-Code/Cursor/any-MCP-client user only ever sees + acts on
 * their own sites. Auth is enforced in handlers.ts (verifyApiToken → orgId);
 * this layer trusts the orgId it is handed and scope-gates each tool.
 *
 * @remarks v1 ships the READ tools (genuinely useful + safe for an external
 * agent): whoami, list_sites, get_site, get_build_status. The WRITE tools
 * (deploy_site, create_site) are specified in README.md + ROADMAP and wired in
 * the next slice — advertised there, NOT here, so we never return a fake
 * success from an unwired tool.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import type { ApiTokenRow } from '../../../src/services/api_tokens.js';
import { hasScope } from '../../../src/services/api_tokens.js';
import { ListSitesInput, GetSiteInput, BuildStatusInput } from './schemas.js';

/** Flag key gating the whole platform MCP surface. */
export const FLAG_KEY = 'platform_mcp';

/** MCP content-block result (text). */
interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const err = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/**
 * The advertised tool catalog (`tools/list`). Only IMPLEMENTED tools are listed
 * so an agent never calls a tool that can't run. `requiredScope` is checked in
 * dispatch before the handler runs.
 */
export const PLATFORM_MCP_TOOLS = [
  {
    name: 'whoami',
    description:
      'Return the org + token identity (scopes) the connected API key resolves to. Use first to confirm the connection.',
    requiredScope: 'sites:read' as const,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_sites',
    description: 'List the websites in your projectsites.dev account (id, slug, name, status, hostname).',
    requiredScope: 'sites:read' as const,
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', minimum: 1, maximum: 100, default: 50 } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_site',
    description: 'Get one site by id: status, primary hostname, plan, last build.',
    requiredScope: 'sites:read' as const,
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string' } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_build_status',
    description: 'Get the AI build/workflow status + step for a site (poll while a generation runs).',
    requiredScope: 'sites:read' as const,
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string' } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_audit_log',
    description: 'Recent audit-log actions for a site (deploys, edits, config changes) — inspect what happened.',
    requiredScope: 'sites:read' as const,
    inputSchema: {
      type: 'object',
      properties: { site_id: { type: 'string' }, limit: { type: 'number', minimum: 1, maximum: 50, default: 20 } },
      required: ['site_id'],
      additionalProperties: false,
    },
  },
] as const;

/**
 * Dispatch a `tools/call`. `token` is the verified API-token row (carries org_id
 * + scopes). Validates args with Zod, scope-gates, runs the org-scoped query.
 *
 * @throws never — all failures become an `isError` ToolResult so JSON-RPC stays 200.
 */
export async function dispatchPlatformTool(
  db: D1Database,
  token: ApiTokenRow,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = PLATFORM_MCP_TOOLS.find((t) => t.name === name);
  if (!tool) return err(`Unknown tool: ${name}. Call tools/list for the catalog.`);
  if (!hasScope(token, tool.requiredScope)) {
    return err(`This API token lacks the '${tool.requiredScope}' scope required by '${name}'.`);
  }
  const orgId = token.org_id;

  switch (name) {
    case 'whoami':
      return ok({
        org_id: orgId,
        token_name: token.name,
        scopes: JSON.parse(token.scopes ?? '[]'),
        server: 'projectsites.dev platform MCP',
      });

    case 'list_sites': {
      const { limit } = ListSitesInput.parse(args);
      const { data } = await dbQuery<{
        id: string;
        slug: string;
        business_name: string | null;
        status: string;
        primary_hostname: string | null;
      }>(
        db,
        `SELECT id, slug, business_name, status, primary_hostname
           FROM sites WHERE org_id = ? AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT ?`,
        [orgId, limit],
      );
      return ok({ count: data.length, sites: data });
    }

    case 'get_site': {
      const { site_id } = GetSiteInput.parse(args);
      const row = await dbQueryOne<{
        id: string;
        slug: string;
        business_name: string | null;
        status: string;
        plan: string | null;
        primary_hostname: string | null;
        updated_at: string;
      }>(
        db,
        `SELECT id, slug, business_name, status, plan, primary_hostname, updated_at
           FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
        [site_id, orgId],
      );
      // 404-on-missing-or-foreign (never leak another org's site existence).
      return row ? ok(row) : err('Site not found.');
    }

    case 'get_build_status': {
      const { site_id } = BuildStatusInput.parse(args);
      const owned = await dbQueryOne<{ id: string; status: string }>(
        db,
        `SELECT id, status FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
        [site_id, orgId],
      );
      if (!owned) return err('Site not found.');
      const job = await dbQueryOne<{ status: string; step: string | null; updated_at: string }>(
        db,
        `SELECT status, step, updated_at FROM workflow_jobs
           WHERE site_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [site_id],
      );
      return ok({ site_id, site_status: owned.status, build: job ?? { status: 'none' } });
    }

    case 'get_audit_log': {
      const site_id = String(args.site_id ?? '');
      if (!site_id) return err('site_id is required.');
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
      const owned = await dbQueryOne<{ id: string }>(
        db,
        `SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
        [site_id, orgId],
      );
      if (!owned) return err('Site not found.');
      const { data } = await dbQuery<{ action: string; created_at: string }>(
        db,
        `SELECT action, created_at FROM audit_logs
           WHERE org_id = ? AND site_id = ? ORDER BY created_at DESC LIMIT ?`,
        [orgId, site_id, limit],
      );
      return ok({ site_id, count: data.length, entries: data });
    }

    default:
      return err(`Tool '${name}' is advertised but not yet wired.`);
  }
}
