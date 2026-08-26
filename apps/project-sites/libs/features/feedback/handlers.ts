/**
 * @module libs/features/feedback/handlers
 *
 * @description
 * User-feedback surface — the write path collects 1-5 star ratings + free-text
 * comments (from the build-progress UI / post-publish prompt), the read path
 * exposes only `status='approved'` rows for public testimonial rendering
 * (homepage social proof). Both handlers wrap their bodies in a local
 * `try/catch` that re-throws known AppErrors and returns a structured 500 for
 * everything else, tagging the caught error via `classifyError` for Sentry
 * grouping. Writes go through `dbInsert` (which never throws — a `{ error }`
 * result surfaces as an honest 500 instead of a lying 201); reads through
 * `dbQuery`. Org/user context (`c.get('orgId')` / `c.get('userId')`) is
 * stamped when present but the POST is not hard-gated on it.
 *
 * | Method | Path            | Auth   | Purpose                                        |
 * | ------ | --------------- | ------ | ---------------------------------------------- |
 * | POST   | /api/feedback   | public | Submit a 1-5 rating + optional comment          |
 * | GET    | /api/feedback   | public | List approved testimonials (newest-first, ≤50)  |
 *
 * Extracted VERBATIM from the `api.ts` monolith (route-decomposition installment
 * 13) — only the route-registration receiver changed (`api.` → `feedback.`);
 * the handler bodies are byte-for-byte unchanged. Bodies are read with a raw
 * `await c.req.json()` + defensive field reads (rating clamp, string slice)
 * rather than a Zod schema at the boundary, so there is no `schemas.ts` — the
 * moved handlers keep their original in-body validation and error envelopes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { dbInsert, dbQuery } from '../../../src/services/db.js';
import { classifyError } from '../../../src/services/retry.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const feedback = new Hono<AppContext>();

/**
 * Submit user feedback — a 1-5 star rating plus an optional free-text
 * comment and originating page URL. Persists to the `feedback` table with
 * `status='pending'` for later moderation before it can surface publicly.
 *
 * @route POST /api/feedback
 * @auth Public (no Bearer). `user_id` / `org_id` are stamped when the
 *   caller happens to have a session, else null (anonymous submission).
 *
 * @body {{ rating: number, comment?: string, page_url?: string }} —
 *   `rating` mandatory, must parse to 1-5 (else 400). `comment` capped at
 *   2000 chars, `page_url` at 500 chars; both optional → null.
 *
 * @returns 201 with `{ data: { submitted: true } }` on a successful insert.
 *
 * @remarks
 * `dbInsert` returns `{ error }` and NEVER throws (D1 errors are caught
 * internally) — a bare await would return a lying 201 while the row
 * silently dropped, so the `{ error }` result is surfaced as an honest 500
 * with the failure logged (`feedback_persist_failed`). The surrounding
 * try/catch still guards the `c.req.json()` parse + any unexpected throw,
 * re-throwing known AppErrors and classifying the rest via `classifyError`
 * for Sentry grouping. Client-facing errors never leak internal detail.
 *
 * @throws {AppError} - Re-thrown known AppErrors bubble to the global
 *   error handler. All other exceptions are caught and returned as
 *   structured 500.
 *
 * @example
 * ```bash
 * curl -X POST -H "Content-Type: application/json" \
 *   -d '{ "rating": 5, "comment": "Build was magical.",
 *         "page_url": "/site/vitos-mens-salon" }' \
 *   https://projectsites.dev/api/feedback
 * # → 201 { "data": { "submitted": true } }
 * ```
 */
feedback.post('/api/feedback', async (c) => {
  const requestId = c.get('requestId');
  try {
    const body = await c.req.json();
    const rating = Number(body.rating);
    if (!rating || rating < 1 || rating > 5) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'Rating must be 1-5', request_id: requestId } },
        400,
      );
    }
    const comment = typeof body.comment === 'string' ? body.comment.slice(0, 2000) : null;
    const pageUrl = typeof body.page_url === 'string' ? body.page_url.slice(0, 500) : null;
    const userId = c.get('userId') ?? null;
    const orgId = c.get('orgId') ?? null;

    // `dbInsert` returns `{ error }` and NEVER throws (D1 errors are caught
    // internally), so the surrounding try/catch is DEAD for a write failure — a
    // bare await here would return a lying 201 while the feedback row silently
    // dropped. Surface the drop as an honest 500 so the submitter can retry.
    const { error: feedbackErr } = await dbInsert(c.env.DB, 'feedback', {
      id: crypto.randomUUID(),
      org_id: orgId,
      user_id: userId,
      page_url: pageUrl,
      rating,
      comment,
      status: 'pending',
    });
    if (feedbackErr) {
      console.warn(
        JSON.stringify({
          level: 'error',
          service: 'api',
          route: 'POST /api/feedback',
          message: 'feedback_persist_failed',
          request_id: requestId,
          error: feedbackErr,
        }),
      );
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to submit feedback',
            request_id: requestId,
          },
        },
        500,
      );
    }

    return c.json({ data: { submitted: true } }, 201);
  } catch (err) {
    // Re-throw known error types for the global error handler
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'POST /api/feedback',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to submit feedback',
          request_id: requestId,
        },
      },
      500,
    );
  }
});

/**
 * List approved feedback newest-first for public testimonial rendering
 * (homepage social proof, "what users say" carousel, etc.). Hard-filters
 * to `status='approved'` and `deleted_at IS NULL` so unreviewed/spammy
 * submissions never reach the public surface.
 *
 * @route GET /api/feedback
 * @auth Public (no Bearer).
 *
 * @queryParam limit - Optional. Number of rows to return. Defaults to 20,
 *   capped at 50 (`Math.min(limit, 50)`). Pagination beyond 50 not yet
 *   exposed — paginate in caller by `created_at` cursor if needed.
 *
 * @returns 200 with `{ data: Array<{ id, rating, comment, page_url,
 *   created_at }> }`. No `user_id`/`org_id` exposed — privacy by default
 *   (testimonials are anonymous unless the comment itself signs).
 *
 * @remarks
 * Soft-deleted rows (`deleted_at` set) are excluded so moderators can
 * yank a published testimonial without rewriting the row. The
 * `status='pending'` filter means rows submitted via `POST /api/feedback`
 * are invisible here until promoted to `status='approved'` (manual D1
 * UPDATE or future admin UI). Sort is `created_at DESC` — newest at top.
 *
 * @throws {AppError} - Re-thrown known AppErrors bubble. All other
 *   exceptions caught and returned as structured 500 with the
 *   `error_category` classification logged.
 *
 * @example
 * ```bash
 * curl "https://projectsites.dev/api/feedback?limit=10"
 * # → { "data": [{ "id": "...", "rating": 5, "comment": "Magical!",
 * #             "page_url": "/site/vitos", "created_at": "..." }, ...] }
 * ```
 */
feedback.get('/api/feedback', async (c) => {
  const requestId = c.get('requestId');
  try {
    const limit = Math.min(Number(c.req.query('limit') || '20'), 50);
    const result = await dbQuery<{
      id: string;
      rating: number;
      comment: string;
      page_url: string;
      created_at: string;
    }>(
      c.env.DB,
      `SELECT id, rating, comment, page_url, created_at FROM feedback
       WHERE status = 'approved' AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return c.json({ data: result.data });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'GET /api/feedback',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load feedback',
          request_id: requestId,
        },
      },
      500,
    );
  }
});
