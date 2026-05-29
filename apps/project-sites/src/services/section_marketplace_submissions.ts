/**
 * @module services/section_marketplace_submissions
 * @description Creator submission flow for the existing Section Marketplace
 *              (IDEAS-50 #40 — extends the 30-seed alpha module).
 *
 * The existing `section_marketplace` table (migration 0506) holds 5 industries
 * × 6 slots = 30 curated seeds authored by `author='projectsites'`. Migration
 * 0520 adds `submission_status`, `creator_user_id`, `price_cents`,
 * `submitted_at`, `reviewed_at`, `reviewer_user_id`, `rejection_reason` so
 * community creators can submit new section variants for Brian's curation.
 *
 * This file is intentionally separate from `services/section_marketplace.ts`
 * so the existing read-only catalog code is not modified (avoids merge conflicts
 * with concurrent sessions and respects the OWNED FILES boundary).
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { Env } from '../types/env.js';
import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from './db.js';

/** UUID helper — Workers runtime always exposes `crypto.randomUUID()`. */
function uuid(): string {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// Submission schema.
// ─────────────────────────────────────────────────────────────────────────────

export const SectionIndustrySchema = z.enum(['nonprofit', 'restaurant', 'lawyer', 'salon', 'medical']);
export const SectionSlotSchema = z.enum(['hero', 'services', 'testimonials', 'donor-wall', 'faq', 'cta']);
export const SectionSubmissionStatusSchema = z.enum(['pending', 'approved', 'rejected']);

export const SectionSubmissionSchema = z.object({
  industry: SectionIndustrySchema,
  name: z.string().min(3).max(120),
  slot: SectionSlotSchema,
  html_template: z.string().min(20).max(50_000),
  css_template: z.string().min(0).max(50_000),
  data_schema: z.record(z.string(), z.unknown()).default({}),
  price_cents: z.number().int().min(0).max(10_000), // $0 - $100 per section
});

export type SectionSubmission = z.infer<typeof SectionSubmissionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Submission write path.
// ─────────────────────────────────────────────────────────────────────────────

export interface SectionSubmitResult {
  ok: true;
  id: string;
  submission_status: 'pending';
}

/**
 * Community creator submits a new section variant.
 *
 * Submission lands as `submission_status='pending'` — invisible to the public
 * catalog reads in `services/section_marketplace.ts` until Brian (or another
 * curator) approves via the `reviewSubmission` admin call below.
 *
 * @example
 *   await submitSection(env, {
 *     industry: 'nonprofit',
 *     name: 'Volunteer Heatmap',
 *     slot: 'services',
 *     html_template: '<section ...>{{volunteers}}</section>',
 *     css_template: 'section { ... }',
 *     data_schema: { type: 'object', required: ['volunteers'] },
 *     price_cents: 1500,
 *   }, 'usr_creator_42');
 */
export async function submitSection(
  env: Env,
  submission: SectionSubmission,
  creatorUserId: string,
): Promise<SectionSubmitResult> {
  const id = `sec_${uuid()}`;
  const now = new Date().toISOString();

  const { error } = await dbInsert(env.DB, 'section_marketplace', {
    id,
    industry: submission.industry,
    name: submission.name,
    slot: submission.slot,
    html_template: submission.html_template,
    css_template: submission.css_template,
    data_schema: JSON.stringify(submission.data_schema),
    quality_score: 0.0, // unrated until reviewer assigns
    author: creatorUserId,
    creator_user_id: creatorUserId,
    fork_count: 0,
    price_cents: submission.price_cents,
    submission_status: 'pending',
    submitted_at: now,
  });
  if (error) throw new Error(`DB_INSERT_FAILED: ${error}`);

  return { ok: true, id, submission_status: 'pending' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin curation path.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewSubmissionInput {
  id: string;
  decision: 'approve' | 'reject';
  reviewer_user_id: string;
  rejection_reason?: string;
  /** Optional quality score 0-10 assigned at approval time. */
  quality_score?: number;
}

export interface ReviewSubmissionResult {
  ok: true;
  id: string;
  submission_status: 'approved' | 'rejected';
}

/**
 * Brian (or other curator) reviews a pending submission.
 *
 * - `approve`  → `submission_status='approved'`, sets `quality_score` (default 5.0),
 *                makes the variant visible in the public catalog.
 * - `reject`   → `submission_status='rejected'`, records `rejection_reason` so the
 *                creator gets actionable feedback.
 *
 * @throws Error('SUBMISSION_NOT_FOUND') when id doesn't resolve.
 * @throws Error('SUBMISSION_NOT_PENDING') when already approved/rejected.
 */
export async function reviewSubmission(
  env: Env,
  input: ReviewSubmissionInput,
): Promise<ReviewSubmissionResult> {
  const row = await dbQueryOne<{ id: string; submission_status: string }>(
    env.DB,
    'SELECT id, submission_status FROM section_marketplace WHERE id = ? AND deleted_at IS NULL',
    [input.id],
  );
  if (!row) throw new Error('SUBMISSION_NOT_FOUND');
  if (row.submission_status !== 'pending') throw new Error('SUBMISSION_NOT_PENDING');

  if (input.decision === 'approve') {
    await dbUpdate(
      env.DB,
      'section_marketplace',
      {
        submission_status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewer_user_id: input.reviewer_user_id,
        quality_score: input.quality_score ?? 5.0,
      },
      'id = ?',
      [input.id],
    );
    return { ok: true, id: input.id, submission_status: 'approved' };
  }

  await dbUpdate(
    env.DB,
    'section_marketplace',
    {
      submission_status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewer_user_id: input.reviewer_user_id,
      rejection_reason: input.rejection_reason ?? null,
    },
    'id = ?',
    [input.id],
  );
  return { ok: true, id: input.id, submission_status: 'rejected' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin queue read.
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingSubmissionRow {
  id: string;
  industry: string;
  name: string;
  slot: string;
  price_cents: number;
  creator_user_id: string | null;
  submitted_at: string | null;
}

/** List pending submissions ordered oldest-first (FIFO curation). */
export async function listPendingSubmissions(env: Env, limit = 100): Promise<PendingSubmissionRow[]> {
  const { data } = await dbQuery<PendingSubmissionRow>(
    env.DB,
    `SELECT id, industry, name, slot, price_cents, creator_user_id, submitted_at
       FROM section_marketplace
       WHERE submission_status = 'pending' AND deleted_at IS NULL
       ORDER BY submitted_at ASC NULLS LAST
       LIMIT ?`,
    [Math.min(limit, 500)],
  );
  return data ?? [];
}
