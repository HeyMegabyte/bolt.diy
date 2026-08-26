/**
 * @module libs/features/site_data_api/handlers
 *
 * @description
 * Hono routes for **per-site D1 data tables** — a generic key→JSON row store
 * (`site_data`) that generated websites poll to stay in sync, plus the
 * authenticated admin CRUD behind it. One public read endpoint (resolves the
 * site from the request `host`) and four org-scoped admin endpoints (list
 * tables, read/upsert/delete rows). Table names are whitelisted
 * (`ALLOWED_PUBLIC_TABLES`) to prevent data leaks; every admin route guards
 * ownership through {@link ownsSiteData} (404, never 403, on a foreign/missing
 * site so cross-org `site_data` never leaks via a passed `:siteId`).
 *
 * | Method | Path                                       | Auth   | Purpose                                          |
 * | ------ | ------------------------------------------ | ------ | ------------------------------------------------ |
 * | GET    | /api/public-data/:table                     | public | Live read for a generated site (host-resolved)   |
 * | GET    | /api/sites/:siteId/data/:table              | orgId  | Admin read of one table's rows                   |
 * | PUT    | /api/sites/:siteId/data/:table/:rowId       | orgId  | Admin upsert of one row                          |
 * | DELETE | /api/sites/:siteId/data/:table/:rowId       | orgId  | Admin soft-delete of one row                     |
 * | GET    | /api/sites/:siteId/data                      | orgId  | Admin list of a site's tables + row counts       |
 *
 * Extracted VERBATIM from the `search.ts` monolith (route-decomposition
 * installment 21) — only the route-registration receiver changed (`search.` →
 * `siteDataApi.`) and the `/api/public-data/:table` handler's dynamic
 * `import('../services/site_serving.js')` was re-pathed to
 * `../../../src/services/site_serving.js` for the new module depth. The
 * `ALLOWED_PUBLIC_TABLES` whitelist and the `ownsSiteData` IDOR guard moved with
 * the routes (both were exclusive to this group). Routes return explicit JSON
 * with inline status codes (no `onError`) and bubble unexpected throws to the
 * app-level error handler exactly as before, so behavior is byte-identical.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const siteDataApi = new Hono<AppContext>();

// ── Public Site Data API (read-only, for live polling from generated sites) ──

/**
 * Public read-only endpoint for per-site D1 data tables. Generated websites poll
 * this to stay in sync when clients edit data. Tables are whitelisted below to
 * prevent data leaks.
 */
const ALLOWED_PUBLIC_TABLES = new Set([
  'services',
  'team_members',
  'business_hours',
  'faq',
  'menu_items',
  'gallery',
  'social_links',
  'specials',
  'products',
  'classes',
  'listings',
  'amenities',
  'reviews',
  'brand_config',
  'policies',
]);

