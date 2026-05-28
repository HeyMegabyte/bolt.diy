/**
 * @module routes/pseo
 * @description pSEO Matrix Builder API routes — feature #17.
 *
 * Routes:
 *   GET  /api/pseo/:siteId                  — matrix stats + rows (paginated)
 *   POST /api/pseo/:siteId/generate         — queue workflow to build matrix
 *   GET  /api/pseo/:siteId/pages            — list pseo_pages rows
 *   GET  /api/pseo/:siteId/pages/:pageId    — single page detail
 *   POST /api/pseo/:siteId/pages/:pageId/approve  — mark approved
 *   POST /api/pseo/:siteId/pages/:pageId/publish  — publish HTML to R2
 *   POST /api/pseo/:siteId/pages/:pageId/reject   — reject page
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import { getPseoMatrixStats } from '../services/pseo_matrix.js';

const pseo = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Matrix stats ─────────────────────────────────────────────────────

pseo.get('/:siteId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();
  const stats = await getPseoMatrixStats(c.env, siteId);
  return c.json({ siteId, stats });
});

// ─── Trigger workflow ─────────────────────────────────────────────────

pseo.post('/:siteId/generate', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();
  const orgId = c.get('orgId');

  // Verify site belongs to org
  const site = await dbQueryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId ?? ''],
  );
  if (!site) return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);

  // Start Workflow
  const workflow = c.env.PSEO_GENERATION_WORKFLOW;
  if (!workflow) {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'pSEO workflow binding not available' } }, 503);
  }

  try {
    const instance = await (workflow as { create: (params: unknown) => Promise<{ id: string }> }).create({
      params: { siteId, orgId: orgId ?? '' },
    });
    return c.json({ ok: true, workflowInstanceId: instance.id });
  } catch (err) {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: String(err) } }, 500);
  }
});

// ─── List pages ───────────────────────────────────────────────────────

pseo.get('/:siteId/pages', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();
  const status = c.req.query('status');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  const whereClause = status
    ? 'WHERE site_id = ? AND status = ? AND deleted_at IS NULL'
    : 'WHERE site_id = ? AND deleted_at IS NULL';
  const params = status ? [siteId, status, limit, offset] : [siteId, limit, offset];
  const countParams = status ? [siteId, status] : [siteId];

  const { data } = await dbQuery<{
    id: string;
    service: string;
    city: string;
    intent: string;
    season: string;
    route_slug: string;
    word_count: number | null;
    image_count: number | null;
    internal_links: number | null;
    has_local_biz_jsonld: number;
    slop_hits: number;
    thin_content: number;
    status: string;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, service, city, intent, season, route_slug,
            word_count, image_count, internal_links, has_local_biz_jsonld,
            slop_hits, thin_content, status, created_at
     FROM pseo_pages ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  const countRow = await dbQueryOne<{ cnt: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS cnt FROM pseo_pages ${whereClause}`,
    countParams,
  );

  return c.json({ pages: data, total: countRow?.cnt ?? 0, page, limit });
});

// ─── Single page ──────────────────────────────────────────────────────

pseo.get('/:siteId/pages/:pageId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId, pageId } = c.req.param();

  const row = await dbQueryOne<{
    id: string;
    service: string;
    city: string;
    intent: string;
    season: string;
    route_slug: string;
    html_content: string | null;
    word_count: number | null;
    image_count: number | null;
    internal_links: number | null;
    has_local_biz_jsonld: number;
    slop_hits: number;
    thin_content: number;
    status: string;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, service, city, intent, season, route_slug,
            html_content, word_count, image_count, internal_links,
            has_local_biz_jsonld, slop_hits, thin_content, status, created_at
     FROM pseo_pages
     WHERE id = ? AND site_id = ? AND deleted_at IS NULL`,
    [pageId, siteId],
  );

  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found' } }, 404);

  return c.json({ page: row });
});

// ─── Approve ──────────────────────────────────────────────────────────

pseo.post('/:siteId/pages/:pageId/approve', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { pageId } = c.req.param();

  await dbUpdate(c.env.DB, 'pseo_pages', { status: 'approved' }, 'id = ?', [pageId]);

  return c.json({ ok: true, pageId, status: 'approved' });
});

// ─── Publish to R2 ────────────────────────────────────────────────────

pseo.post('/:siteId/pages/:pageId/publish', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId, pageId } = c.req.param();

  const row = await dbQueryOne<{
    id: string;
    html_content: string | null;
    route_slug: string;
    status: string;
  }>(
    c.env.DB,
    'SELECT id, html_content, route_slug, status FROM pseo_pages WHERE id = ? AND site_id = ? AND deleted_at IS NULL',
    [pageId, siteId],
  );

  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found' } }, 404);
  if (!row.html_content) return c.json({ error: { code: 'BAD_REQUEST', message: 'No content generated yet' } }, 400);

  const site = await dbQueryOne<{ slug: string }>(
    c.env.DB,
    'SELECT slug FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  if (!site) return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);

  // Wrap in minimal HTML shell
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${row.route_slug}</title>
</head>
<body>
${row.html_content}
</body>
</html>`;

  const r2Key = `sites/${site.slug}/latest${row.route_slug}/index.html`;
  await c.env.SITES_BUCKET.put(r2Key, fullHtml, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  const now = new Date().toISOString();
  await dbUpdate(
    c.env.DB,
    'pseo_pages',
    { status: 'published', published_at: now, r2_path: r2Key },
    'id = ?',
    [pageId],
  );

  return c.json({ ok: true, pageId, r2Key });
});

// ─── Reject ───────────────────────────────────────────────────────────

pseo.post('/:siteId/pages/:pageId/reject', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { pageId } = c.req.param();

  await dbUpdate(c.env.DB, 'pseo_pages', { status: 'rejected' }, 'id = ?', [pageId]);

  return c.json({ ok: true, pageId, status: 'rejected' });
});

export { pseo as pseoRoutes };
