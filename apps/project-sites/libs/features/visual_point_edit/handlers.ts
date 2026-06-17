/**
 * @module libs/features/visual_point_edit/handlers
 * @description Hono routes for the visual point-edit feature (flag: `visual_point_edit`).
 *
 * | Method | Path                    | Auth     | Purpose                                 |
 * | ------ | ----------------------- | -------- | --------------------------------------- |
 * | POST   | /api/editor/point-edit  | required | Patch a DOM node via plain-language AI  |
 *
 * Routes 404 when the flag is off per [[feature-flags]]. Auth required.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, patchNode } from './service.js';
import { PointEditRequestSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const visualPointEdit = new Hono<AppContext>();

/** POST /api/editor/point-edit — patch a published site node via plain language. */
visualPointEdit.post('/api/editor/point-edit', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }

  const on = await isFlagOn(c.env, FLAG_KEY, { userId });
  if (!on) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = PointEditRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() } },
      400,
    );
  }

  const result = await patchNode(c.env, parsed.data.nodeId, parsed.data.instruction);
  return c.json({ ok: true as const, ...result });
});
