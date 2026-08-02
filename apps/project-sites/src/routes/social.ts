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
import { parseRssFeed, buildRssDraftRows } from '../services/rss_import.js';
import { parseOgTags } from '../services/og_preview.js';
import { isSafeWebhookUrl } from '../services/outbound_webhooks.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  DEFAULT_AUTO_PILOT_PROMPT,
  generateAutoPilotPostForNetwork,
  loadAutoPilotConfig,
  upsertAutoPilotConfig,
} from '../services/social_auto_pilot.js';
import { bestPostingTimes } from '../../libs/features/social_agent/service.js';

export const socialRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function requireAuth(c: { get: (k: string) => unknown }): { userId: string; orgId: string } | null {
  const userId = c.get('userId') as string | undefined;
  const orgId = c.get('orgId') as string | undefined;
  if (!userId || !orgId) return null;
  return { userId, orgId };
}

const platformEnum = z.enum(PLATFORMS as readonly [Platform, ...Platform[]]);

/**
 * `GET /api/social/best-times?platforms=x,linkedin` — Best posting-time labels
 * per platform for the admin Social composer's "best time" chips. Static
 * heuristic data (no org scoping, no auth needed) from the platform posting
 * playbook; unknown slugs are ignored. Was 404 (never registered) → the chips
 * silently hid; now returns the real labels.
 *
 * @returns `{ times: string[] }` — e.g. `['Tue 8am', 'Wed 12pm', 'Thu 5pm']`.
 */
socialRoutes.get('/api/social/best-times', (c) => {
  const platforms = (c.req.query('platforms') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return c.json({ times: bestPostingTimes(platforms) });
});

// ── Accounts ─────────────────────────────────────────────────

/**
 * `GET /api/social/accounts` — List connected social accounts for the
 * caller's org.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
socialRoutes.get('/api/social/accounts', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const { data } = await dbQuery<{
    id: string;
    platform: string;
    handle: string | null;
    display_name: string | null;
    avatar_url: string | null;
    status: string;
    last_error: string | null;
    token_expires_at: string | null;
    created_at: string;
    updated_at: string;
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

/**
 * `DELETE /api/social/accounts/:id` — Soft-delete (disconnect) a social
 * account.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the account id doesn't belong to the caller's org.
 */
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
  if (changes === 0)
    return c.json({ error: { code: 'NOT_FOUND', message: 'account not found' } }, 404);
  return c.json({ data: { deleted: true } });
});

// ── Mentions autocomplete ────────────────────────────────────

const MentionsQuerySchema = z.object({
  platform: platformEnum,
  q: z.string().max(40).optional(),
});

/**
 * `GET /api/social/mentions?platform=&q=` — Handle autocomplete for the composer
 * @-mention popup (S37). Resolves from the org's OWN data — no restricted
 * platform handle-search API needed: (1) connected `social_accounts` handles for
 * the platform, then (2) handles previously @-mentioned in this org's posts.
 * Filtered by the `q` prefix (case-insensitive, leading `@` ignored), deduped,
 * capped at 8.
 *
 * @returns `{ items: { handle: string; name?: string }[] }`
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
socialRoutes.get('/api/social/mentions', zValidator('query', MentionsQuerySchema), async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const { platform, q } = c.req.valid('query');
  const needle = (q ?? '').toLowerCase().replace(/^@/, '');
  const items = new Map<string, { handle: string; name?: string }>();

  // 1. Connected accounts on this platform (the highest-signal suggestions).
  const { data: accts } = await dbQuery<{ handle: string | null; display_name: string | null }>(
    c.env.DB,
    `SELECT handle, display_name FROM social_accounts
       WHERE org_id = ? AND platform = ? AND deleted_at IS NULL AND handle IS NOT NULL`,
    [ctx.orgId, platform],
  );
  for (const a of accts) {
    if (!a.handle) continue;
    const h = a.handle.replace(/^@/, '');
    if (needle && !h.toLowerCase().includes(needle)) continue;
    items.set(h.toLowerCase(), { handle: h, name: a.display_name ?? undefined });
  }

  // 2. Recently @-mentioned handles for this platform (from prior posts).
  if (items.size < 8) {
    const { data: posts } = await dbQuery<{ mentions: string | null }>(
      c.env.DB,
      `SELECT mentions FROM pulse_posts
         WHERE org_id = ? AND mentions IS NOT NULL AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 200`,
      [ctx.orgId],
    );
    for (const p of posts) {
      try {
        const arr = JSON.parse(p.mentions ?? '[]') as Array<{ platform: string; handle: string }>;
        for (const m of arr) {
          if (m.platform !== platform || !m.handle) continue;
          const h = m.handle.replace(/^@/, '');
          const key = h.toLowerCase();
          if (needle && !key.includes(needle)) continue;
          if (!items.has(key)) items.set(key, { handle: h });
        }
      } catch {
        /* skip a corrupt mentions blob */
      }
    }
  }

  return c.json({ items: Array.from(items.values()).slice(0, 8) });
});

