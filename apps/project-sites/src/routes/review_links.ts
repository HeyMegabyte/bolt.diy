/**
 * @module routes/review_links
 * @description Admin API for Review/Approval Links — feature #4 (P1). The
 * operator generates a shareable preview+approve link for a site; stakeholders
 * approve/reject it via the public `/review/:id` page (see routes/review_public).
 *
 * Routes (mounted at `/`, BEFORE the `api` catch-all):
 *   GET  /api/sites/:siteId/review-links  → { ok, links } (each with derived status)
 *   POST /api/sites/:siteId/review-links  → { ok, id, url, expiresAt } | 400
 *
 * Every handler: auth + `isFlagOn('approval_workflow')` (404 when off, never 403
 * — don't leak feature existence) + `assertSiteOwned` (404 on foreign/missing).
 * EXTENDS the existing approval_workflow flag + review_tokens table (NOT a new
 * module) — the owned replacement for the demo createReviewLink stub.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import { createReviewLink, listReviewLinks } from '../services/review_approval.js';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;
const UNAUTH = { error: { code: 'UNAUTHORIZED', message: 'Auth required' } } as const;

/** Optional ttl in days (1–90); defaults to the service's 7-day default. */
const CreateBody = z.object({ ttlDays: z.number().int().min(1).max(90).optional() }).strict();

const reviewLinks = new Hono<{ Bindings: Env; Variables: Variables }>();

async function gate(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<{ orgId: string } | Response> {
  if (!c.get('userId')) return c.json(UNAUTH, 401);
  const orgId = c.get('orgId');
  const siteId = c.req.param('siteId');
  if (!(await isFlagOn(c.env, 'approval_workflow', { siteId, orgId }))) return c.json(NOT_FOUND, 404);
  if (!orgId || !(await assertSiteOwned(c.env, orgId, siteId))) return c.json(NOT_FOUND, 404);
  return { orgId };
}

reviewLinks.get('/api/sites/:siteId/review-links', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  return c.json({ ok: true, links: await listReviewLinks(c.env, g.orgId, c.req.param('siteId')) });
});

reviewLinks.post('/api/sites/:siteId/review-links', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;

  const parsed = CreateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid request', details: parsed.error.issues } }, 400);
  }
  const ttlMs = parsed.data.ttlDays ? parsed.data.ttlDays * 86_400_000 : undefined;
  const res = await createReviewLink(c.env, g.orgId, c.req.param('siteId'), ttlMs ? { ttlMs } : {});
  if (!res.ok) {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: res.error ?? 'Could not create review link' } }, 500);
  }
  return c.json({ ok: true, id: res.id, url: res.url, expiresAt: res.expiresAt });
});

export { reviewLinks };
