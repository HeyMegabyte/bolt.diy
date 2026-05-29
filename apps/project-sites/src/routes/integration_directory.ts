/**
 * @module routes/integration_directory
 * @description Integration Directory routes (feature #30).
 *
 * Mounted at `/api/sites/:id/integrations/*`. Flag-gated on
 * `integration_directory`; returns 404 when off.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  IntegrationGenerateRequestSchema,
  IntegrationPublishRequestSchema,
  IntegrationSeedRequestSchema,
} from '../../libs/features/integration_directory/feature.schemas.js';
import {
  generatePages,
  listPages,
  listServices,
  publishPages,
  seedServices,
} from '../services/integration_directory.js';
import { dbQueryOne } from '../services/db.js';

const integ = new Hono<{ Bindings: Env; Variables: Variables }>();

async function guard(env: Env): Promise<boolean> {
  return isFlagOn(env, 'integration_directory');
}

integ.get('/:id/integrations/services', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const services = await listServices(c.env, c.req.param('id'));
  return c.json({ services });
});

integ.post('/:id/integrations/seed', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

  const siteId = c.req.param('id');
  const orgId = c.get('orgId') ?? '';
  const site = await dbQueryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = IntegrationSeedRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.issues } },
      400,
    );
  }
  const result = await seedServices(c.env, siteId, orgId, parsed.data.services);
  return c.json({ ok: true, ...result });
});

integ.post('/:id/integrations/generate', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

  const siteId = c.req.param('id');
  const orgId = c.get('orgId') ?? '';
  const body = await c.req.json().catch(() => ({}));
  const parsed = IntegrationGenerateRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.issues } },
      400,
    );
  }
  const result = await generatePages(c.env, siteId, orgId, parsed.data);
  return c.json({ ok: true, ...result });
});

integ.get('/:id/integrations/pages', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const status = c.req.query('status');
  const pages = await listPages(c.env, c.req.param('id'), status);
  return c.json({ pages });
});

integ.post('/:id/integrations/publish', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const body = await c.req.json().catch(() => null);
  const parsed = IntegrationPublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.issues } },
      400,
    );
  }
  const result = await publishPages(c.env, c.req.param('id'), parsed.data.pageIds);
  return c.json({ ok: true, ...result });
});

export { integ as integrationDirectoryRoutes };
