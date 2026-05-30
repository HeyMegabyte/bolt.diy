/**
 * @module routes/plugin_marketplace
 * @description Plugin / Integration Marketplace API routes (IDEAS-50 #41).
 *
 * Mount path: `/` (handlers carry their own `/api/plugin-marketplace/*` prefix).
 *
 * Surfaces:
 *   GET    /api/plugin-marketplace/plugins                       — browse live
 *   GET    /api/plugin-marketplace/plugins/:id                   — single detail
 *   POST   /api/plugin-marketplace/submissions                   — creator submit
 *   POST   /api/plugin-marketplace/plugins/:id/install           — install on site
 *   GET    /api/plugin-marketplace/sites/:siteId/installs        — list installs
 *   DELETE /api/plugin-marketplace/installs/:installId           — uninstall
 *
 * Flag: `plugin_marketplace` (experimental, enabled=0, rollout=0).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  getPlugin,
  installPlugin,
  listPlugins,
  listSiteInstalls,
  siteOrgId,
  submitPlugin,
  uninstallPlugin,
} from '../services/plugin_marketplace.js';
import {
  PluginInstallInputSchema,
  PluginSubmissionSchema,
} from '../../libs/features/plugin_marketplace/feature.schemas.js';

const FLAG_KEY = 'plugin_marketplace';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const pluginMarketplace = new Hono<{ Bindings: Env; Variables: Variables }>();

async function guard(c: AppContext, requireAuth: boolean): Promise<Response | null> {
  const on = await isFlagOn(c.env, FLAG_KEY, { orgId: c.get('orgId') });
  if (!on) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  if (requireAuth) {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /plugins — browse live plugins.
// ─────────────────────────────────────────────────────────────────────────────

pluginMarketplace.get('/api/plugin-marketplace/plugins', async (c) => {
  const blocked = await guard(c, false);
  if (blocked) return blocked;

  const category = c.req.query('category') ?? undefined;
  const limit = Number(c.req.query('limit') ?? '200');
  const plugins = await listPlugins(c.env, {
    category,
    limit: Number.isFinite(limit) ? limit : 200,
  });
  return c.json({ plugins, count: plugins.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /plugins/:id — single detail.
// ─────────────────────────────────────────────────────────────────────────────

pluginMarketplace.get('/api/plugin-marketplace/plugins/:id', async (c) => {
  const blocked = await guard(c, false);
  if (blocked) return blocked;

  const id = c.req.param('id');
  const plugin = await getPlugin(c.env, id);
  if (!plugin) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Plugin not found' } }, 404);
  }
  if (plugin.status !== 'live') {
    const callerId = c.get('userId');
    if (!callerId || callerId !== plugin.creator_user_id) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Plugin not found' } }, 404);
    }
  }
  return c.json({ plugin });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /submissions — creator submit (auth).
// ─────────────────────────────────────────────────────────────────────────────

pluginMarketplace.post('/api/plugin-marketplace/submissions', async (c) => {
  const blocked = await guard(c, true);
  if (blocked) return blocked;
  const userId = c.get('userId') as string;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }
  const parsed = PluginSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid plugin submission',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  try {
    const result = await submitPlugin(c.env, parsed.data, userId);
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'SLUG_TAKEN') {
      return c.json({ error: { code: 'CONFLICT', message: 'Plugin slug already taken' } }, 409);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Submission failed' } }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /plugins/:id/install — install on site (auth).
// ─────────────────────────────────────────────────────────────────────────────

pluginMarketplace.post('/api/plugin-marketplace/plugins/:id/install', async (c) => {
  const blocked = await guard(c, true);
  if (blocked) return blocked;
  const userId = c.get('userId') as string;
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Org context required' } }, 403);
  }
  const pluginId = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }
  const parsed = PluginInstallInputSchema.safeParse({
    ...(body as Record<string, unknown>),
    plugin_id: pluginId,
  });
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid install body',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  try {
    const result = await installPlugin(c.env, parsed.data, userId, orgId);
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'PLUGIN_NOT_FOUND' || message === 'PLUGIN_NOT_LIVE') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Plugin not available' } }, 404);
    }
    if (message === 'SITE_NOT_OWNED') {
      // Don't leak that another org's site exists — 404, never 403.
      return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
    }
    if (message === 'PAYMENT_REQUIRED') {
      return c.json(
        {
          error: {
            code: 'PAYMENT_REQUIRED',
            message: 'Stripe PaymentIntent required for paid plugin',
          },
        },
        402,
      );
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Install failed' } }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sites/:siteId/installs — per-site install list.
// ─────────────────────────────────────────────────────────────────────────────

pluginMarketplace.get('/api/plugin-marketplace/sites/:siteId/installs', async (c) => {
  const blocked = await guard(c, true);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Org context required' } }, 403);
  }
  const siteId = c.req.param('siteId');
  // Tenant isolation: only list installs for a site the caller's org owns —
  // a mismatch (or missing site) returns 404, never leaking another org's data.
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== orgId) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }
  const installs = await listSiteInstalls(c.env, siteId);
  return c.json({ installs, count: installs.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /installs/:installId — uninstall.
// ─────────────────────────────────────────────────────────────────────────────

pluginMarketplace.delete('/api/plugin-marketplace/installs/:installId', async (c) => {
  const blocked = await guard(c, true);
  if (blocked) return blocked;
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Org context required' } }, 403);
  }
  const installId = c.req.param('installId');

  try {
    const result = await uninstallPlugin(c.env, installId, orgId);
    return c.json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'INSTALL_NOT_FOUND') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Install not found' } }, 404);
    }
    if (message === 'ALREADY_UNINSTALLED') {
      return c.json({ error: { code: 'CONFLICT', message: 'Plugin already uninstalled' } }, 409);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Uninstall failed' } }, 500);
  }
});

export { pluginMarketplace };
export default pluginMarketplace;
