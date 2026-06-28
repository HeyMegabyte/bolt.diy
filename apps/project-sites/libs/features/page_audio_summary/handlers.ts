import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { assertSiteOwned } from '../../../src/services/site_ownership.js';
import { FLAG_KEY, generateAudioSummary, getAudioSummary } from './service.js';
import {
  AudioSummaryGenerateRequestSchema,
  AudioSummaryGenerateResponseSchema,
  AudioSummaryGetResponseSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };
export const pageAudioSummary = new Hono<AppContext>();

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

pageAudioSummary.post('/api/audio-summary/:siteId', zValidator('json', AudioSummaryGenerateRequestSchema), async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { siteId } = c.req.param();
  if (!(await assertSiteOwned(c.env, c.get('orgId'), siteId))) return notFound(c);
  const { route, text, voice } = c.req.valid('json');
  const { audioKey } = await generateAudioSummary(c.env, siteId, route, text, voice);
  return c.json(AudioSummaryGenerateResponseSchema.parse({ siteId, route, audioKey }));
});

pageAudioSummary.get('/api/audio-summary/:siteId', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { siteId } = c.req.param();
  if (!(await assertSiteOwned(c.env, c.get('orgId'), siteId))) return notFound(c);
  const route = c.req.query('route') ?? '/';
  const { audioUrl } = await getAudioSummary(c.env, siteId, route);
  return c.json(AudioSummaryGetResponseSchema.parse({ siteId, route, audioUrl }));
});