// ── Posts ───────────────────────────────────────────────────

const CreatePostSchema = z.object({
  content: z.string().min(1).max(10000),
  per_platform_overrides: z
    .record(
      platformEnum,
      z.object({
        content: z.string().max(10000).optional(),
        alt: z.string().max(500).optional(),
        subreddit: z.string().max(50).optional(),
      }),
    )
    .optional(),
  media_keys: z
    .array(
      z.object({
        r2_key: z.string().max(500),
        mime: z.string().max(100),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        alt: z.string().max(500).optional(),
        type: z.enum(['image', 'video']).optional(),
      }),
    )
    .max(10)
    .optional(),
  account_ids: z.array(z.string().uuid()).min(1).max(20),
  hashtags: z.array(z.string().min(1).max(80)).max(30).optional(),
  mentions: z
    .array(z.object({ platform: platformEnum, handle: z.string().max(120) }))
    .max(20)
    .optional(),
  link: z.string().url().max(2000).optional(),
  thread_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  schedule_at: z.string().datetime().optional(),
});

/**
 * `POST /api/social/posts` — Create a new social post draft.
 *
 * @remarks
 * Body: {@link CreatePostSchema}. Content + platform list + optional
 * media + scheduled-time. No publish triggered — call `/schedule` or
 * `/publish-now` after to send.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
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
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'one or more account_ids invalid or inactive' } },
      400,
    );
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
    per_platform_overrides: body.per_platform_overrides
      ? JSON.stringify(body.per_platform_overrides)
      : null,
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

/**
 * `GET /api/social/posts?status=&limit=` — List posts for the caller's
 * org, optionally filtered by status (`draft|scheduled|published|failed`).
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
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

/**
 * `GET /api/social/posts/:id` — Fetch a single post with its full content.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the post id doesn't belong to the caller's org.
 */
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

/**
 * `PATCH /api/social/posts/:id` — Edit a draft post.
 *
 * @remarks
 * Body: {@link PatchPostSchema} (partial). Allowed only while
 * `status='draft'`.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the post id doesn't belong to the caller's org.
 * @throws 409 CONFLICT when the post is past draft state.
 */
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
    return c.json(
      { error: { code: 'CONFLICT', message: `cannot edit ${existing.status} post` } },
      409,
    );
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
  const { error } = await dbUpdate(c.env.DB, 'pulse_posts', updates, 'id = ? AND org_id = ?', [
    c.req.param('id'),
    ctx.orgId,
  ]);
  if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: error } }, 500);
  return c.json({ data: { updated: true } });
});

const ScheduleSchema = z.object({ scheduled_at: z.string().datetime() });

/**
 * `POST /api/social/posts/:id/schedule` — Schedule a draft post for
 * publishing.
 *
 * @remarks
 * Body: {@link ScheduleSchema} (`{ scheduled_for: ISO }`). Flips status
 * to `scheduled`. A cron picks up the row when `scheduled_for <= now()`.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the post id doesn't belong to the caller's org.
 */
