/**
 * @module libs/features/figma_import/handlers
 * @description Hono routes for the Figma import feature (flag: `figma_import`).
 *
 * | Method | Path              | Auth     | Purpose                                       |
 * | ------ | ----------------- | -------- | --------------------------------------------- |
 * | POST   | /api/figma/import | required | Import tokens + components from a Figma file  |
 *
 * Routes 404 when the flag is off per [[feature-flags]]. Auth required.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, importFigmaFile } from './service.js';
import { FigmaImportRequestSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const figmaImport = new Hono<AppContext>();

/** POST /api/figma/import — import design tokens and components from a Figma file. */
figmaImport.post('/api/figma/import', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }

  const on = await isFlagOn(c.env, FLAG_KEY, { userId });
  if (!on) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = FigmaImportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() } },
      400,
    );
  }

  const result = await importFigmaFile(c.env, parsed.data.token, parsed.data.fileKey);
  return c.json({ ok: true as const, ...result });
});
