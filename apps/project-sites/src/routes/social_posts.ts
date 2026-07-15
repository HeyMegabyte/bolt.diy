/**
 * @module routes/social_posts
 * @description Native Social — post CRUD + publish + schedule endpoints (Tier 1).
 *
 *   POST   /api/social/:siteId/posts/publish    — instant publish (enqueue to Upstash)
 *   POST   /api/social/:siteId/posts/schedule   — schedule for future (spawn workflow)
 *   POST   /api/social/:siteId/posts/generate   — AI-generate per-platform variants
 *   GET    /api/social/:siteId/posting-times     — optimal posting times per platform
 *
 * Flag-gated behind `social_publishing_native`. All routes 404 when flag is off.
 * Uses the Upstash queue enqueuer (social_queue_enqueuer.ts) for instant posts
 * and CF Workflows v2 (SOCIAL_PUBLISH_WORKFLOW) for scheduled posts.
 *
 * @see ../services/social_queue_enqueuer.ts
 * @see ../workflows/social-publish.ts
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { dbInsert } from '../services/db.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { PLATFORMS, type Platform, PLATFORM_CHAR_LIMITS } from '../services/social_publishers/index.js';
import { buildEnqueueCommands } from '../services/social_queue_enqueuer.js';
// import { loadAutoPilotConfig, generateAutoPilotPostForNetwork } from '../services/social_auto_pilot.js';

export const socialPostRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function requireAuth(c: { get: (k: string) => unknown }): { userId: string; orgId: string } | null {
  const userId = c.get('userId') as string | undefined;
  const orgId = c.get('orgId') as string | undefined;
  if (!userId || !orgId) return null;
  return { userId, orgId };
}

const platformEnum = z.enum(PLATFORMS as readonly [Platform, ...Platform[]]);

// ── Publish (instant) ────────────────────────────────────────

const PublishSchema = z.object({
  content: z.string().min(1).max(10000),
  platforms: z.array(platformEnum).min(1).max(16),
  account_ids: z.array(z.string().uuid()).min(1).max(20),
  media_ids: z.array(z.string().max(500)).max(10).optional(),
  hashtags: z.array(z.string().min(1).max(80)).max(30).optional(),
  link: z.string().url().max(2000).optional(),
  site_id: z.string().uuid().optional(),
});

/**
 * `POST /api/social/:siteId/posts/publish` — Publish a post immediately.
 *
 * Validates content within per-platform char limits, enqueues to Upstash
 * per-platform sorted sets, returns queued status. Idempotent via
 * `Idempotency-Key` header.
 *
 * @throws 400 BAD_REQUEST when payload fails validation or no valid accounts.
 * @throws 401 UNAUTHORIZED when auth context is missing.
 */
socialPostRoutes.post(
  '/api/social/:siteId/posts/publish',
  zValidator('json', PublishSchema),
  async (c) => {
    const ctx = requireAuth(c);
    if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
    if (!(await isFlagOn(c.env, 'social_publishing_native', { orgId: ctx.orgId }))) {
      return c.json({ error: { code: 'FEATURE_DISABLED', message: 'flag off' } }, 503);
    }
    // TODO: SOCIAL-110 — validate accounts belong to org, enqueue to Upstash,
    // build correlation_id from Idempotency-Key, create pulse_posts row,
    // return queued status per platform.
    return c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Tier 1 — coming soon' } }, 501);
  },
);

// ── Schedule ─────────────────────────────────────────────────

const ScheduleSchema = PublishSchema.extend({
  scheduled_at: z.string().datetime(),
});

/**
 * `POST /api/social/:siteId/posts/schedule` — Schedule a post for future publishing.
 *
 * Validates future datetime, creates pulse_posts row with status='scheduled',
 * spawns CF Workflow v2 instance that sleeps until scheduled_at, then publishes.
 *
 * @throws 400 BAD_REQUEST when scheduled_at is in the past.
 * @throws 401 UNAUTHORIZED when auth context is missing.
 */
socialPostRoutes.post(
  '/api/social/:siteId/posts/schedule',
  zValidator('json', ScheduleSchema),
  async (c) => {
    const ctx = requireAuth(c);
    if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
    if (!(await isFlagOn(c.env, 'social_publishing_native', { orgId: ctx.orgId }))) {
      return c.json({ error: { code: 'FEATURE_DISABLED', message: 'flag off' } }, 503);
    }
    // TODO: SOCIAL-111 — validate future datetime, create pulse_posts row,
    // spawn CF Workflow v2, return post_id + workflow_id + scheduled_at.
    return c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Tier 1 — coming soon' } }, 501);
  },
);

// ── AI Generate ──────────────────────────────────────────────

const GenerateSchema = z.object({
  topic: z.string().min(1).max(500),
  platforms: z.array(platformEnum).min(1).max(16),
  tone: z.enum(['punchy', 'warm', 'authoritative', 'playful', 'story']).optional(),
});

/**
 * `POST /api/social/:siteId/posts/generate` — AI-generate per-platform post variants.
 *
 * Uses site brand voice + business context. Returns per-platform drafts within
 * char limits. Langfuse-traced. Never auto-publishes.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 502 AI_GENERATION_ERROR when LLM call fails.
 */
socialPostRoutes.post(
  '/api/social/:siteId/posts/generate',
  zValidator('json', GenerateSchema),
  async (_c) => {
    // TODO: SOCIAL-114 — wire social_auto_pilot generateAutoPilotPostForNetwork
    // per platform, return variants. Langfuse trace.
    return _c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Tier 1 — coming soon' } }, 501);
  },
);

// ── Posting Times ────────────────────────────────────────────

/**
 * `GET /api/social/:siteId/posting-times` — Optimal posting times per platform.
 *
 * Returns research-backed best times (day + hour) per connected platform,
 * optionally personalized from historical engagement data (Tier 3).
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 */
socialPostRoutes.get('/api/social/:siteId/posting-times', async (c) => {
  const ctx = requireAuth(c);
  if (!ctx) return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  if (!(await isFlagOn(c.env, 'social_publishing_native', { orgId: ctx.orgId }))) {
    return c.json({ error: { code: 'FEATURE_DISABLED', message: 'flag off' } }, 503);
  }
  // TODO: SOCIAL-119 — return BEST_TIMES from social_post_scheduler per platform.
  // Future: personalized from Tinybird engagement data.
  return c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Tier 1 — coming soon' } }, 501);
});