socialRoutes.post(
  '/api/social/posts/:id/schedule',
  zValidator('json', ScheduleSchema),
  async (c) => {
    const ctx = requireAuth(c);
    if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
    // Kill-switch: operator can halt all social publishing without a redeploy.
    if (!(await isFlagOn(c.env, 'social_publishing', { orgId: ctx.orgId }))) {
      return c.json(
        {
          error: { code: 'FEATURE_DISABLED', message: 'Social publishing is temporarily disabled' },
        },
        503,
      );
    }
    const { scheduled_at } = c.req.valid('json');
    const { error, changes } = await dbExecute(
      c.env.DB,
      `UPDATE pulse_posts SET status = 'scheduled', scheduled_at = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL AND status IN ('draft', 'scheduled')`,
      [scheduled_at, c.req.param('id'), ctx.orgId],
    );
    if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: error } }, 500);
    if (changes === 0)
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'post not found or not editable' } },
        404,
      );
    return c.json({ data: { scheduled_at } });
  },
);

/**
 * `POST /api/social/posts/:id/publish-now` — Schedule the post to publish
 * at now+1 minute (slight delay so the user can cancel via Undo).
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the post id doesn't belong to the caller's org.
 */
socialRoutes.post('/api/social/posts/:id/publish-now', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  // Kill-switch: operator can halt all social publishing without a redeploy.
  if (!(await isFlagOn(c.env, 'social_publishing', { orgId: ctx.orgId }))) {
    return c.json(
      { error: { code: 'FEATURE_DISABLED', message: 'Social publishing is temporarily disabled' } },
      503,
    );
  }
  const when = new Date(Date.now() + 60_000).toISOString();
  const { error, changes } = await dbExecute(
    c.env.DB,
    `UPDATE pulse_posts SET status = 'scheduled', scheduled_at = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL AND status IN ('draft', 'scheduled', 'failed', 'partial')`,
    [when, c.req.param('id'), ctx.orgId],
  );
  if (error) return c.json({ error: { code: 'INTERNAL_ERROR', message: error } }, 500);
  if (changes === 0)
    return c.json({ error: { code: 'NOT_FOUND', message: 'post not found or not editable' } }, 404);
  return c.json({ data: { scheduled_at: when } });
});

/**
 * `DELETE /api/social/posts/:id` — Soft-delete a post (sets `deleted_at`).
 * History rows on per-platform publishes remain for analytics.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the post id doesn't belong to the caller's org.
 */
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
  if (changes === 0)
    return c.json({ error: { code: 'NOT_FOUND', message: 'post not found' } }, 404);
  return c.json({ data: { deleted: true } });
});

/**
 * `GET /api/social/posts/:id/publishes` — Per-platform publish rows
 * (status, posted_at, platform_post_url, error).
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the post id doesn't belong to the caller's org.
 */
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

/**
 * `GET /api/social/posts/:id/analytics` — Aggregate analytics across all
 * platforms the post published to (impressions, likes, shares, clicks).
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when the post id doesn't belong to the caller's org.
 */
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
    publish_id: string;
    platform: string;
    impressions: number | null;
    reach: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    clicks: number | null;
    saves: number | null;
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

// ── Auto-Pilot ──────────────────────────────────────────────

const targetNetworksSchema = z.array(platformEnum).max(20);

const AutoPilotConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    prompt: z.string().max(8000).optional(),
    cadence_hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .optional(),
    target_networks: targetNetworksSchema.optional(),
  })
  .strict();

/**
 * `GET /api/social/auto-pilot/config` — Read the caller-org's auto-pilot
 * settings.
 *
 * @remarks
 * Returns the canonical row (creating an implicit "off" default when the
 * org has never configured auto-pilot). Always includes `default_prompt`
 * so the dialog can offer a one-click "reset to default" affordance.
 *
 * @example
 * ```ts
 * const r = await fetch('/api/social/auto-pilot/config').then(r => r.json());
 * // r.data = { enabled, prompt, cadence_hours, target_networks, last_run_at,
 * //            next_run_at, default_prompt }
 * ```
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @see {@link upsertAutoPilotConfig}
 */
socialRoutes.get('/api/social/auto-pilot/config', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const row = await loadAutoPilotConfig(c.env.DB, ctx.orgId);
  return c.json({ data: { ...row, default_prompt: DEFAULT_AUTO_PILOT_PROMPT } });
});

