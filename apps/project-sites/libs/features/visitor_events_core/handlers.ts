/**
 * @module libs/features/visitor_events_core/handlers
 * @description Public ingest route for Visitor Events Core.
 *
 * | Method | Path             | Purpose                              |
 * | ------ | ---------------- | ------------------------------------ |
 * | POST   | /api/v1/events   | Beacon ingest from a published site  |
 *
 * Public (no auth — published-site visitors). Hardened like the form-submit
 * ingest: site resolved by `X-Site-Slug`, origin allow-listed against the
 * site's hostnames, rate-limited per IP, and flag-gated (404 when off). Org is
 * always resolved server-side from the site — never trusted from the body.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { DOMAINS } from '@project-sites/shared';
import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { rateLimitMiddleware } from '../../../src/middleware/rate_limit.js';
import { FLAG_KEY, recordVisitorEvent } from './service.js';
import { VisitorEventInputSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const visitorEvents = new Hono<AppContext>();

const notFound = (c: Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
const badRequest = (c: Context<AppContext>, details: unknown) =>
  c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid event', details } }, 400);

// 120 events / 60s / IP — generous for a SPA beacon, bounds abuse.
visitorEvents.post(
  '/api/v1/events',
  rateLimitMiddleware({ maxRequests: 120, windowSeconds: 60, prefix: 'rl:events' }),
  async (c) => {
    const slug = c.req.header('x-site-slug') ?? c.req.query('slug');
    if (!slug) return badRequest(c, 'Missing X-Site-Slug');

    const site = await dbQueryOne<{ id: string; org_id: string; slug: string }>(
      c.env.DB,
      'SELECT id, org_id, slug FROM sites WHERE slug = ? AND deleted_at IS NULL',
      [slug],
    );
    if (!site) return notFound(c);

    // Flag gate (404 — don't leak feature existence).
    if (!(await isFlagOn(c.env, FLAG_KEY, { orgId: site.org_id, siteId: site.id })))
      return notFound(c);

    // Origin allow-list: default subdomain + provisioned hostnames; allow no-origin + localhost.
    const origin = c.req.header('origin') ?? '';
    const allowed = new Set<string>([
      `https://${site.slug}${DOMAINS.SITES_SUFFIX}`,
      `https://${DOMAINS.SITES_BASE}`,
    ]);
    const hostnames = await dbQuery<{ hostname: string }>(
      c.env.DB,
      'SELECT hostname FROM hostnames WHERE site_id = ? AND deleted_at IS NULL',
      [site.id],
    );
    for (const row of hostnames.data) allowed.add(`https://${row.hostname}`);
    const originOk =
      !origin ||
      allowed.has(origin) ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:');
    if (!originOk) return notFound(c);

    const body = await c.req.json().catch(() => null);
    const parsed = VisitorEventInputSchema.safeParse(body ?? {});
    if (!parsed.success) return badRequest(c, parsed.error.flatten());

    const { id } = await recordVisitorEvent(
      c.env,
      { orgId: site.org_id, siteId: site.id },
      parsed.data,
    );
    return c.json({ ok: true, id }, 202);
  },
);