siteDataApi.get('/api/public-data/:table', async (c) => {
  const table = c.req.param('table');
  if (!ALLOWED_PUBLIC_TABLES.has(table)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Unknown table' } }, 400);
  }

  // Resolve site from hostname (subdomain or custom domain).
  const hostname = c.req.header('host') || '';
  const { resolveSite } = await import('../../../src/services/site_serving.js');
  const site = await resolveSite(c.env, c.env.DB, hostname);
  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  try {
    const result = await c.env.DB.prepare(
      `SELECT * FROM site_data WHERE site_id = ? AND table_name = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
    )
      .bind(site.site_id, table)
      .all();

    const rows = (result.results || []).map((row: Record<string, unknown>) => {
      try {
        return { id: row['id'], ...JSON.parse((row['data_json'] as string | undefined) ?? '{}') };
      } catch {
        return { id: row['id'] };
      }
    });

    return c.json({ data: rows }, 200, {
      'Cache-Control': 'public, max-age=10, stale-while-revalidate=30',
      'Access-Control-Allow-Origin': '*',
    });
  } catch {
    return c.json({ data: [] }, 200, {
      'Cache-Control': 'public, max-age=10',
      'Access-Control-Allow-Origin': '*',
    });
  }
});

/**
 * IDOR guard for the `/api/sites/:siteId/data/*` family: every handler scopes its
 * query by the `:siteId` PATH param alone, so without verifying that site belongs to
 * the caller's org a user could read/write/delete ANOTHER org's `site_data` by passing
 * a foreign siteId (orgId was only used for the 401 auth check). Returns false → 404.
 */
async function ownsSiteData(db: D1Database, siteId: string, orgId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL')
    .bind(siteId, orgId)
    .first();
  return !!row;
}

/** Authenticated endpoint for admin to read/write site data. */
siteDataApi.get('/api/sites/:siteId/data/:table', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } }, 401);
  const { siteId, table } = c.req.param();
  if (!(await ownsSiteData(c.env.DB, siteId, orgId)))
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  if (!ALLOWED_PUBLIC_TABLES.has(table)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Unknown table' } }, 400);
  }

  const result = await c.env.DB.prepare(
    `SELECT * FROM site_data WHERE site_id = ? AND table_name = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
  )
    .bind(siteId, table)
    .all();

  const rows = (result.results || []).map((row: Record<string, unknown>) => {
    try {
      return {
        id: row['id'],
        sort_order: row['sort_order'],
        ...JSON.parse((row['data_json'] as string | undefined) ?? '{}'),
      };
    } catch {
      return { id: row['id'], sort_order: row['sort_order'] };
    }
  });

  return c.json({ data: rows });
});

/** Upsert a row in a site data table. */
siteDataApi.put('/api/sites/:siteId/data/:table/:rowId', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } }, 401);
  const { siteId, table, rowId } = c.req.param();
  if (!(await ownsSiteData(c.env.DB, siteId, orgId)))
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  if (!ALLOWED_PUBLIC_TABLES.has(table)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Unknown table' } }, 400);
  }

  // `.catch(() => null)` + object-guard: a malformed or non-object body must
  // never silently clobber the row's `data_json` with garbage (a bare string
  // or `{}` recovered from a parse failure). Reject with a 400 BEFORE the write;
  // a well-formed object (incl. an intentional empty `{}` clear) still writes.
  const body = (await c.req.json().catch(() => null)) as {
    data?: unknown;
    sort_order?: number;
  } | null;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON object body' } }, 400);
  }
  const dataJson = JSON.stringify(body.data ?? body);

  await c.env.DB.prepare(
    `INSERT INTO site_data (id, site_id, table_name, data_json, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET data_json = ?, sort_order = ?, updated_at = datetime('now')`,
  )
    .bind(rowId, siteId, table, dataJson, body.sort_order ?? 0, dataJson, body.sort_order ?? 0)
    .run();

  return c.json({ data: { id: rowId, updated: true } });
});

/** Delete a row from a site data table. */
siteDataApi.delete('/api/sites/:siteId/data/:table/:rowId', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } }, 401);
  const { siteId, table, rowId } = c.req.param();
  if (!(await ownsSiteData(c.env.DB, siteId, orgId)))
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);

  await c.env.DB.prepare(
    `UPDATE site_data SET deleted_at = datetime('now') WHERE id = ? AND site_id = ? AND table_name = ?`,
  )
    .bind(rowId, siteId, table)
    .run();

  return c.json({ data: { id: rowId, deleted: true } });
});

/** List all tables for a site (for admin data grid). */
siteDataApi.get('/api/sites/:siteId/data', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Must be authenticated' } }, 401);
  const siteId = c.req.param('siteId');
  if (!(await ownsSiteData(c.env.DB, siteId, orgId)))
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);

  const result = await c.env.DB.prepare(
    `SELECT DISTINCT table_name, COUNT(*) as row_count FROM site_data WHERE site_id = ? AND deleted_at IS NULL GROUP BY table_name ORDER BY table_name`,
  )
    .bind(siteId)
    .all();

  return c.json({ data: result.results || [] });
});
