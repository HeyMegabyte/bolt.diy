/**
 * @module routes/pulse_analytics
 *
 * @description
 * Pulse Analytics — aggregate endpoint powering the SocialPerformance
 * dashboard widget + the dedicated `/admin/social/analytics` drill-down route.
 *
 * Endpoints:
 *   GET /api/social/analytics/aggregate?days=30
 *     → per-platform impressions/engagement totals, best-performing posts,
 *       best-time-to-post heatmap.
 *
 * (The former `GET /api/inbox/metrics` endpoint was removed 2026-05-25 with
 * the Pulse Inbox surface — see `migrations/0035_pulse_inbox.sql` for the
 * deprecation note.)
 *
 * The hourly analytics cron (`runHourlyPulseAnalyticsCron`) is mounted from
 * `src/index.ts` scheduled handler — for each `social_publishes` row that
 * succeeded in the last 30 days, calls its platform's `fetchAnalytics` and
 * writes a `social_analytics_snapshots` row. Capped at 200 fetches per run.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbInsert } from '../services/db.js';
import { loadAccount } from '../services/social_account_ctx.js';
import { getPublisher, type Platform } from '../services/social_publishers/index.js';
import { bestTimeToPost } from '../services/social_ai.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function requireUser(c: { get: (k: string) => unknown }): {
  userId: string;
  orgId: string | null;
} | null {
  const userId = c.get('userId') as string | undefined;
  if (!userId) return null;
  const orgId = (c.get('orgId') as string | null | undefined) ?? null;
  return { userId, orgId };
}

function uuid(): string {
  return crypto.randomUUID();
}

function clampDays(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '30', 10);
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(180, n);
}

// ─── GET /api/social/analytics/aggregate ────────────────────────────────

interface PlatformTotals {
  platform: string;
  posts: number;
  impressions: number;
  reach: number;
  engagement: number; // likes + comments + shares + saves + clicks
}

interface BestPost {
  post_id: string;
  publish_id: string;
  platform: string;
  external_url: string | null;
  content_preview: string;
  impressions: number;
  engagement: number;
}

/**
 * `GET /api/social/analytics/aggregate?days=30` — Cross-platform social
 * performance rollup powering the SocialPerformance dashboard widget.
 *
 * @remarks
 * Reads the freshest snapshot per `social_publishes` row in the window
 * and returns per-platform totals, top-N best-performing posts, and the
 * best-time-to-post heatmap derived via {@link bestTimeToPost}. `days`
 * defaults to 30 and is clamped to 180.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
app.get('/api/social/analytics/aggregate', async (c) => {
  const user = requireUser(c);
  if (!user || !user.orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'sign in' } }, 401);
  }
  const days = clampDays(c.req.query('days'));

  // Pull the most recent snapshot per publish in the window. Use a window-fn
  // emulation via a correlated subquery so we only get the freshest row per
  // publish.
  const snapshots = await dbQuery<{
    publish_id: string;
    post_id: string;
    platform: string;
    external_url: string | null;
    content: string;
    impressions: number | null;
    reach: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    clicks: number | null;
    saves: number | null;
  }>(
    c.env.DB,
    `
      SELECT sas.publish_id   AS publish_id,
             sp.post_id       AS post_id,
             sp.platform      AS platform,
             sp.external_url  AS external_url,
             pp.content       AS content,
             sas.impressions  AS impressions,
             sas.reach        AS reach,
             sas.likes        AS likes,
             sas.comments     AS comments,
             sas.shares       AS shares,
             sas.clicks       AS clicks,
             sas.saves        AS saves
        FROM social_analytics_snapshots sas
        JOIN social_publishes sp ON sp.id = sas.publish_id
        JOIN pulse_posts pp ON pp.id = sp.post_id
       WHERE pp.org_id = ?
         AND sp.status = 'succeeded'
         AND sas.captured_at > datetime('now', '-${days} days')
         AND sas.captured_at = (
           SELECT MAX(captured_at) FROM social_analytics_snapshots
            WHERE publish_id = sas.publish_id
         )
    `,
    [user.orgId],
  );

  const totals = new Map<string, PlatformTotals>();
  const bestByPost = new Map<string, BestPost>();
  for (const row of snapshots.data) {
    const t = totals.get(row.platform) ?? {
      platform: row.platform,
      posts: 0,
      impressions: 0,
      reach: 0,
      engagement: 0,
    };
    t.posts += 1;
    t.impressions += row.impressions ?? 0;
    t.reach += row.reach ?? 0;
    const engagement =
      (row.likes ?? 0) +
      (row.comments ?? 0) +
      (row.shares ?? 0) +
      (row.clicks ?? 0) +
      (row.saves ?? 0);
    t.engagement += engagement;
    totals.set(row.platform, t);

    const existing = bestByPost.get(row.publish_id);
    const score = (row.impressions ?? 0) + engagement * 5;
    const existingScore = existing ? existing.impressions + existing.engagement * 5 : -1;
    if (!existing || score > existingScore) {
      bestByPost.set(row.publish_id, {
        post_id: row.post_id,
        publish_id: row.publish_id,
        platform: row.platform,
        external_url: row.external_url,
        content_preview: (row.content ?? '').slice(0, 200),
        impressions: row.impressions ?? 0,
        engagement,
      });
    }
  }

  const platformTotals = Array.from(totals.values()).sort(
    (a, b) => b.impressions - a.impressions,
  );

  const bestPosts = Array.from(bestByPost.values())
    .sort((a, b) => b.impressions + b.engagement * 5 - (a.impressions + a.engagement * 5))
    .slice(0, 5);

  // Best-time-to-post for the top platform (heatmap source).
  const topPlatform = platformTotals[0]?.platform ?? 'twitter';
  let bestTimes: { day: number; hour: number; confidence: number }[] = [];
  try {
    bestTimes = await bestTimeToPost(c.env, {
      platform: topPlatform,
      org_id: user.orgId,
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'pulse_analytics.aggregate',
        message: 'best_time_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return c.json({
    window_days: days,
    generated_at: new Date().toISOString(),
    platform_totals: platformTotals,
    best_posts: bestPosts,
    best_times: { platform: topPlatform, slots: bestTimes },
  });
});

// ─── GET /api/inbox/metrics — REMOVED 2026-05-25 ────────────────────────
// The Pulse Inbox surface was removed; this endpoint went with it. The
// chat_conversations + chat_messages tables remain in D1 for archival
// access — query them directly via wrangler d1 when needed.

// ─── Hourly analytics cron ──────────────────────────────────────────────

interface PublishRow {
  id: string;
  account_id: string;
  platform: string;
  external_post_id: string | null;
  succeeded_at: string | null;
}

/**
 * Hourly: fetch fresh analytics for every `social_publishes` row that
 * succeeded in the last 30 days. Caps at 200 fetches per run so a backlog
 * never melts platform rate limits. Mounted from the worker's `scheduled`
 * handler under the `0 * * * *` cron.
 */
