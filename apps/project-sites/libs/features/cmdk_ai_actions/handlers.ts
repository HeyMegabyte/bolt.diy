/**
 * @module libs/features/cmdk_ai_actions/handlers
 * @description Hono routes for the Cmd+K AI Actions feature module.
 *
 * | Method | Path                | Purpose                                          |
 * | ------ | ------------------- | ------------------------------------------------ |
 * | POST   | /api/cmdk/resolve   | Resolve a natural-language command to an action  |
 *
 * The route returns 404 when the `cmdk_ai_actions` flag is off (never 403
 * — do not leak feature existence) per [[feature-flags]].
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { unauthorized, notFound } from '../../../src/lib/feature_guard.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, resolveNlAction } from './service.js';
import { CmdkResolveBodySchema, CmdkResolveResponseSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const cmdkAiActionsRouter = new Hono<AppContext>();

/** Auth + flag gate. Returns a Response to short-circuit, or null to proceed. */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

/**
 * POST /api/cmdk/resolve
 *
 * Accepts a natural-language query and optional caller context, then uses
 * Workers AI to resolve the query to a structured action intent.
 *
 * @remarks
 * On LLM failure the service returns an `unknown` action with `confidence: 0`
 * rather than an error — the frontend should treat low-confidence responses
 * as "no match found" and fall back to deterministic search.
 */
cmdkAiActionsRouter.post('/api/cmdk/resolve', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const body = await c.req.json().catch(() => null);
  const parsed = CmdkResolveBodySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parsed.error.issues,
        },
      },
      422,
    );
  }

  const { query, context } = parsed.data;

  const action = await resolveNlAction(c.env, query, context);

  return c.json(
    CmdkResolveResponseSchema.parse({ ok: true, data: action }),
    200,
  );
});
