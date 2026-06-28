import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { assertSiteOwned } from '../../../src/services/site_ownership.js';
import { FLAG_KEY, upsertVariants, resolveVariant } from './service.js';
import {
  UpsertVariantsRequestSchema,
  UpsertVariantsResponseSchema,
  PersonalizationSignalsSchema,
  ResolveVariantResponseSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };
export const edgePersonalization = new Hono<AppContext>();

const unauthorized = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

edgePersonalization.post('/api/personalize/:siteId/variants', zValidator('json', UpsertVariantsRequestSchema), async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { siteId } = c.req.param();
  if (!(await assertSiteOwned(c.env, c.get('orgId'), siteId))) return notFound(c);
  const { variants } = c.req.valid('json');
  const count = await upsertVariants(c.env, siteId, variants);
  return c.json(UpsertVariantsResponseSchema.parse({ siteId, count }));
});

edgePersonalization.get('/api/personalize/:siteId/resolve', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { siteId } = c.req.param();
  if (!(await assertSiteOwned(c.env, c.get('orgId'), siteId))) return notFound(c);
  const rawSignals = {
    geo: c.req.query('geo'),
    device: c.req.query('device') as 'mobile' | 'tablet' | 'desktop' | undefined,
    referrer: c.req.query('referrer'),
    hour: c.req.query('hour') ? Number(c.req.query('hour')) : undefined,
    isReturn: c.req.query('isReturn') === 'true' ? true : c.req.query('isReturn') === 'false' ? false : undefined,
  };
  const signals = PersonalizationSignalsSchema.parse(rawSignals);
  const { variantId, variantName } = await resolveVariant(c.env, siteId, signals);
  return c.json(ResolveVariantResponseSchema.parse({ siteId, variantId, variantName }));
});