export async function runHourlyPulseAnalyticsCron(env: Env): Promise<{
  scanned: number;
  fetched: number;
  failed: number;
}> {
  const cap = 200;
  const { data: publishes } = await dbQuery<PublishRow>(
    env.DB,
    `SELECT id, account_id, platform, external_post_id, succeeded_at
       FROM social_publishes
      WHERE status = 'succeeded'
        AND external_post_id IS NOT NULL
        AND succeeded_at > datetime('now', '-30 days')
      ORDER BY succeeded_at DESC
      LIMIT ?`,
    [cap],
  );

  let fetched = 0;
  let failed = 0;
  for (const pub of publishes) {
    if (!pub.external_post_id) continue;
    try {
      const account = await loadAccount(env, pub.account_id);
      if (!account) {
        failed += 1;
        continue;
      }
      const publisher = getPublisher(pub.platform as Platform);
      const snap = await publisher.fetchAnalytics(env, account, pub.external_post_id);
      await dbInsert(env.DB, 'social_analytics_snapshots', {
        id: uuid(),
        publish_id: pub.id,
        captured_at: new Date().toISOString(),
        impressions: snap.impressions,
        reach: snap.reach,
        likes: snap.likes,
        comments: snap.comments,
        shares: snap.shares,
        clicks: snap.clicks,
        saves: snap.saves,
        raw_json: snap.raw ? JSON.stringify(snap.raw).slice(0, 4000) : null,
      });
      fetched += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'pulse_analytics.cron',
          message: 'snapshot_failed',
          publish_id: pub.id,
          platform: pub.platform,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return { scanned: publishes.length, fetched, failed };
}

export { app as pulseAnalytics };
