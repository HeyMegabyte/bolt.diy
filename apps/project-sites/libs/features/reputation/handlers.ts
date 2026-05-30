/**
 * @module libs/features/reputation/handlers
 * @description Hono routes for the Reputation suite (ideas #10, #11, #13).
 *
 * | Method | Path                                       | Flag                 | Idea |
 * | ------ | ------------------------------------------ | -------------------- | ---- |
 * | POST   | /api/sites/:id/reputation/review-request   | review_requests      | #10  |
 * | POST   | /api/sites/:id/reputation/reply-draft      | review_responder     | #11  |
 * | GET    | /api/sites/:id/reputation/monitor          | reputation_monitor   | #13  |
 *
 * Each route is gated by its OWN flag and returns 404 (never 403 — don't leak
 * feature existence) when that flag is off, so the three capabilities roll out
 * independently per [[feature-flags]].
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  FLAG_REVIEW_REQUESTS,
  FLAG_REVIEW_RESPONDER,
  FLAG_REPUTATION_MONITOR,
  sendReviewRequest,
  draftReviewReply,
  getReputationSnapshot,
} from './service.js';
import { ReviewRequestChannelSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const reputation = new Hono<AppContext>();

const unauthorized = (c: Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

const badRequest = (c: Context<AppContext>, message: string) =>
  c.json({ error: { code: 'BAD_REQUEST', message } }, 400);

/** Auth + per-route flag gate. Returns a Response to short-circuit, or null. */
async function guard(c: Context<AppContext>, flagKey: string): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, flagKey, { siteId: c.req.param('id'), orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

// ─── #10 — POST /api/sites/:id/reputation/review-request ────────────────────

const ReviewRequestBodySchema = z.object({
  channel: ReviewRequestChannelSchema,
  recipient: z.string().min(1).max(320),
  jobContext: z.string().max(2000).optional(),
});

reputation.post('/api/sites/:id/reputation/review-request', async (c) => {
  const blocked = await guard(c, FLAG_REVIEW_REQUESTS);
  if (blocked) return blocked;

  const parsed = ReviewRequestBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid body');

  const record = await sendReviewRequest(c.env, {
    siteId: c.req.param('id'),
    channel: parsed.data.channel,
    recipient: parsed.data.recipient,
    jobContext: parsed.data.jobContext,
  });
  return c.json({ ok: record.status === 'sent', request: record });
});

// ─── #11 — POST /api/sites/:id/reputation/reply-draft ───────────────────────

const ReplyDraftBodySchema = z.object({
  reviewText: z.string().min(1).max(4000),
  rating: z.number().min(1).max(5),
  tone: z.string().max(120).optional(),
});

reputation.post('/api/sites/:id/reputation/reply-draft', async (c) => {
  const blocked = await guard(c, FLAG_REVIEW_RESPONDER);
  if (blocked) return blocked;

  const parsed = ReplyDraftBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return badRequest(c, parsed.error.issues[0]?.message ?? 'Invalid body');

  const draft = await draftReviewReply(c.env, {
    siteId: c.req.param('id'),
    reviewText: parsed.data.reviewText,
    rating: parsed.data.rating,
    tone: parsed.data.tone,
  });
  return c.json({ ok: true, draft });
});

// ─── #13 — GET /api/sites/:id/reputation/monitor ────────────────────────────

reputation.get('/api/sites/:id/reputation/monitor', async (c) => {
  const blocked = await guard(c, FLAG_REPUTATION_MONITOR);
  if (blocked) return blocked;

  const snapshot = await getReputationSnapshot(c.env, c.req.param('id'));
  return c.json({ snapshot });
});
