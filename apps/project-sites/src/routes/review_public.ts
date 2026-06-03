/**
 * @module routes/review_public
 * @description Public reviewer endpoints for Review/Approval Links (#4, slice 2b).
 *
 * A stakeholder receives a shareable link (`/review/:id`) — the unguessable
 * UUID `id` IS the bearer credential (no login). These endpoints let them view
 * the review and approve/reject/revoke it.
 *
 * Routes (mounted at `/`, BEFORE the `api` catch-all):
 *   GET  /api/review/:id           → { ok, review: { id, site_id, status, expires_at } }
 *   POST /api/review/:id/decision  → { ok, status } | 400
 *
 * Flag-scoped to the review's OWNING org (`agency_org_id`): if that org doesn't
 * have `approval_workflow` on, the route 404s (never leaks). State + transitions
 * go through the `review_approval` service (the #4 state machine).
 *
 * Hardening follow-ups (noted, not in this slice): verify the raw token against
 * `token_hash` (id-as-bearer is the MVP), and KV rate-limit the decision POST.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { rateLimitMiddleware } from '../middleware/rate_limit.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  getReviewLink,
  recordReviewDecision,
  recordReviewComment,
  effectiveApprovalStatus,
  MAX_REVIEW_COMMENT_LEN,
  type ApprovalStatus,
} from '../services/review_approval.js';

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;

const reviewPublic = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * `action: 'comment'` records a reviewer note WITHOUT transitioning state
 * (the link stays pending). `approve|reject|revoke` transition + carry an
 * optional `comment` recorded alongside the decision in the audit log.
 */
const DecisionBody = z
  .object({
    action: z.enum(['approve', 'reject', 'revoke', 'comment']),
    comment: z.string().trim().min(1).max(MAX_REVIEW_COMMENT_LEN).optional(),
  })
  .strict();

reviewPublic.get('/api/review/:id', async (c) => {
  const { id } = c.req.param();
  const row = await getReviewLink(c.env, id);
  if (!row) return c.json(NOT_FOUND, 404);
  if (!(await isFlagOn(c.env, 'approval_workflow', { orgId: row.agency_org_id }))) {
    return c.json(NOT_FOUND, 404);
  }
  const status = effectiveApprovalStatus(
    { status: (row.decision as ApprovalStatus) ?? 'pending', expiresAt: row.expires_at },
    new Date().toISOString(),
  );
  return c.json({ ok: true, review: { id: row.id, site_id: row.site_id, status, expires_at: row.expires_at } });
});

// Public mutation endpoint → rate-limit per IP (10/min) to blunt abuse/brute-force.
reviewPublic.post(
  '/api/review/:id/decision',
  rateLimitMiddleware({ maxRequests: 10, windowSeconds: 60, prefix: 'rl:review-decision' }),
  async (c) => {
  const { id } = c.req.param();
  const row = await getReviewLink(c.env, id);
  if (!row) return c.json(NOT_FOUND, 404);
  if (!(await isFlagOn(c.env, 'approval_workflow', { orgId: row.agency_org_id }))) {
    return c.json(NOT_FOUND, 404);
  }

  const parsed = DecisionBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'action must be approve|reject|revoke|comment' } },
      400,
    );
  }

  const nowIso = new Date().toISOString();

  // 'comment' records a note without transitioning the link state.
  if (parsed.data.action === 'comment') {
    if (!parsed.data.comment) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'comment is required for action=comment' } }, 400);
    }
    const cr = await recordReviewComment(c.env, id, parsed.data.comment, nowIso);
    if (!cr.ok) {
      return c.json({ error: { code: 'BAD_REQUEST', message: cr.error ?? 'Comment failed' } }, 400);
    }
    return c.json({ ok: true, commented: true });
  }

  const res = await recordReviewDecision(c.env, id, parsed.data.action, nowIso, parsed.data.comment);
  if (!res.ok) {
    return c.json({ error: { code: 'BAD_REQUEST', message: res.error ?? 'Decision failed' } }, 400);
  }
  return c.json({ ok: true, status: res.status });
});

export { reviewPublic };
