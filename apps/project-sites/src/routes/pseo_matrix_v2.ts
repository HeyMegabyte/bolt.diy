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
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQuery } from '../services/db.js';
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
  siteOrgId,
} from '../services/pseo_matrix_v2.js';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const pseoV2 = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Auth + flag gate, then assert the `:id` site belongs to the caller's org —
 * multi-tenant isolation. Returns the resolved `{ siteId, orgId }` to proceed,
 * or a short-circuit `Response`: 401 unauthenticated, 404 flag-off OR
 * cross-org OR missing site (never 403 — don't leak another org's site).
 * Closes a gap where the axes/pages/publish routes trusted the URL `:id`
 * without verifying tenancy.
 */
async function gateOwnedSite(c: AppContext): Promise<{ siteId: string; orgId: string } | Response> {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId || !orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }
  if (!(await isFlagOn(c.env, 'pseo_matrix_v2', { orgId }))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  const siteId = c.req.param('id');
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== orgId) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404); // missing OR not yours
  }
  return { siteId, orgId };
}

// ─── Axes ────────────────────────────────────────────────────────────

pseoV2.get('/:id/pseo/v2/axes', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;
  const axes = await listAxes(c.env, gate.siteId);
  return c.json({ siteId: gate.siteId, axes });
});

pseoV2.post('/:id/pseo/v2/axes', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json().catch(() => null);
  const parsed = PseoAxisSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: { code: 'VALIDATION_ERROR', message: 'Invalid axis', details: parsed.error.issues },
      },
      400,
    );
  }
  await saveAxis(c.env, gate.siteId, gate.orgId, parsed.data);
  return c.json({ ok: true, axisName: parsed.data.axisName });
});

// ─── Generate ────────────────────────────────────────────────────────

pseoV2.post('/:id/pseo/v2/generate', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;

  const body = await c.req.json().catch(() => null);
  const parsed = PseoGenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: parsed.error.issues,
        },
      },
      400,
    );
  }
  const result = await generatePages(c.env, gate.siteId, gate.orgId, parsed.data);
  return c.json({ ok: true, ...result });
});

// ─── Pages list ──────────────────────────────────────────────────────

pseoV2.get('/:id/pseo/v2/pages', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;
  const { siteId, orgId } = gate;

  const status = c.req.query('status');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;
  // org_id is in the WHERE clause too (defense-in-depth) even though the gate
  // already proved the site belongs to this org.
  const whereClause = status
    ? 'WHERE site_id = ? AND org_id = ? AND status = ? AND deleted_at IS NULL'
    : 'WHERE site_id = ? AND org_id = ? AND deleted_at IS NULL';
  const params = status ? [siteId, orgId, status, limit, offset] : [siteId, orgId, limit, offset];

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
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json().catch(() => null);
  const parsed = PseoPublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: parsed.error.issues,
        },
      },
      400,
    );
  }
  const result = await publishPages(c.env, gate.siteId, parsed.data.pageIds);
  return c.json({ ok: true, ...result });
});

export { pseoV2 as pseoMatrixV2Routes };
