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
import { parseRssFeed } from '../services/rss_import.js';
import { isSafeWebhookUrl } from '../services/outbound_webhooks.js';
import {
  DEFAULT_AUTO_PILOT_PROMPT,
  generateAutoPilotPostForNetwork,
  loadAutoPilotConfig,
  upsertAutoPilotConfig,
} from '../services/social_auto_pilot.js';

export const socialRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function requireAuth(c: { get: (k: string) => unknown }): { userId: string; orgId: string } | null {
  const userId = c.get('userId') as string | undefined;
  const orgId = c.get('orgId') as string | undefined;
  if (!userId || !orgId) return null;
  return { userId, orgId };
}

const platformEnum = z.enum(PLATFORMS as readonly [Platform, ...Platform[]]);

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
  if (changes === 0) return c.json({ error: { code: 'NOT_FOUND', message: 'post not found' } }, 404);
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

// ── Auto-Pilot ──────────────────────────────────────────────

const targetNetworksSchema = z.array(platformEnum).max(20);

const AutoPilotConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    prompt: z.string().max(8000).optional(),
    cadence_hours: z.number().int().min(1).max(24 * 30).optional(),
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
    const effectivePrompt = prompt && prompt.trim().length > 0 ? prompt : cfg.prompt || DEFAULT_AUTO_PILOT_PROMPT;
    try {
      const result = await generateAutoPilotPostForNetwork(c.env, ctx.orgId, network, effectivePrompt);
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
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Feed URL not allowed — use a public https feed.' } }, 400);
  }
  let xml: string;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!res.ok) return c.json({ error: { code: 'BAD_REQUEST', message: `Feed returned ${res.status}.` } }, 400);
    xml = await res.text();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Could not fetch the feed.' } }, 400);
  }
  const items = parseRssFeed(xml, 10);
  if (preview) return c.json({ items });
  return c.json(
    { error: { code: 'NOT_IMPLEMENTED', message: 'Scheduling from RSS is coming soon — preview works today.' } },
    501,
  );
});
