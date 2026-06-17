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
import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbQueryOne, dbExecute, dbInsert } from '../../../src/services/db.js';
import type { ApiTokenRow } from '../../../src/services/api_tokens.js';
import { hasScope } from '../../../src/services/api_tokens.js';
import { ListSitesInput, GetSiteInput, BuildStatusInput } from './schemas.js';

/** Mirrors DOMAINS.SITES_SUFFIX — the public site subdomain suffix. */
const SITES_SUFFIX = '.projectsites.dev';

/** Content-type by extension (mirrors the /api/publish/bolt handler). */
const MIME: Record<string, string> = {
  html: 'text/html', css: 'text/css', js: 'application/javascript', mjs: 'application/javascript',
  json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', ico: 'image/x-icon', webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', xml: 'application/xml', txt: 'text/plain', webmanifest: 'application/manifest+json',
};

/**
 * Publish a set of files to a site: write each to R2 under
 * `sites/{slug}/{version}/`, update `_manifest.json` so serving points at the new
 * version, bust the KV host cache. Mirrors the proven `/api/publish/bolt` path
 * (kept colocated so deploy_site reuses it without touching the hot route).
 */
async function publishSiteFiles(
  env: Env,
  slug: string,
  files: Array<{ path: string; content: string }>,
): Promise<{ url: string; version: string; files: number }> {
  const version = new Date().toISOString().replace(/[:.]/g, '-');
  const puts: Promise<unknown>[] = files.map((f) => {
    const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
    return env.SITES_BUCKET.put(`sites/${slug}/${version}/${f.path}`, f.content, {
      httpMetadata: { contentType: MIME[ext] ?? 'application/octet-stream' },
    });
  });
  puts.push(
    env.SITES_BUCKET.put(
      `sites/${slug}/_manifest.json`,
      JSON.stringify({ current_version: version, slug, updated_at: new Date().toISOString(), source: 'platform_mcp' }),
      { httpMetadata: { contentType: 'application/json' } },
    ),
  );
  await Promise.all(puts);
  await env.CACHE_KV.delete(`host:${slug}${SITES_SUFFIX}`);
  return { url: `https://${slug}${SITES_SUFFIX}`, version, files: files.length };
}

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
  {
    name: 'deploy_site',
    description:
      'Deploy files to one of your sites from your editor: writes them to R2, points the site at the new version, busts cache, returns the live URL. files = [{path, content}] (the built dist of your app).',
    requiredScope: 'sites:write' as const,
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
        files: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
      required: ['site_id', 'files'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_site',
    description:
      'Create a new empty site in your account (draft). Returns site_id + slug + URL; then deploy_site with your built files to publish.',
    requiredScope: 'sites:write' as const,
    inputSchema: {
      type: 'object',
      properties: { business_name: { type: 'string' }, slug: { type: 'string' } },
      required: ['business_name'],
      additionalProperties: false,
    },
  },
] as const;

/** Slugify a name the same way the create-from-search handler does. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 63);
}

/**
 * Dispatch a `tools/call`. `token` is the verified API-token row (carries org_id
 * + scopes). Validates args with Zod, scope-gates, runs the org-scoped query.
 *
 * @throws never — all failures become an `isError` ToolResult so JSON-RPC stays 200.
 */
export async function dispatchPlatformTool(
  env: Env,
  token: ApiTokenRow,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const db = env.DB;
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

    case 'deploy_site': {
      const site_id = String(args.site_id ?? '');
      if (!site_id) return err('site_id is required.');
      const raw = Array.isArray(args.files) ? (args.files as Array<{ path?: unknown; content?: unknown }>) : [];
      const files = raw.filter(
        (f): f is { path: string; content: string } =>
          typeof f?.path === 'string' && f.path.length > 0 && typeof f?.content === 'string',
      );
      if (files.length === 0) return err('Provide at least one file as {path, content}.');
      const site = await dbQueryOne<{ id: string; slug: string }>(
        db,
        `SELECT id, slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
        [site_id, orgId],
      );
      if (!site) return err('Site not found.');
      const result = await publishSiteFiles(env, site.slug, files);
      await dbExecute(
        db,
        `UPDATE sites SET status = 'published', updated_at = datetime('now') WHERE id = ?`,
        [site_id],
      );
      return ok({ deployed: files.length, site_id, ...result });
    }

    case 'create_site': {
      const business_name = String(args.business_name ?? '').trim();
      if (!business_name) return err('business_name is required.');
      const base = slugify(typeof args.slug === 'string' && args.slug ? args.slug : business_name) || 'site';
      let slug = base;
      const taken = await dbQueryOne<{ id: string }>(
        db,
        `SELECT id FROM sites WHERE slug = ? AND deleted_at IS NULL`,
        [slug],
      );
      if (taken) slug = `${base.substring(0, 58)}-${crypto.randomUUID().slice(0, 4)}`;
      const id = crypto.randomUUID();
      const res = await dbInsert(db, 'sites', {
        id,
        org_id: orgId,
        slug,
        business_name,
        business_phone: null,
        business_email: null,
        business_address: null,
        google_place_id: null,
        bolt_chat_id: null,
        current_build_version: null,
        status: 'draft',
        lighthouse_score: null,
        lighthouse_last_run: null,
        deleted_at: null,
      });
      if (res.error) return err(`Failed to create site: ${res.error}`);
      return ok({
        site_id: id,
        slug,
        status: 'draft',
        url: `https://${slug}${SITES_SUFFIX}`,
        next: 'Use deploy_site with your built files to publish.',
      });
    }

    default:
      return err(`Tool '${name}' is advertised but not yet wired.`);
  }
}
