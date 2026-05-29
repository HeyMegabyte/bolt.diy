/**
 * @module routes/reviews
 * @description Review Synthesis API routes — feature #24 (verified review synthesis).
 *
 * Routes (mounted at `/api/reviews`):
 *   POST /:siteId/synthesize  — run synthesis (fetch + verify + AI-summarize + persist)
 *   GET  /:siteId             — latest synthesis + JSON-LD
 *   GET  /:siteId/jsonld      — just the schema.org JSON-LD block
 *
 * Every handler is gated by the `review_synthesis` feature flag and returns
 * 404 (never 403) when the flag is off — never leak feature existence.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  synthesizeReviews,
  getLatestSynthesis,
  buildReviewJsonLd,
} from '../services/review_synthesis.js';

const reviews = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── POST /:siteId/synthesize ─────────────────────────────────────────

reviews.post('/:siteId/synthesize', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();

  if (!(await isFlagOn(c.env, 'review_synthesis', { siteId, orgId: c.get('orgId') }))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  const result = await synthesizeReviews(c.env, siteId);
  if (!result.ok) {
    return c.json({ error: { code: 'BAD_REQUEST', message: result.error ?? 'Synthesis failed' } }, 400);
  }

  return c.json({ ok: true, synthesis: result.synthesis, jsonld: result.jsonld ?? null });
});

// ─── GET /:siteId ─────────────────────────────────────────────────────

reviews.get('/:siteId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();

  if (!(await isFlagOn(c.env, 'review_synthesis', { siteId, orgId: c.get('orgId') }))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  const synthesis = await getLatestSynthesis(c.env, siteId);
  if (!synthesis) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No synthesis found' } }, 404);
  }

  const jsonld = buildReviewJsonLd(synthesis);
  return c.json({ synthesis, jsonld });
});

// ─── GET /:siteId/jsonld ──────────────────────────────────────────────

reviews.get('/:siteId/jsonld', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { siteId } = c.req.param();

  if (!(await isFlagOn(c.env, 'review_synthesis', { siteId, orgId: c.get('orgId') }))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  const synthesis = await getLatestSynthesis(c.env, siteId);
  if (!synthesis) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No synthesis found' } }, 404);
  }

  const jsonld = buildReviewJsonLd(synthesis);
  return c.json({ jsonld });
});

export { reviews as reviewRoutes };
