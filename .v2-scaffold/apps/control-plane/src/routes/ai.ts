/**
 * AI surface. Every call is rate-limited per user and routed through the AI Gateway
 * cache. Fallback chain inherited from `aiCall`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import type { HonoEnv } from '../types.js';
import { aiCall } from '../services/ai-gateway.js';
import { writeAudit } from '../services/audit.js';

const app = new Hono<HonoEnv>();
app.use('*', rateLimit('ai'));

app.post(
  '/complete',
  zValidator(
    'json',
    z.object({
      provider: z.enum(['anthropic', 'openai', 'workers-ai']),
      model: z.string().min(1),
      body: z.record(z.string(), z.unknown()),
      cache: z.boolean().default(true),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const body = c.req.valid('json');
    const result = await aiCall(c.env, {
      provider: body.provider,
      model: body.model,
      body: body.body,
      cache: body.cache,
    });
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: c.get('tenantId'),
      event: 'ai.complete',
      target_type: 'ai_call',
      target_id: null,
      metadata: { provider: result.provider, model: result.model, cached: result.cached },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });
    return c.json(result);
  },
);

export default app;
