import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, generateUiDescriptors } from './service.js';
import { GenerativeUiRequestSchema, GenerativeUiResponseSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };
export const generativeUiStream = new Hono<AppContext>();

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

generativeUiStream.post('/api/copilot/ui', zValidator('json', GenerativeUiRequestSchema), async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { prompt, context } = c.req.valid('json');
  const descriptors = await generateUiDescriptors(c.env, prompt, context);
  return c.json(GenerativeUiResponseSchema.parse({ descriptors, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }));
});
