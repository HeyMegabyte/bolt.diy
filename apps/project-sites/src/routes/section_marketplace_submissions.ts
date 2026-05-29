/**
 * @module routes/section_marketplace_submissions
 * @description Creator submission + admin curation routes for the Section
 *              Marketplace (IDEAS-50 #40 — extends the alpha module).
 *
 * Distinct from `routes/section_marketplace.ts` (the read-only catalog) to
 * avoid touching files that may be in concurrent edit.
 *
 * Routes:
 *   POST /api/marketplace/sections                  — creator submit
 *   GET  /api/marketplace/sections/pending          — admin pending queue
 *   POST /api/marketplace/sections/:id/review       — admin approve/reject
 *
 * Flag: `section_marketplace` (existing, experimental, enabled=0, rollout=0).
 * Server guard: 404 when off.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  listPendingSubmissions,
  reviewSubmission,
  SectionSubmissionSchema,
  submitSection,
} from '../services/section_marketplace_submissions.js';

const FLAG_KEY = 'section_marketplace';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const sectionMarketplaceSubmissions = new Hono<{ Bindings: Env; Variables: Variables }>();

async function guard(c: AppContext): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }
  const on = await isFlagOn(c.env, FLAG_KEY, { orgId: c.get('orgId') });
  if (!on) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/marketplace/sections — creator submission.
// ─────────────────────────────────────────────────────────────────────────────

sectionMarketplaceSubmissions.post('/api/marketplace/sections', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const userId = c.get('userId') as string;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }
  const parsed = SectionSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid section submission',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  try {
    const result = await submitSection(c.env, parsed.data, userId);
    return c.json(result, 201);
  } catch {
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Submission failed' } },
      500,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/marketplace/sections/pending — admin pending queue.
// ─────────────────────────────────────────────────────────────────────────────

sectionMarketplaceSubmissions.get('/api/marketplace/sections/pending', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  // NB: in production, curator-only RBAC would gate this further. For the
  // alpha module the flag itself is enabled only for Brian + curators.
  const limit = Number(c.req.query('limit') ?? '100');
  const submissions = await listPendingSubmissions(
    c.env,
    Number.isFinite(limit) ? limit : 100,
  );
  return c.json({ submissions, count: submissions.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/marketplace/sections/:id/review — admin approve/reject.
//
// Body: { decision: 'approve' | 'reject', rejection_reason?, quality_score? }
// ─────────────────────────────────────────────────────────────────────────────

sectionMarketplaceSubmissions.post('/api/marketplace/sections/:id/review', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const reviewerId = c.get('userId') as string;
  const id = c.req.param('id');

  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }
  const decision = body.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'decision must be approve|reject' } },
      400,
    );
  }

  try {
    const result = await reviewSubmission(c.env, {
      id,
      decision,
      reviewer_user_id: reviewerId,
      rejection_reason:
        typeof body.rejection_reason === 'string' ? body.rejection_reason : undefined,
      quality_score:
        typeof body.quality_score === 'number' ? body.quality_score : undefined,
    });
    return c.json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'SUBMISSION_NOT_FOUND') {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Submission not found' } },
        404,
      );
    }
    if (message === 'SUBMISSION_NOT_PENDING') {
      return c.json(
        { error: { code: 'CONFLICT', message: 'Submission already reviewed' } },
        409,
      );
    }
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Review failed' } },
      500,
    );
  }
});

export { sectionMarketplaceSubmissions };
export default sectionMarketplaceSubmissions;
