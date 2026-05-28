/**
 * @module public_api
 * @description Public REST API v1 — versioned at `/v1/*`.
 *
 * All endpoints are gated behind the `public_api_v1` feature flag.
 * When the flag is off, every endpoint returns 503 `{error:"feature_disabled"}`.
 *
 * Authentication: `Authorization: Bearer psk_<64-hex>` header.
 * Each endpoint declares the required scope. Missing scope → 403.
 *
 * ## Endpoints
 *
 * | Method | Path                              | Scope          |
 * |--------|-----------------------------------|----------------|
 * | GET    | /v1/me                            | me:read        |
 * | GET    | /v1/sites                         | sites:read     |
 * | GET    | /v1/sites/:id                     | sites:read     |
 * | POST   | /v1/sites                         | sites:write    |
 * | PATCH  | /v1/sites/:id                     | sites:write    |
 * | DELETE | /v1/sites/:id                     | sites:write    |
 * | GET    | /v1/sites/:id/snapshots           | sites:read     |
 * | POST   | /v1/sites/:id/deploy              | sites:write    |
 * | GET    | /v1/sites/:id/media               | media:read     |
 * | POST   | /v1/sites/:id/media               | media:write    |
 * | GET    | /v1/sites/:id/forms/submissions   | forms:read     |
 * | GET    | /v1/sites/:id/analytics?range=7d  | analytics:read |
 * | GET    | /v1/openapi.json                  | public         |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  extractBearerToken,
  verifyApiToken,
  hasScope,
  createApiToken,
  listApiTokens,
  revokeApiToken,
  VALID_SCOPES,
  type ApiScope,
  type ApiTokenRow,
} from '../services/api_tokens.js';

interface V1Vars {
  apiTokenRow: ApiTokenRow;
  v1OrgId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v1 = new Hono<{ Bindings: Env; Variables: any }>();

// ─── CORS for public API ────────────────────────────────────────────────────
v1.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    maxAge: 86400,
  }),
);

// ─── Feature flag gate ──────────────────────────────────────────────────────
v1.use('*', async (c, next) => {
  const flagOn = await isFlagOn(c.env, 'public_api_v1', {});
  if (!flagOn) {
    return c.json({ error: 'feature_disabled', message: 'Public API v1 is not yet enabled.' }, 503);
  }
  return next();
});

// ─── Auth middleware — skip only for openapi.json ──────────────────────────
v1.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/v1/openapi.json') return next();

  const authHeader = c.req.header('Authorization') ?? null;
  const plaintext = extractBearerToken(authHeader);
  if (!plaintext) {
    return c.json({ error: 'unauthorized', message: 'Bearer token required (Authorization: Bearer psk_...)' }, 401);
  }

  const tokenRow = await verifyApiToken(c.env.DB, plaintext);
  if (!tokenRow) {
    return c.json({ error: 'unauthorized', message: 'Invalid or expired API token.' }, 401);
  }

  c.set('apiTokenRow', tokenRow);
  c.set('v1OrgId', tokenRow.org_id);
  return next();
});

/** Require a specific scope — returns 403 if missing. */
function requireScope(scope: ApiScope) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next: () => Promise<void>) => {
    const row = c.get('apiTokenRow') as ApiTokenRow;
    if (!hasScope(row, scope)) {
      return c.json({ error: 'forbidden', message: `Token missing required scope: ${scope}` }, 403);
    }
    return next();
  };
}

