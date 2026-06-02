/**
 * @module routes/automation
 * @description Automation Builder API — feature #11 (P1).
 *
 * Routes (mounted at `/`, BEFORE the `api` catch-all):
 *   GET    /api/sites/:siteId/recipes      → { ok, recipes }
 *   POST   /api/sites/:siteId/recipes      → { ok, id } | 400 (validation)
 *   DELETE /api/sites/:siteId/recipes/:id  → { ok } | 404
 *
 * Every handler: auth + `isFlagOn('automation_builder')` (404 when off, never
 * leak) + `assertSiteOwned` (404 on foreign/missing). Recipe shape is validated
 * by the `automation_builder` service (allowlisted trigger/action types).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import {
  createRecipe,
  listRecipes,
  deleteRecipe,
  type AutomationRecipe,
} from '../services/automation_builder.js';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;
const UNAUTH = { error: { code: 'UNAUTHORIZED', message: 'Auth required' } } as const;

const RecipeBody = z
  .object({
    name: z.string().min(1).max(120),
    enabled: z.boolean().optional().default(true),
    trigger: z.object({
      type: z.string().min(1),
      filter: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
    actions: z
      .array(z.object({ type: z.string().min(1), config: z.record(z.unknown()).optional() }))
      .min(1),
  })
  .strict();

const automation = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Shared gate → returns the owner orgId, or a Response to short-circuit. */
async function gate(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<{ orgId: string } | Response> {
  if (!c.get('userId')) return c.json(UNAUTH, 401);
  const orgId = c.get('orgId');
  const siteId = c.req.param('siteId');
  if (!(await isFlagOn(c.env, 'automation_builder', { siteId, orgId }))) return c.json(NOT_FOUND, 404);
  if (!orgId || !(await assertSiteOwned(c.env, orgId, siteId))) return c.json(NOT_FOUND, 404);
  return { orgId };
}

automation.get('/api/sites/:siteId/recipes', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  return c.json({ ok: true, recipes: await listRecipes(c.env, g.orgId, c.req.param('siteId')) });
});

automation.post('/api/sites/:siteId/recipes', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;

  const parsed = RecipeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid recipe', details: parsed.error.issues } }, 400);
  }
  const res = await createRecipe(c.env, g.orgId, c.req.param('siteId'), parsed.data as AutomationRecipe);
  if (!res.ok) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Recipe rejected', details: res.errors } }, 400);
  }
  return c.json({ ok: true, id: res.id }, 201);
});

automation.delete('/api/sites/:siteId/recipes/:id', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const { ok } = await deleteRecipe(c.env, g.orgId, c.req.param('siteId'), c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json(NOT_FOUND, 404);
});

export { automation };