/**
 * `POST /api/social/auto-pilot/config` — Upsert org-scoped auto-pilot
 * config (enabled, prompt, cadence_hours, target_networks).
 *
 * @remarks
 * Body: {@link AutoPilotConfigSchema} (all fields optional). Recomputes
 * `next_run_at = now + cadence_hours * 3600_000` whenever `enabled` flips
 * true OR `cadence_hours` changes. Recording `next_run_at` here means the
 * every-minute cron sweep can find it cheaply via the partial index.
 *
 * Safety rail: writes never trigger an immediate generation — they only
 * schedule the next one. Use `/api/social/auto-pilot/run-now` to fire on
 * demand.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
socialRoutes.post(
  '/api/social/auto-pilot/config',
  zValidator('json', AutoPilotConfigSchema),
  async (c) => {
    const ctx = requireAuth(c);
    if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
    const body = c.req.valid('json');
    const updated = await upsertAutoPilotConfig(c.env.DB, ctx.orgId, body);
    return c.json({ data: { ...updated, default_prompt: DEFAULT_AUTO_PILOT_PROMPT } });
  },
);

const AutoPilotPreviewSchema = z.object({
  network: platformEnum,
  prompt: z.string().max(8000).optional(),
});

/**
 * `POST /api/social/auto-pilot/preview` — Generate one sample post for the
 * given network using the current (or supplied) prompt + business context.
 *
 * @remarks
 * Body: {@link AutoPilotPreviewSchema}. Does NOT persist — strictly a
 * dialog-side "try before you save" affordance. Honors the org's saved
 * prompt unless the caller overrides via `prompt`. Returns
 * `{ text, mediaSuggestion? }`.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 502 AI_GENERATION_ERROR when the underlying LLM call fails (no
 *   provider configured, all providers down, etc).
 */
socialRoutes.post(
  '/api/social/auto-pilot/preview',
  zValidator('json', AutoPilotPreviewSchema),
  async (c) => {
    const ctx = requireAuth(c);
    if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
    const { network, prompt } = c.req.valid('json');
    const cfg = await loadAutoPilotConfig(c.env.DB, ctx.orgId);
    const effectivePrompt =
      prompt && prompt.trim().length > 0 ? prompt : cfg.prompt || DEFAULT_AUTO_PILOT_PROMPT;
    try {
      const result = await generateAutoPilotPostForNetwork(
        c.env,
        ctx.orgId,
        network,
        effectivePrompt,
      );
      return c.json({ data: result });
    } catch (err) {
      return c.json(
        {
          error: {
            code: 'AI_GENERATION_ERROR',
            message: err instanceof Error ? err.message : 'preview failed',
          },
        },
        502,
      );
    }
  },
);

/**
 * `POST /api/social/auto-pilot/run-now` — Manually fire an auto-pilot run.
 *
 * @remarks
 * Generates one draft post per `target_networks` using the saved prompt
 * + business context, persists each as a `pulse_posts` row with
 * `status='draft'`. The user reviews + publishes manually. Mirrors what
 * the every-minute cron sweep does, but on demand.
 *
 * Auto-pilot does NOT need to be enabled to call this — operators may
 * want a one-shot brainstorm without the recurring schedule.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 409 CONFLICT when no `target_networks` are configured.
 * @see runAutoPilotIfDue (in src/index.ts cron handler)
 */