// ─── OpenAPI 3.1 spec ────────────────────────────────────────────────────────
v1.get('/v1/openapi.json', (c) => {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Project Sites Public API',
      version: '1.0.0',
      description: 'REST API for managing sites, media, forms, and analytics on projectsites.dev.',
      contact: { email: 'hey@megabyte.space', url: 'https://projectsites.dev' },
    },
    servers: [{ url: 'https://projectsites.dev', description: 'Production' }],
    security: [{ BearerAuth: [] }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'psk_<64-hex>',
          description: 'Generate a token in your Project Sites admin dashboard at /admin/api-tokens.',
        },
      },
      schemas: {
        Site: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            business_name: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'collecting', 'generating', 'published', 'error', 'archived'] },
            current_build_version: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Snapshot: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            version: { type: 'string' },
            label: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        MediaAsset: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            kind: { type: 'string', enum: ['image', 'video', 'audio', 'document'] },
            filename: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            size_bytes: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            request_id: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/v1/me': {
        get: {
          operationId: 'getMe',
          summary: 'Get current token identity',
          tags: ['Auth'],
          responses: { '200': { description: 'Token org and scopes' } },
        },
      },
      '/v1/sites': {
        get: {
          operationId: 'listSites',
          summary: 'List sites',
          tags: ['Sites'],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { '200': { description: 'Array of sites' } },
        },
        post: {
          operationId: 'createSite',
          summary: 'Create a site',
          tags: ['Sites'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['slug', 'business_name'], properties: { slug: { type: 'string' }, business_name: { type: 'string' } } } } } },
          responses: { '201': { description: 'Site created' } },
        },
      },
      '/v1/sites/{id}': {
        get: { operationId: 'getSite', summary: 'Get a site', tags: ['Sites'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Site object' } } },
        patch: { operationId: 'updateSite', summary: 'Update a site', tags: ['Sites'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'Updated site' } } },
        delete: { operationId: 'deleteSite', summary: 'Delete a site', tags: ['Sites'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Deleted' } } },
      },
      '/v1/sites/{id}/snapshots': {
        get: { operationId: 'listSnapshots', summary: 'List snapshots', tags: ['Sites'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Array of snapshots' } } },
      },
      '/v1/sites/{id}/deploy': {
        post: { operationId: 'deploySite', summary: 'Trigger deploy', tags: ['Sites'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deploy triggered' } } },
      },
      '/v1/sites/{id}/media': {
        get: { operationId: 'listSiteMedia', summary: 'List media', tags: ['Media'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Array of media assets' } } },
        post: { operationId: 'uploadSiteMedia', summary: 'Upload media', tags: ['Media'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } }, responses: { '201': { description: 'Media uploaded' } } },
      },
      '/v1/sites/{id}/forms/submissions': {
        get: { operationId: 'listFormSubmissions', summary: 'List form submissions', tags: ['Forms'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Array of form submissions' } } },
      },
      '/v1/sites/{id}/analytics': {
        get: { operationId: 'getSiteAnalytics', summary: 'Get analytics', tags: ['Analytics'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'range', in: 'query', schema: { type: 'string', enum: ['1d', '7d', '30d', '90d'], default: '7d' } }], responses: { '200': { description: 'Analytics data' } } },
      },
    },
  };

  return c.json(spec, 200, { 'Cache-Control': 'public, max-age=3600' });
});

// ─── GET /v1/me ─────────────────────────────────────────────────────────────
v1.get('/v1/me', requireScope('me:read'), async (c) => {
  const row = c.get('apiTokenRow');
  const org = await c.env.DB.prepare(`SELECT id, name, created_at FROM orgs WHERE id = ? LIMIT 1`).bind(row.org_id).first<{ id: string; name: string; created_at: string }>().catch(() => null);

  const scopes: ApiScope[] = (() => {
    try { return JSON.parse(row.scopes) as ApiScope[]; } catch { return []; }
  })();

  return c.json({
    token_id: row.id,
    token_name: row.name,
    org: org ? { id: org.id, name: org.name } : { id: row.org_id, name: null },
    scopes,
    expires_at: row.expires_at ?? null,
  });
});

// ─── Sites ───────────────────────────────────────────────────────────────────

v1.get('/v1/sites', requireScope('sites:read'), async (c) => {
  const orgId = c.get('v1OrgId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const rows = await c.env.DB.prepare(
    `SELECT id, slug, business_name, status, current_build_version, created_at, updated_at
     FROM sites WHERE org_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(orgId, limit, offset).all().catch(() => ({ results: [] }));

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM sites WHERE org_id = ? AND deleted_at IS NULL`).bind(orgId).first<{ n: number }>().catch(() => ({ n: 0 }));

  return c.json({ data: rows.results ?? [], total: total?.n ?? 0, limit, offset });
});

v1.get('/v1/sites/:id', requireScope('sites:read'), async (c) => {
  const orgId = c.get('v1OrgId');
  const site = await c.env.DB.prepare(
    `SELECT id, slug, business_name, status, current_build_version, created_at, updated_at
     FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL LIMIT 1`,
  ).bind(c.req.param('id'), orgId).first().catch(() => null);

  if (!site) return c.json({ error: 'not_found', message: 'Site not found' }, 404);
  return c.json(site);
});

v1.post('/v1/sites', requireScope('sites:write'), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const orgId = c.get('v1OrgId');
  const { slug, business_name } = body as { slug?: string; business_name?: string };

  if (!slug || !business_name) {
    return c.json({ error: 'bad_request', message: '`slug` and `business_name` are required.' }, 400);
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM sites WHERE slug = ? AND deleted_at IS NULL LIMIT 1`).bind(slug).first().catch(() => null);
  if (existing) return c.json({ error: 'conflict', message: `Slug "${slug}" is already taken.` }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO sites (id, org_id, slug, business_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
  ).bind(id, orgId, slug, business_name, now, now).run();

  const site = { id, org_id: orgId, slug, business_name, status: 'draft', created_at: now };
  return c.json(site, 201);
});

v1.patch('/v1/sites/:id', requireScope('sites:write'), async (c) => {
  const orgId = c.get('v1OrgId');
  const siteId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const site = await c.env.DB.prepare(`SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL LIMIT 1`).bind(siteId, orgId).first().catch(() => null);
  if (!site) return c.json({ error: 'not_found', message: 'Site not found' }, 404);

  const allowed = ['business_name', 'slug'] as const;
  const updates: Record<string, string> = {};
  for (const k of allowed) {
    if (k in (body as object) && typeof (body as Record<string, unknown>)[k] === 'string') {
      updates[k] = (body as Record<string, string>)[k];
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'bad_request', message: 'No updatable fields provided.' }, 400);
  }

  const now = new Date().toISOString();
  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE sites SET ${setClauses}, updated_at = ? WHERE id = ?`).bind(...Object.values(updates), now, siteId).run();

  const updated = await c.env.DB.prepare(`SELECT id, slug, business_name, status, current_build_version, created_at, updated_at FROM sites WHERE id = ? LIMIT 1`).bind(siteId).first().catch(() => null);
  return c.json(updated);
});

v1.delete('/v1/sites/:id', requireScope('sites:write'), async (c) => {
  const orgId = c.get('v1OrgId');
  const siteId = c.req.param('id');
  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `UPDATE sites SET deleted_at = ?, updated_at = ? WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  ).bind(now, now, siteId, orgId).run().catch(() => null);

  if (!result?.meta?.changes) return c.json({ error: 'not_found', message: 'Site not found' }, 404);
  return new Response(null, { status: 204 });
});

// ─── Snapshots ───────────────────────────────────────────────────────────────

v1.get('/v1/sites/:id/snapshots', requireScope('sites:read'), async (c) => {
  const orgId = c.get('v1OrgId');
  const siteId = c.req.param('id');

  const site = await c.env.DB.prepare(`SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL LIMIT 1`).bind(siteId, orgId).first().catch(() => null);
  if (!site) return c.json({ error: 'not_found', message: 'Site not found' }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT id, site_id, version, label, created_at FROM site_snapshots WHERE site_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`,
  ).bind(siteId).all().catch(() => ({ results: [] }));

  return c.json({ data: rows.results ?? [] });
});

// ─── Deploy ──────────────────────────────────────────────────────────────────

v1.post('/v1/sites/:id/deploy', requireScope('sites:write'), async (c) => {
  const orgId = c.get('v1OrgId');
  const siteId = c.req.param('id');

  const site = await c.env.DB.prepare(
    `SELECT id, slug, status FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL LIMIT 1`,
  ).bind(siteId, orgId).first<{ id: string; slug: string; status: string }>().catch(() => null);
  if (!site) return c.json({ error: 'not_found', message: 'Site not found' }, 404);

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO workflow_jobs (id, site_id, type, status, created_at, updated_at) VALUES (?, ?, 'deploy', 'queued', ?, ?)`,
  ).bind(jobId, siteId, now, now).run().catch(() => {});

  return c.json({ job_id: jobId, site_id: siteId, status: 'queued', message: 'Deploy queued.' });
});

// ─── Media ───────────────────────────────────────────────────────────────────

v1.get('/v1/sites/:id/media', requireScope('media:read'), async (c) => {
  const orgId = c.get('v1OrgId');
  const siteId = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const site = await c.env.DB.prepare(`SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL LIMIT 1`).bind(siteId, orgId).first().catch(() => null);
  if (!site) return c.json({ error: 'not_found', message: 'Site not found' }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT id, kind, filename, r2_key, size_bytes, created_at FROM media_assets
     WHERE org_id = ? AND site_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(orgId, siteId, limit, offset).all().catch(() => ({ results: [] }));

  return c.json({ data: rows.results ?? [], limit, offset });
});

v1.post('/v1/sites/:id/media', requireScope('media:write'), async (c) => {
  const orgId = c.get('v1OrgId');
  const siteId = c.req.param('id');

  const site = await c.env.DB.prepare(`SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL LIMIT 1`).bind(siteId, orgId).first().catch(() => null);
  if (!site) return c.json({ error: 'not_found', message: 'Site not found' }, 404);

  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: 'bad_request', message: 'multipart/form-data required.' }, 400);

  const fileEntry = formData.get('file');
  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json({ error: 'bad_request', message: 'file field required in form data.' }, 400);
  }
  const file = fileEntry as File;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const filename = file.name ?? `upload-${id}`;
  const r2Key = `media/${orgId}/${id}/${filename}`;

  const arrayBuf = await file.arrayBuffer();
  await c.env.SITES_BUCKET.put(r2Key, arrayBuf, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  await c.env.DB.prepare(
    `INSERT INTO media_assets (id, org_id, site_id, kind, filename, r2_key, size_bytes, source, created_at, updated_at)
     VALUES (?, ?, ?, 'image', ?, ?, ?, 'upload', ?, ?)`,
  ).bind(id, orgId, siteId, filename, r2Key, arrayBuf.byteLength, now, now).run().catch(() => {});

  return c.json({ id, site_id: siteId, filename, size_bytes: arrayBuf.byteLength, created_at: now }, 201);
});

// ─── Form submissions ────────────────────────────────────────────────────────

v1.get('/v1/sites/:id/forms/submissions', requireScope('forms:read'), async (c) => {
  const orgId = c.get('v1OrgId');
  const siteId = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const site = await c.env.DB.prepare(`SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL LIMIT 1`).bind(siteId, orgId).first().catch(() => null);
  if (!site) return c.json({ error: 'not_found', message: 'Site not found' }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT id, form_slug, data, submitted_at FROM form_submissions
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY submitted_at DESC LIMIT ? OFFSET ?`,
  ).bind(siteId, limit, offset).all().catch(() => ({ results: [] }));

  const parsed = (rows.results ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    data: (() => { try { return JSON.parse(r.data as string); } catch { return r.data; } })(),
  }));

  return c.json({ data: parsed, limit, offset });
});

