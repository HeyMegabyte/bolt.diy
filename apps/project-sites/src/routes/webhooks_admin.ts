/**
 * @module routes/webhooks_admin
 * @description Outbound Webhooks subscription API — feature #10 (P1).
 *
 * Routes (mounted at `/`, BEFORE the `api` catch-all):
 *   GET    /api/sites/:siteId/webhooks      → { ok, endpoints } (no secrets)
 *   POST   /api/sites/:siteId/webhooks      → { ok, id, secret } (secret shown ONCE) | 400
 *   DELETE /api/sites/:siteId/webhooks/:id  → { ok } | 404
 *
 * Every handler: auth + `isFlagOn('outbound_webhooks')` (404 when off) +
 * `assertSiteOwned` (404 on foreign/missing). The signing secret is generated
 * + AES-GCM encrypted at rest by the service and returned in plaintext only on
 * the create response.
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
  createWebhookEndpoint,
  listWebhookEndpoints,
  deleteWebhookEndpoint,
} from '../services/outbound_webhooks.js';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;
const UNAUTH = { error: { code: 'UNAUTHORIZED', message: 'Auth required' } } as const;

const EndpointBody = z
  .object({
    url: z.string().url().max(2048),
    eventTypes: z.array(z.string().min(1)).min(1).max(20),
  })
  .strict();

const webhooksAdmin = new Hono<{ Bindings: Env; Variables: Variables }>();

async function gate(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<{ orgId: string } | Response> {
  if (!c.get('userId')) return c.json(UNAUTH, 401);
  const orgId = c.get('orgId');
  const siteId = c.req.param('siteId');
  if (!(await isFlagOn(c.env, 'outbound_webhooks', { siteId, orgId }))) return c.json(NOT_FOUND, 404);
  if (!orgId || !(await assertSiteOwned(c.env, orgId, siteId))) return c.json(NOT_FOUND, 404);
  return { orgId };
}

webhooksAdmin.get('/api/sites/:siteId/webhooks', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  return c.json({ ok: true, endpoints: await listWebhookEndpoints(c.env, g.orgId, c.req.param('siteId')) });
});

webhooksAdmin.post('/api/sites/:siteId/webhooks', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;

  const parsed = EndpointBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid endpoint', details: parsed.error.issues } }, 400);
  }
  const res = await createWebhookEndpoint(c.env, g.orgId, c.req.param('siteId'), parsed.data.url, parsed.data.eventTypes);
  if (!res.ok) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Endpoint rejected', details: res.errors } }, 400);
  }
  // secret is returned ONCE here — the client must store it; it's encrypted at rest.
  return c.json({ ok: true, id: res.id, secret: res.secret }, 201);
});

webhooksAdmin.delete('/api/sites/:siteId/webhooks/:id', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const { ok } = await deleteWebhookEndpoint(c.env, g.orgId, c.req.param('siteId'), c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json(NOT_FOUND, 404);
});

export { webhooksAdmin };