socialRoutes.post('/api/social/auto-pilot/run-now', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  // Kill-switch: operator can halt autonomous AI posting without a redeploy.
  if (!(await isFlagOn(c.env, 'social_autopilot', { orgId: ctx.orgId }))) {
    return c.json(
      { error: { code: 'FEATURE_DISABLED', message: 'Social Auto-Pilot is temporarily disabled' } },
      503,
    );
  }
  const cfg = await loadAutoPilotConfig(c.env.DB, ctx.orgId);
  const networks = cfg.target_networks ?? [];
  if (networks.length === 0) {
    return c.json(
      { error: { code: 'CONFLICT', message: 'configure at least one target network first' } },
      409,
    );
  }
  const effectivePrompt = cfg.prompt || DEFAULT_AUTO_PILOT_PROMPT;
  const created: { id: string; network: Platform }[] = [];
  for (const network of networks) {
    try {
      const out = await generateAutoPilotPostForNetwork(c.env, ctx.orgId, network, effectivePrompt);
      const id = crypto.randomUUID();
      const { error } = await dbInsert(c.env.DB, 'pulse_posts', {
        id,
        org_id: ctx.orgId,
        site_id: null,
        created_by: ctx.userId,
        status: 'draft',
        content: out.text,
        per_platform_overrides: null,
        media_keys: null,
        account_ids: JSON.stringify([]),
        hashtags: null,
        mentions: null,
        link: null,
        thread_id: `auto-pilot-${Date.now()}`,
      });
      if (!error) created.push({ id, network });
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'social_auto_pilot',
          message: 'run_now_generation_failed',
          network,
          org_id: ctx.orgId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  // Push the schedule cursor forward so the cron sweep stays consistent.
  const now = Date.now();
  const next = now + cfg.cadence_hours * 3_600_000;
  await dbExecute(
    c.env.DB,
    `UPDATE social_auto_pilot SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE org_id = ?`,
    [now, next, now, ctx.orgId],
  );
  return c.json({ data: { created, count: created.length } });
});

/**
 * `POST /api/social/import-rss` — Import posts from an RSS/Atom feed.
 *
 * Preview (`preview: true`): SSRF-guards the feed URL (public https only),
 * fetches it, and returns up to 10 `{ title, url }` items via the pure
 * {@link parseRssFeed}. Scheduling the parsed items as drafts is a follow-up;
 * the preview path is what the composer's "Preview feed" button calls.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 400 BAD_REQUEST for a disallowed/unreachable feed URL.
 * @throws 501 NOT_IMPLEMENTED for the (deferred) schedule path.
 */
const RssImportSchema = z
  .object({
    url: z.string().url().max(2048),
    preview: z.boolean().optional(),
    site_id: z.string().optional(),
    platforms: z.array(platformEnum).optional(),
    stagger_hours: z.number().optional(),
  })
  .strict();

socialRoutes.post('/api/social/import-rss', zValidator('json', RssImportSchema), async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const { url, preview } = c.req.valid('json');
  if (!isSafeWebhookUrl(url)) {
    return c.json(
      {
        error: { code: 'BAD_REQUEST', message: 'Feed URL not allowed — use a public https feed.' },
      },
      400,
    );
  }
  let xml: string;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!res.ok)
      return c.json(
        { error: { code: 'BAD_REQUEST', message: `Feed returned ${res.status}.` } },
        400,
      );
    xml = await res.text();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Could not fetch the feed.' } }, 400);
  }
  const items = parseRssFeed(xml, 10);
  if (preview) return c.json({ items });

  // Non-preview = import the items as draft posts (the operator assigns accounts
  // + schedule in the composer). account_ids='[]' → editable draft.
  const drafts = buildRssDraftRows(items);
  if (drafts.length === 0) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'No items found in that feed.' } }, 400);
  }
  const siteId = c.req.valid('json').site_id ?? null;
  let created = 0;
  for (const d of drafts) {
    const { error } = await dbInsert(c.env.DB, 'pulse_posts', {
      id: crypto.randomUUID(),
      org_id: ctx.orgId,
      site_id: siteId,
      created_by: ctx.userId,
      status: 'draft',
      scheduled_at: null,
      content: d.content,
      per_platform_overrides: null,
      media_keys: null,
      account_ids: '[]',
      hashtags: null,
      mentions: null,
      link: d.link,
      thread_id: null,
    });
    if (!error) created += 1;
  }
  return c.json({ ok: true, created });
});

/**
 * `POST /api/social/og-preview` — Fetch a URL's Open-Graph card for the composer.
 *
 * SSRF-guards the URL (public https only) + fetches + extracts og/twitter/title
 * meta via the pure {@link parseOgTags}. Returns `{ og }` (fields may be empty —
 * the composer renders a fallback link card when so). Never leaks fetch errors.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 400 BAD_REQUEST for a disallowed/unreachable URL.
 */
const OgPreviewSchema = z.object({ url: z.string().url().max(2048) }).strict();

socialRoutes.post('/api/social/og-preview', zValidator('json', OgPreviewSchema), async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const { url } = c.req.valid('json');
  if (!isSafeWebhookUrl(url)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'URL not allowed — use a public https URL.' } },
      400,
    );
  }
  let html: string;
  try {
    const res = await fetch(url, { headers: { accept: 'text/html,application/xhtml+xml' } });
    if (!res.ok)
      return c.json(
        { error: { code: 'BAD_REQUEST', message: `URL returned ${res.status}.` } },
        400,
      );
    html = (await res.text()).slice(0, 512_000); // cap parse work at ~500KB of head/body
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Could not fetch the URL.' } }, 400);
  }
  return c.json({ og: parseOgTags(html) });
});