// ─── Analytics ───────────────────────────────────────────────────────────────

v1.get('/v1/sites/:id/analytics', requireScope('analytics:read'), async (c) => {
  const orgId = c.get('v1OrgId');
  const siteId = c.req.param('id');
  const range = c.req.query('range') ?? '7d';
  const days = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 }[range] ?? 7;

  const site = await c.env.DB.prepare(`SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL LIMIT 1`).bind(siteId, orgId).first().catch(() => null);
  if (!site) return c.json({ error: 'not_found', message: 'Site not found' }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT date, pageviews, unique_visitors, avg_duration_seconds
     FROM analytics_daily WHERE site_id = ? AND date >= date('now', ? || ' days')
     ORDER BY date ASC`,
  ).bind(siteId, `-${days}`).all().catch(() => ({ results: [] }));

  const totals = await c.env.DB.prepare(
    `SELECT SUM(pageviews) as total_pageviews, SUM(unique_visitors) as total_visitors
     FROM analytics_daily WHERE site_id = ? AND date >= date('now', ? || ' days')`,
  ).bind(siteId, `-${days}`).first<{ total_pageviews: number; total_visitors: number }>().catch(() => null);

  return c.json({
    site_id: siteId,
    range,
    total_pageviews: totals?.total_pageviews ?? 0,
    total_visitors: totals?.total_visitors ?? 0,
    daily: rows.results ?? [],
  });
});

// ─── Token management (admin only — uses session auth, not API token auth) ──
// These routes are under /api/v1-tokens/* not /v1/* so they're outside the
// API-token auth middleware above and use the standard session middleware.
const tokenMgmt = new Hono<{ Bindings: Env }>();

tokenMgmt.get('/api/v1-tokens', async (c) => {
  const orgId = c.req.header('x-org-id') ?? '';
  if (!orgId) return c.json({ error: 'unauthorized' }, 401);
  const tokens = await listApiTokens(c.env.DB, orgId);
  return c.json({ data: tokens });
});

tokenMgmt.post('/api/v1-tokens', async (c) => {
  const orgId = c.req.header('x-org-id') ?? '';
  if (!orgId) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => ({})) as { name?: string; scopes?: string[]; expires_at?: string };
  if (!body.name) return c.json({ error: 'bad_request', message: '`name` is required.' }, 400);

  const scopeList = (body.scopes ?? ['sites:read']) as ApiScope[];
  const invalid = scopeList.filter((s) => !VALID_SCOPES.includes(s));
  if (invalid.length) {
    return c.json({ error: 'bad_request', message: `Invalid scopes: ${invalid.join(', ')}. Valid: ${VALID_SCOPES.join(', ')}` }, 400);
  }

  const result = await createApiToken(c.env.DB, orgId, body.name, scopeList, null, body.expires_at ?? null);
  return c.json({ token: result.token, plaintext: result.plaintext, warning: 'Store this token now — it will not be shown again.' }, 201);
});

tokenMgmt.delete('/api/v1-tokens/:id', async (c) => {
  const orgId = c.req.header('x-org-id') ?? '';
  if (!orgId) return c.json({ error: 'unauthorized' }, 401);

  const revoked = await revokeApiToken(c.env.DB, orgId, c.req.param('id'));
  if (!revoked) return c.json({ error: 'not_found' }, 404);
  return new Response(null, { status: 204 });
});

// Export public API sub-app (mounted at / in index.ts)
export const publicApiV1 = new Hono<{ Bindings: Env }>();
publicApiV1.route('/', v1);
publicApiV1.route('/', tokenMgmt);
