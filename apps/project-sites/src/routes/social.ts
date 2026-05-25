/**
 * @module routes/social
 * @description Pulse Social — accounts + posts CRUD + publish controls.
 *
 *   GET    /api/social/accounts                  — list connected accounts
 *   DELETE /api/social/accounts/:id              — soft-delete (disconnect)
 *   GET    /api/social/posts?status=&limit=      — list posts
 *   POST   /api/social/posts                     — create draft
 *   PATCH  /api/social/posts/:id                 — edit draft
 *   POST   /api/social/posts/:id/schedule        — schedule
 *   POST   /api/social/posts/:id/publish-now     — schedule now()+1min
 *   DELETE /api/social/posts/:id                 — soft delete
 *   GET    /api/social/posts/:id/publishes       — per-platform publish rows
 *   GET    /api/social/posts/:id/analytics       — aggregate analytics
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import { PLATFORMS, type Platform } from '../services/social_publishers/index.js';

export const socialRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function requireAuth(c: { get: (k: string) => unknown }): { userId: string; orgId: string } | null {
  const userId = c.get('userId') as string | undefined;
  const orgId = c.get('orgId') as string | undefined;
  if (!userId || !orgId) return null;
  return { userId, orgId };
}

const platformEnum = z.enum(PLATFORMS as readonly [Platform, ...Platform[]]);

// ── Accounts ─────────────────────────────────────────────────

socialRoutes.get('/api/social/accounts', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const { data } = await dbQuery<{
    id: string; platform: string; handle: string | null; display_name: string | null;
    avatar_url: string | null; status: string; last_error: string | null; token_expires_at: string | null;
    created_at: string; updated_at: string;
  }>(
    c.env.DB,
    `SELECT id, platform, handle, display_name, avatar_url, status, last_error,
            token_expires_at, created_at, updated_at
       FROM social_accounts WHERE org_id = ? AND deleted_at IS NULL
       ORDER BY platform, created_at DESC`,
    [ctx.orgId],
  );
  return c.json({ data });
});

socialRoutes.delete('/api/social/accounts/:id', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const { error, changes } = await dbExecute(
    c.env.DB,
    `UPDATE social_accounts SET deleted_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [c.req.param('id'), ctx.orgId],
  );
  if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: error } }, 500);
  if (changes === 0) return c.json({ error: { code: 'NOT_FOUND', message: 'account not found' } }, 404);
  return c.json({ data: { deleted: true } });
});

// ── Posts ───────────────────────────────────────────────────

const CreatePostSchema = z.object({
  content: z.string().min(1).max(10000),
  per_platform_overrides: z.record(platformEnum, z.object({
    content: z.string().max(10000).optional(),
    alt: z.string().max(500).optional(),
    subreddit: z.string().max(50).optional(),
  })).optional(),
  media_keys: z.array(z.object({
    r2_key: z.string().max(500),
    mime: z.string().max(100),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    alt: z.string().max(500).optional(),
    type: z.enum(['image', 'video']).optional(),
  })).max(10).optional(),
  account_ids: z.array(z.string().uuid()).min(1).max(20),
  hashtags: z.array(z.string().min(1).max(80)).max(30).optional(),
  mentions: z.array(z.object({ platform: platformEnum, handle: z.string().max(120) })).max(20).optional(),
  link: z.string().url().max(2000).optional(),
  thread_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  schedule_at: z.string().datetime().optional(),
});

socialRoutes.post('/api/social/posts', zValidator('json', CreatePostSchema), async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const body = c.req.valid('json');

  // Validate that all account_ids belong to the org
  const placeholders = body.account_ids.map(() => '?').join(',');
  const { data: accounts } = await dbQuery<{ id: string }>(
    c.env.DB,
    `SELECT id FROM social_accounts
       WHERE id IN (${placeholders}) AND org_id = ? AND deleted_at IS NULL AND status = 'active'`,
    [...body.account_ids, ctx.orgId],
  );
  if (accounts.length !== body.account_ids.length) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'one or more account_ids invalid or inactive' } }, 400);
  }

  const id = crypto.randomUUID();
  const status = body.schedule_at ? 'scheduled' : 'draft';
  const { error } = await dbInsert(c.env.DB, 'pulse_posts', {
    id,
    org_id: ctx.orgId,
    site_id: body.site_id ?? null,
    created_by: ctx.userId,
    status,
    scheduled_at: body.schedule_at ?? null,
    content: body.content,
    per_platform_overrides: body.per_platform_overrides ? JSON.stringify(body.per_platform_overrides) : null,
    media_keys: body.media_keys ? JSON.stringify(body.media_keys) : null,
    account_ids: JSON.stringify(body.account_ids),
    hashtags: body.hashtags ? JSON.stringify(body.hashtags) : null,
    mentions: body.mentions ? JSON.stringify(body.mentions) : null,
    link: body.link ?? null,
    thread_id: body.thread_id ?? null,
  });
  if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: error } }, 500);
  return c.json({ data: { id, status } }, 201);
});

socialRoutes.get('/api/social/posts', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const params: unknown[] = [ctx.orgId];
  let where = 'org_id = ? AND deleted_at IS NULL';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, status, scheduled_at, published_at, content, account_ids, hashtags, link,
            site_id, created_at, updated_at
       FROM pulse_posts WHERE ${where}
       ORDER BY COALESCE(scheduled_at, updated_at) DESC
       LIMIT ?`,
    [...params, limit],
  );
  return c.json({ data });
});

socialRoutes.get('/api/social/posts/:id', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const row = await dbQueryOne(
    c.env.DB,
    `SELECT * FROM pulse_posts WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [c.req.param('id'), ctx.orgId],
  );
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'post not found' } }, 404);
  return c.json({ data: row });
});

const PatchPostSchema = CreatePostSchema.partial();

socialRoutes.patch('/api/social/posts/:id', zValidator('json', PatchPostSchema), async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const body = c.req.valid('json');
  const existing = await dbQueryOne<{ status: string }>(
    c.env.DB,
    `SELECT status FROM pulse_posts WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [c.req.param('id'), ctx.orgId],
  );
  if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: 'post not found' } }, 404);
  if (existing.status === 'published' || existing.status === 'publishing') {
    return c.json({ error: { code: 'CONFLICT', message: `cannot edit ${existing.status} post` } }, 409);
  }
  const updates: Record<string, unknown> = {};
  if (body.content !== undefined) updates.content = body.content;
  if (body.per_platform_overrides !== undefined)
    updates.per_platform_overrides = JSON.stringify(body.per_platform_overrides);
  if (body.media_keys !== undefined) updates.media_keys = JSON.stringify(body.media_keys);
  if (body.account_ids !== undefined) updates.account_ids = JSON.stringify(body.account_ids);
  if (body.hashtags !== undefined) updates.hashtags = JSON.stringify(body.hashtags);
  if (body.mentions !== undefined) updates.mentions = JSON.stringify(body.mentions);
  if (body.link !== undefined) updates.link = body.link;
  if (body.schedule_at !== undefined) {
    updates.scheduled_at = body.schedule_at;
    updates.status = body.schedule_at ? 'scheduled' : 'draft';
  }
  if (Object.keys(updates).length === 0) return c.json({ data: { updated: false } });
  const { error } = await dbUpdate(c.env.DB, 'pulse_posts', updates, 'id = ? AND org_id = ?', [c.req.param('id'), ctx.orgId]);
  if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: error } }, 500);
  return c.json({ data: { updated: true } });
});

const ScheduleSchema = z.object({ scheduled_at: z.string().datetime() });

socialRoutes.post('/api/social/posts/:id/schedule', zValidator('json', ScheduleSchema), async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const { scheduled_at } = c.req.valid('json');
  const { error, changes } = await dbExecute(
    c.env.DB,
    `UPDATE pulse_posts SET status = 'scheduled', scheduled_at = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL AND status IN ('draft', 'scheduled')`,
    [scheduled_at, c.req.param('id'), ctx.orgId],
  );
  if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: error } }, 500);
  if (changes === 0) return c.json({ error: { code: 'NOT_FOUND', message: 'post not found or not editable' } }, 404);
  return c.json({ data: { scheduled_at } });
});

socialRoutes.post('/api/social/posts/:id/publish-now', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const when = new Date(Date.now() + 60_000).toISOString();
  const { error, changes } = await dbExecute(
    c.env.DB,
    `UPDATE pulse_posts SET status = 'scheduled', scheduled_at = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL AND status IN ('draft', 'scheduled', 'failed', 'partial')`,
    [when, c.req.param('id'), ctx.orgId],
  );
  if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: error } }, 500);
  if (changes === 0) return c.json({ error: { code: 'NOT_FOUND', message: 'post not found or not editable' } }, 404);
  return c.json({ data: { scheduled_at: when } });
});

socialRoutes.delete('/api/social/posts/:id', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const { error, changes } = await dbExecute(
    c.env.DB,
    `UPDATE pulse_posts SET deleted_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [c.req.param('id'), ctx.orgId],
  );
  if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: error } }, 500);
  if (changes === 0) return c.json({ error: { code: 'NOT_FOUND', message: 'post not found' } }, 404);
  return c.json({ data: { deleted: true } });
});

socialRoutes.get('/api/social/posts/:id/publishes', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const post = await dbQueryOne<{ id: string }>(
    c.env.DB,
    `SELECT id FROM pulse_posts WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [c.req.param('id'), ctx.orgId],
  );
  if (!post) return c.json({ error: { code: 'NOT_FOUND', message: 'post not found' } }, 404);
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT sp.id, sp.account_id, sp.platform, sp.status, sp.external_post_id, sp.external_url,
            sp.attempts, sp.last_attempt_at, sp.last_error, sp.succeeded_at,
            sa.handle, sa.display_name, sa.avatar_url
       FROM social_publishes sp
       LEFT JOIN social_accounts sa ON sa.id = sp.account_id
      WHERE sp.post_id = ?
      ORDER BY sp.platform`,
    [c.req.param('id')],
  );
  return c.json({ data });
});

socialRoutes.get('/api/social/posts/:id/analytics', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const post = await dbQueryOne<{ id: string }>(
    c.env.DB,
    `SELECT id FROM pulse_posts WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [c.req.param('id'), ctx.orgId],
  );
  if (!post) return c.json({ error: { code: 'NOT_FOUND', message: 'post not found' } }, 404);
  // Aggregate the most recent snapshot per publish.
  const { data } = await dbQuery<{
    publish_id: string; platform: string; impressions: number | null; reach: number | null;
    likes: number | null; comments: number | null; shares: number | null; clicks: number | null; saves: number | null;
    captured_at: string;
  }>(
    c.env.DB,
    `SELECT sp.id AS publish_id, sp.platform, s.impressions, s.reach, s.likes,
            s.comments, s.shares, s.clicks, s.saves, s.captured_at
       FROM social_publishes sp
       LEFT JOIN (
         SELECT publish_id, impressions, reach, likes, comments, shares, clicks, saves, captured_at,
                ROW_NUMBER() OVER (PARTITION BY publish_id ORDER BY captured_at DESC) AS rn
           FROM social_analytics_snapshots
       ) s ON s.publish_id = sp.id AND s.rn = 1
      WHERE sp.post_id = ? AND sp.status = 'succeeded'`,
    [c.req.param('id')],
  );
  const totals = data.reduce(
    (a, r) => ({
      impressions: a.impressions + (r.impressions ?? 0),
      reach: a.reach + (r.reach ?? 0),
      likes: a.likes + (r.likes ?? 0),
      comments: a.comments + (r.comments ?? 0),
      shares: a.shares + (r.shares ?? 0),
      clicks: a.clicks + (r.clicks ?? 0),
      saves: a.saves + (r.saves ?? 0),
    }),
    { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, clicks: 0, saves: 0 },
  );
  return c.json({ data: { per_platform: data, totals } });
});
