import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../src/types/env.js';
import { unauthorized, notFound } from '../../../src/lib/feature_guard.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, listTemplates, setVariantWeights, rollbackToVersion } from './service.js';
import {
  PromptListResponseSchema,
  VariantWeightRequestSchema,
  VariantWeightResponseSchema,
  RollbackResponseSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };
export const promptStudio = new Hono<AppContext>();

async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

promptStudio.get('/api/prompt-studio/templates', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const templates = listTemplates();
  return c.json(PromptListResponseSchema.parse({ templates, count: templates.length }));
});

promptStudio.post('/api/prompt-studio/:key/variant', zValidator('json', VariantWeightRequestSchema), async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { key } = c.req.param();
  const { weights } = c.req.valid('json');
  try {
    const { version } = setVariantWeights(key, weights);
    return c.json(VariantWeightResponseSchema.parse({ key, version, weights }));
  } catch (err) {
    return c.json({ error: { code: 'NOT_FOUND', message: String(err) } }, 404);
  }
});

promptStudio.post('/api/prompt-studio/:key/rollback', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const { key } = c.req.param();
  try {
    const { version } = rollbackToVersion(key);
    return c.json(RollbackResponseSchema.parse({ key, rolledBackTo: version }));
  } catch (err) {
    return c.json({ error: { code: 'NOT_FOUND', message: String(err) } }, 404);
  }
});
