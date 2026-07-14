/**
 * Dittofeed API routes — per-site engagement features.
 *
 * @remarks
 * Mounted at /api/dittofeed. Gated behind `dittofeed_integration` flag.
 * 404 when off (never 403). All routes org-scoped.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { trackEvent, dittofeedHealth } from '../services/dittofeed.js';
import { buildDittofeedConfig } from '../services/dittofeed_dispatch.js';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const dittofeedRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// POST /api/dittofeed/sites/:siteId/events — emit a site-scoped event
// ---------------------------------------------------------------------------

dittofeedRoutes.post('/sites/:siteId/events', async (c: Ctx) => {
  const flagOn = await isFlagOn(c.env, 'dittofeed_integration');
  if (!flagOn) return c.notFound();

  const dcfg = buildDittofeedConfig(c.env);
  if (!dcfg) return c.json({ ok: false, reason: 'not_configured' }, 503);

  const siteId = c.req.param('siteId');
  const orgId = c.get('orgId') ?? 'unknown';

  let body: { event?: string; properties?: Record<string, unknown>; userId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, reason: 'invalid_json' }, 400);
  }
  if (!body.event || typeof body.event !== 'string' || body.event.length > 128) {
    return c.json({ ok: false, reason: 'invalid_event' }, 400);
  }

  const result = await trackEvent(dcfg, {
    userId: body.userId ?? orgId,
    event: body.event,
    properties: { ...(body.properties ?? {}), siteId, orgId, source: 'admin_api' },
  });

  if (!result.ok) {
    const msg = 'reason' in result ? result.detail : result.message;
    return c.json({ ok: false, message: msg }, 502);
  }
  return c.json({ ok: true, event: result.event });
});

// ---------------------------------------------------------------------------
// GET /api/dittofeed/sites/:siteId/status — workspace + connectivity status
// ---------------------------------------------------------------------------

dittofeedRoutes.get('/sites/:siteId/status', async (c: Ctx) => {
  const flagOn = await isFlagOn(c.env, 'dittofeed_integration');
  if (!flagOn) return c.notFound();

  const dcfg = buildDittofeedConfig(c.env);
  if (!dcfg) return c.json({ ok: false, reason: 'not_configured' }, 503);

  const health = await dittofeedHealth(dcfg);
  return c.json({
    ok: health.ok,
    version: health.ok ? health.version : undefined,
    workspaceId: dcfg.workspaceId,
    baseUrl: dcfg.baseUrl,
  });
});

// ---------------------------------------------------------------------------
// GET /api/dittofeed/health — global health check (no site scope)
// ---------------------------------------------------------------------------

dittofeedRoutes.get('/health', async (c: Ctx) => {
  const dcfg = buildDittofeedConfig(c.env);
  if (!dcfg) return c.json({ ok: false, reason: 'not_configured', status: 'unavailable' }, 503);
  const result = await dittofeedHealth(dcfg);
  return c.json({
    status: result.ok ? 'healthy' : 'unhealthy',
    version: result.ok ? result.version : undefined,
    workspaceId: dcfg.workspaceId,
  });
});

export { dittofeedRoutes };
