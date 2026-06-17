import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, classify } from './service.js';
import { GuardrailCheckRequestSchema, GuardrailCheckResponseSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };
export const aiGatewayGuardrails = new Hono<AppContext>();

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

aiGatewayGuardrails.post('/api/guardrails/check', zValidator('json', GuardrailCheckRequestSchema), async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { text, threshold } = c.req.valid('json');
  const result = await classify(c.env, text, threshold);
  return c.json(GuardrailCheckResponseSchema.parse(result));
});
