/**
 * @module routes/ai_components
 * @description AI Code Components Generator API routes (IDEAS-50 #42).
 *
 * Mount path: `/` (handlers carry full paths).
 *
 * Surfaces:
 *   POST /api/sites/:siteId/ai-components/generate   — generate from prompt
 *   GET  /api/sites/:siteId/ai-components            — list site components
 *   GET  /api/ai-components/:id                      — read single component
 *   POST /api/ai-components/:id/regenerate           — try again with same prompt
 *   POST /api/ai-components/:id/publish              — promote to plugin marketplace
 *   DELETE /api/ai-components/:id                    — archive
 *
 * Flag: `ai_components` (experimental, enabled=0, rollout=0).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  archiveComponent,
  generateComponent,
  getComponent,
  listSiteComponents,
  publishComponent,
  regenerateComponent,
} from '../services/ai_components.js';
import {
  GenerateComponentInputSchema,
  PublishComponentInputSchema,
} from '../../libs/features/ai_components/feature.schemas.js';

const FLAG_KEY = 'ai_components';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const aiComponents = new Hono<{ Bindings: Env; Variables: Variables }>();

async function guard(c: AppContext): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }
  const on = await isFlagOn(c.env, FLAG_KEY, { orgId: c.get('orgId') });
  if (!on) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sites/:siteId/ai-components/generate — generate a component.
// ─────────────────────────────────────────────────────────────────────────────

aiComponents.post('/api/sites/:siteId/ai-components/generate', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const userId = c.get('userId') as string;
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Org context required' } }, 403);
  }
  const siteId = c.req.param('siteId');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }
  const parsed = GenerateComponentInputSchema.safeParse({
    ...(body as Record<string, unknown>),
    site_id: siteId,
  });
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid generate body',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  try {
    const result = await generateComponent(c.env, parsed.data, userId, orgId);
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'AI_INVALID_OUTPUT') {
      return c.json(
        {
          error: {
            code: 'AI_GENERATION_ERROR',
            message: 'AI returned malformed output. Try again.',
          },
        },
        502,
      );
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Generation failed' } }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sites/:siteId/ai-components — list per-site components.
// ─────────────────────────────────────────────────────────────────────────────

aiComponents.get('/api/sites/:siteId/ai-components', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Org context required' } }, 403);
  }

  const siteId = c.req.param('siteId');
  const limit = Number(c.req.query('limit') ?? '100');
  const components = await listSiteComponents(
    c.env,
    siteId,
    orgId,
    Number.isFinite(limit) ? limit : 100,
  );
  return c.json({ components, count: components.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai-components/:id — single component detail.
// ─────────────────────────────────────────────────────────────────────────────

aiComponents.get('/api/ai-components/:id', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Org context required' } }, 403);
  }
  const id = c.req.param('id');
  const component = await getComponent(c.env, id, orgId);
  if (!component) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Component not found' } }, 404);
  }
  return c.json({ component });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai-components/:id/regenerate — try again.
// ─────────────────────────────────────────────────────────────────────────────

aiComponents.post('/api/ai-components/:id/regenerate', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Org context required' } }, 403);
  }
  const id = c.req.param('id');

  try {
    const result = await regenerateComponent(c.env, id, orgId);
    return c.json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'COMPONENT_NOT_FOUND') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Component not found' } }, 404);
    }
    if (message === 'AI_INVALID_OUTPUT') {
      return c.json(
        {
          error: {
            code: 'AI_GENERATION_ERROR',
            message: 'AI returned malformed output. Try again.',
          },
        },
        502,
      );
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Regeneration failed' } }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai-components/:id/publish — promote to plugin marketplace.
// ─────────────────────────────────────────────────────────────────────────────

aiComponents.post('/api/ai-components/:id/publish', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const userId = c.get('userId') as string;
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Org context required' } }, 403);
  }
  const id = c.req.param('id');

  let body: unknown = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    // Empty body is valid — defaults apply.
  }

  const parsed = PublishComponentInputSchema.safeParse({
    ...(body as Record<string, unknown>),
    component_id: id,
  });
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid publish body',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  try {
    const result = await publishComponent(c.env, parsed.data, userId, orgId);
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'COMPONENT_NOT_FOUND') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Component not found' } }, 404);
    }
    if (message === 'ALREADY_PUBLISHED') {
      return c.json(
        { error: { code: 'CONFLICT', message: 'Already published to marketplace' } },
        409,
      );
    }
    if (message === 'FORBIDDEN') {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Only the creator can publish' } }, 403);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Publish failed' } }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/ai-components/:id — archive.
// ─────────────────────────────────────────────────────────────────────────────

aiComponents.delete('/api/ai-components/:id', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const userId = c.get('userId') as string;
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Org context required' } }, 403);
  }
  const id = c.req.param('id');

  try {
    const result = await archiveComponent(c.env, id, userId, orgId);
    return c.json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'COMPONENT_NOT_FOUND') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Component not found' } }, 404);
    }
    if (message === 'FORBIDDEN') {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Only the creator can archive' } }, 403);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Archive failed' } }, 500);
  }
});

export { aiComponents };
export default aiComponents;
