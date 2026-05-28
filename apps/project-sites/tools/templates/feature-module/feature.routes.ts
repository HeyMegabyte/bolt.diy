/**
 * Hono sub-app for {{slug}}.
 *
 * @remarks
 * Mount in `src/index.ts`:
 * ```ts
 * import { {{slug}}Routes } from '../libs/features/{{slug}}/feature.routes.js';
 * app.route('/api/{{slug}}', {{slug}}Routes);
 * ```
 *
 * Every handler is gated by {@link isFlagOn}. Unknown flag → 404, never 403,
 * so the feature's existence is not leaked to unauthenticated callers.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { isFlagOn } from '../../src/modules/feature_flags/services.js';
import type { Env } from '../../src/types/env.js';
import { {{Name}}RequestSchema, {{Name}}ResponseSchema } from './feature.schemas.js';
import { featureLog } from './feature.logger.js';
import { start{{Name}}Span } from './feature.telemetry.js';

type HonoEnv = { Bindings: Env; Variables: Record<string, unknown> };

export const {{slug}}Routes = new Hono<HonoEnv>();

/** Middleware: gate every request behind the feature flag. */
{{slug}}Routes.use('/*', async (c, next) => {
  const on = await isFlagOn(c.env, '{{SLUG_UPPER}}', {
    orgId: (c.get('orgId') as string | undefined) ?? undefined,
    siteId: (c.get('siteId') as string | undefined) ?? undefined,
  });
  if (!on) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  return next();
});

/** GET /api/{{slug}} — list / describe the feature's resources. */
{{slug}}Routes.get('/', async (c) => {
  return await start{{Name}}Span(c, '{{slug}}.list', async () => {
    featureLog.info('{{slug}}.list', { requestId: c.get('requestId') });
    // TODO: implement list handler
    return c.json({ data: [], total: 0 });
  });
});

/** POST /api/{{slug}} — create a resource. */
{{slug}}Routes.post('/', zValidator('json', {{Name}}RequestSchema), async (c) => {
  const body = c.req.valid('json');
  return await start{{Name}}Span(c, '{{slug}}.create', async () => {
    featureLog.info('{{slug}}.create', { requestId: c.get('requestId'), body });
    // TODO: implement create handler
    const result = {{Name}}ResponseSchema.parse({ id: crypto.randomUUID(), ...body });
    return c.json({ data: result }, 201);
  });
});
