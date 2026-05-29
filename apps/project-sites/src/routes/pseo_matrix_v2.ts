/**
 * @module routes/pseo_matrix_v2
 * @description pSEO Matrix v2 API routes (feature #29).
 *
 * Mounted at `/api/sites/:id/pseo/v2`. All routes are flag-gated on
 * `pseo_matrix_v2` and return 404 (never 403) when the flag is off, per the
 * Feature Flags rule.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne } from '../services/db.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  PseoAxisSchema,
  PseoGenerateRequestSchema,
  PseoPublishRequestSchema,
} from '../../libs/features/pseo_matrix/feature.schemas.js';
import {
  generatePages,
  getMatrixStats,
  listAxes,
  publishPages,
  saveAxis,
} from '../services/pseo_matrix_v2.js';

const pseoV2 = new Hono<{ Bindings: Env; Variables: Variables }>();

async function guard(c: { env: Env }, _siteId: string): Promise<boolean> {
  return isFlagOn(c.env, 'pseo_matrix_v2');
}

// ─── Axes ────────────────────────────────────────────────────────────

pseoV2.get('/:id/pseo/v2/axes', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const siteId = c.req.param('id');
  if (!(await guard(c, siteId))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  const axes = await listAxes(c.env, siteId);
  return c.json({ siteId, axes });
});

pseoV2.post('/:id/pseo/v2/axes', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const siteId = c.req.param('id');
  const orgId = c.get('orgId') ?? '';
  if (!(await guard(c, siteId))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = PseoAxisSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid axis', details: parsed.error.issues } },
      400,
    );
  }
  await saveAxis(c.env, siteId, orgId, parsed.data);
  return c.json({ ok: true, axisName: parsed.data.axisName });
});

// ─── Generate ────────────────────────────────────────────────────────

pseoV2.post('/:id/pseo/v2/generate', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const siteId = c.req.param('id');
  const orgId = c.get('orgId') ?? '';
  if (!(await guard(c, siteId))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  const site = await dbQueryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = PseoGenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.issues } },
      400,
    );
  }
  const result = await generatePages(c.env, siteId, orgId, parsed.data);
  return c.json({ ok: true, ...result });
});

// ─── Pages list ──────────────────────────────────────────────────────

pseoV2.get('/:id/pseo/v2/pages', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const siteId = c.req.param('id');
  if (!(await guard(c, siteId))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  const status = c.req.query('status');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;
  const whereClause = status
    ? 'WHERE site_id = ? AND status = ? AND deleted_at IS NULL'
    : 'WHERE site_id = ? AND deleted_at IS NULL';
  const params = status ? [siteId, status, limit, offset] : [siteId, limit, offset];

  const { data } = await dbQuery<{
    id: string;
    slug: string;
    axis_combo_json: string;
    word_count: number | null;
    unique_data_pct: number;
    status: string;
    published_at: string | null;
  }>(
    c.env.DB,
    `SELECT id, slug, axis_combo_json, word_count, unique_data_pct, status, published_at
     FROM pseo_pages_v2 ${whereClause}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params,
  );
  const stats = await getMatrixStats(c.env, siteId);
  return c.json({ pages: data, stats, page, limit });
});

// ─── Publish ─────────────────────────────────────────────────────────

pseoV2.post('/:id/pseo/v2/publish', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const siteId = c.req.param('id');
  if (!(await guard(c, siteId))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = PseoPublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.issues } },
      400,
    );
  }
  const result = await publishPages(c.env, siteId, parsed.data.pageIds);
  return c.json({ ok: true, ...result });
});

export { pseoV2 as pseoMatrixV2Routes };
