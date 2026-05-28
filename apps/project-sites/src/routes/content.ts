/**
 * @module routes/content
 * @description Content Freshness API routes — feature #16.
 *
 * Routes:
 *   GET  /api/content/freshness            — list drafts (paginated)
 *   GET  /api/content/freshness/:draftId   — single draft detail
 *   POST /api/content/freshness/approve/:draftId — publish draft to R2
 *   POST /api/content/freshness/reject/:draftId  — soft-reject draft
 *   POST /api/content/freshness/trigger    — manually trigger cron scan
 *
 * All routes require a valid session (auth middleware applied at mount).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import { publishRewriteDraft, scheduledContentFreshness } from '../services/content_freshness.js';

const content = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── List drafts ─────────────────────────────────────────────────────

content.get('/freshness', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const orgId = c.get('orgId');
  const status = c.req.query('status') ?? 'pending';
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = 25;
  const offset = (page - 1) * limit;

  const { data } = await dbQuery<{
    id: string;
    site_id: string;
    section_key: string;
    dwell_seconds_avg: number;
    idle_days: number;
    status: string;
    ai_model: string;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, site_id, section_key, dwell_seconds_avg, idle_days, status, ai_model, created_at
     FROM content_rewrite_drafts
     WHERE org_id = ? AND status = ? AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [orgId ?? '', status, limit, offset],
  );

  const countRow = await dbQueryOne<{ cnt: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS cnt FROM content_rewrite_drafts WHERE org_id = ? AND status = ? AND deleted_at IS NULL',
    [orgId ?? '', status],
  );

  return c.json({ drafts: data, total: countRow?.cnt ?? 0, page, limit });
});

// ─── Single draft ─────────────────────────────────────────────────────

content.get('/freshness/:draftId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { draftId } = c.req.param();
  const orgId = c.get('orgId');

  const draft = await dbQueryOne<{
    id: string;
    site_id: string;
    section_key: string;
    section_html_orig: string;
    section_html_draft: string;
    dwell_seconds_avg: number;
    idle_days: number;
    status: string;
    task_inbox_id: string | null;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, site_id, section_key, section_html_orig, section_html_draft,
            dwell_seconds_avg, idle_days, status, task_inbox_id, created_at
     FROM content_rewrite_drafts
     WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [draftId, orgId ?? ''],
  );

  if (!draft) return c.json({ error: { code: 'NOT_FOUND', message: 'Draft not found' } }, 404);

  return c.json({ draft });
});

// ─── Approve + publish ────────────────────────────────────────────────

content.post('/freshness/approve/:draftId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { draftId } = c.req.param();

  const result = await publishRewriteDraft(c.env, draftId, userId);

  if (!result.ok) {
    return c.json({ error: { code: 'BAD_REQUEST', message: result.error ?? 'Publish failed' } }, 400);
  }

  return c.json({ ok: true, draftId, published: true });
});

// ─── Reject ───────────────────────────────────────────────────────────

content.post('/freshness/reject/:draftId', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  const { draftId } = c.req.param();
  const orgId = c.get('orgId');

  const draft = await dbQueryOne<{ id: string; status: string }>(
    c.env.DB,
    'SELECT id, status FROM content_rewrite_drafts WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [draftId, orgId ?? ''],
  );

  if (!draft) return c.json({ error: { code: 'NOT_FOUND', message: 'Draft not found' } }, 404);
  if (draft.status !== 'pending') {
    return c.json({ error: { code: 'BAD_REQUEST', message: `Draft already ${draft.status}` } }, 400);
  }

  await dbUpdate(c.env.DB, 'content_rewrite_drafts', { status: 'rejected' }, 'id = ?', [draftId]);

  return c.json({ ok: true, draftId, rejected: true });
});

// ─── Manual trigger ───────────────────────────────────────────────────

content.post('/freshness/trigger', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

  // Fire-and-forget — don't await the full scan during the HTTP request
  c.executionCtx.waitUntil(scheduledContentFreshness(c.env));

  return c.json({ ok: true, message: 'Content freshness scan triggered' });
});

export { content as contentRoutes };
