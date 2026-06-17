import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, answer, getConfig } from './service.js';
import { ConciergeMessageRequestSchema, ConciergeMessageResponseSchema, ConciergeConfigResponseSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };
export const aiConciergeWidget = new Hono<AppContext>();

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

aiConciergeWidget.post('/api/concierge/:siteId/message', zValidator('json', ConciergeMessageRequestSchema), async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { siteId } = c.req.param();
  const { message } = c.req.valid('json');
  const result = await answer(c.env, siteId, message);
  return c.json(ConciergeMessageResponseSchema.parse(result));
});

aiConciergeWidget.get('/api/concierge/:siteId/config', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { siteId } = c.req.param();
  const config = await getConfig(siteId);
  return c.json(ConciergeConfigResponseSchema.parse(config));
});
