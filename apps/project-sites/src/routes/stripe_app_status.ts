/**
 * @module routes/stripe_app_status
 *
 * Stripe App Marketplace install-analytics routes.
 *
 * Mount path: `/api/stripe-app`
 *
 * Routes:
 *   GET    /api/stripe-app/installs    List install rows (pagination)
 *   GET    /api/stripe-app/summary     Aggregate summary
 *   POST   /api/stripe-app/lifecycle   Marketplace OAuth callback ingest
 *
 * Read endpoints require auth + the `stripe_app_status` flag. The lifecycle
 * ingest endpoint also requires the flag but accepts callbacks even when
 * the merchant isn't yet associated with an org — the row is created
 * `org_id = NULL` and joined once the merchant signs in via Stripe.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { StripeAppLifecycleEventSchema } from '../../libs/features/stripe_app_status/feature.schemas.js';
import {
  listInstalls,
  getInstallSummary,
  recordLifecycleEvent,
} from '../services/stripe_app_status.js';

const FLAG_KEY = 'stripe_app_status';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const stripeAppStatus = new Hono<{ Bindings: Env; Variables: Variables }>();

async function readGuard(c: AppContext): Promise<Response | null> {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId || !orgId) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Auth required' } },
      401,
    );
  }
  const on = await isFlagOn(c.env, FLAG_KEY, { orgId });
  if (!on) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Not found' } },
      404,
    );
  }
  return null;
}

stripeAppStatus.get('/api/stripe-app/installs', async (c) => {
  const blocked = await readGuard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const limit = Number(c.req.query('limit') ?? '100');
  const offset = Number(c.req.query('offset') ?? '0');
  const installs = await listInstalls(c.env, { orgId, limit, offset });
  return c.json({
    data: installs,
    limit: Math.min(limit, 500),
    offset,
  });
});

stripeAppStatus.get('/api/stripe-app/summary', async (c) => {
  const blocked = await readGuard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const summary = await getInstallSummary(c.env, orgId);
  return c.json({ data: summary });
});

stripeAppStatus.post(
  '/api/stripe-app/lifecycle',
  zValidator('json', StripeAppLifecycleEventSchema),
  async (c) => {
    // Lifecycle ingest: flag still required, but can accept events even
    // without an authenticated org (the marketplace OAuth callback may
    // hit this before the merchant's account is associated). Resolve
    // the scope via either header context OR the event payload.
    const orgFromCtx = c.get('orgId');
    const event = c.req.valid('json');
    const orgForFlag = orgFromCtx ?? event.org_id;
    const on = await isFlagOn(c.env, FLAG_KEY, {
      orgId: orgForFlag,
    });
    if (!on) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Not found' } },
        404,
      );
    }
    const row = await recordLifecycleEvent(c.env, {
      ...event,
      org_id: event.org_id ?? orgFromCtx,
    });
    return c.json({ data: row }, 202);
  },
);

export { stripeAppStatus };