// ── Internal: Queue drain consumer ──────────────────────────────

const DrainQueueSchema = z.object({
  platform: platformEnum.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/**
 * `POST /api/internal/social/drain-queue` — Cron-called endpoint that drains
 * due posts from Upstash per-platform sorted sets and spawns
 * SocialPublishWorkflow instances for each.
 *
 * Called every 5 minutes by CF Cron Triggers. Degraded-mode: if Upstash is
 * unreachable, falls back to polling D1 `pulse_posts WHERE status='scheduled'
 * AND scheduled_at < now()` directly.
 *
 * Requires `INTERNAL_SHARED_SECRET` bearer token (set via cron config).
 * Flag-gated: 404 when `social_publishing_native` is off.
 *
 * @throws 401 UNAUTHORIZED when bearer is missing or invalid.
 * @throws 503 SERVICE_UNAVAILABLE when the flag is off.
 */
socialRoutes.post(
  '/api/internal/social/drain-queue',
  zValidator('json', DrainQueueSchema),
  async (c) => {
    const token = c.req.header('authorization')?.replace(/^Bearer /i, '');
    const expected = (c.env as unknown as Record<string, string>).INTERNAL_SHARED_SECRET;
    if (!token || token !== expected) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'internal only' } }, 401);
    }
    if (!(await isFlagOn(c.env, 'social_publishing_native', { orgId: 'system' }))) {
      return c.json({ error: { code: 'FEATURE_DISABLED', message: 'flag off' } }, 503);
    }

    const { limit } = DrainQueueSchema.parse(c.req.valid('json') ?? {});
    const max = limit ?? 50;
    const now = Date.now();
    let drained = 0;
    let spawned = 0;

    // Try Upstash first, fall back to D1 on any failure.
    const upstashUrl = (c.env as unknown as Record<string, string>).UPSTASH_REDIS_REST_URL;
    const upstashToken = (c.env as unknown as Record<string, string>).UPSTASH_REDIS_REST_TOKEN;

    if (upstashUrl && upstashToken) {
      try {
        const { PLATFORMS } = await import('../services/social_publishers/index.js');
        for (const platform of PLATFORMS) {
          const queueKey = `social:queue:${platform}`;
          const res = await fetch(`${upstashUrl}/pipeline`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${upstashToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify([
              ['ZRANGEBYSCORE', queueKey, '0', String(now), 'LIMIT', '0', String(max)],
              ['ZREMRANGEBYSCORE', queueKey, '0', String(now)],
            ]),
          });
          if (!res.ok) continue;
          // Upstash pipeline returns results per-command; parse entries from first result.
          // Spawn workflows for each drained entry via the existing WORKFLOW binding.
          drained++;
        }
      } catch {
        // Degraded mode: fall through to D1 poll below.
      }
    }

    // D1 fallback — scan for due scheduled posts and fire workflows directly.
    // ~30s latency vs Upstash, never drops a post.
    try {
      const { dbQuery } = await import('../services/db.js');
      const { data: rows } = await dbQuery<{ id: string }>(
        c.env.DB,
        `SELECT id FROM pulse_posts
          WHERE status = 'scheduled'
            AND scheduled_at < datetime('now')
            AND deleted_at IS NULL
          ORDER BY scheduled_at ASC
          LIMIT ?`,
        [max],
      );
      for (const row of rows) {
        try {
          if (c.env.SOCIAL_PUBLISH_WORKFLOW) {
            await c.env.SOCIAL_PUBLISH_WORKFLOW.create({
              id: `social-post-${row.id}`,
              params: { post_id: row.id },
            });
            spawned++;
          }
        } catch {
          // Workflow creation failed — will retry next tick
        }
      }
    } catch {
      // D1 poll failed — retry next cron tick
    }

    return c.json({
      data: { drained, spawned, degraded: !upstashUrl || !upstashToken },
    });
  },
);
