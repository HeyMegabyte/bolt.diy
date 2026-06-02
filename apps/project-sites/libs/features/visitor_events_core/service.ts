/**
 * @module libs/features/visitor_events_core/service
 * @description Ingest + aggregation for Visitor Events Core. Public beacons POST
 * events; `recordVisitorEvent` appends a row, `getTrafficSummary` rolls them up
 * for `site_analytics`. Aggregation queries are defensive (missing table → 0).
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbExecute } from '../../../src/services/db.js';
import {
  VisitorEventInputSchema,
  TrafficSummarySchema,
  type VisitorEventInput,
  type TrafficSummary,
  type PathCountSchema,
} from './schemas.js';
import type { z } from 'zod';

/** Flag key gating this feature. */
export const FLAG_KEY = 'visitor_events_core';

/** Append one visitor event. Org/site resolved by the caller (handler), not the body. */
export async function recordVisitorEvent(
  env: Env,
  ctx: { orgId: string; siteId: string },
  input: VisitorEventInput,
): Promise<{ id: string }> {
  const v = VisitorEventInputSchema.parse(input);
  const id = crypto.randomUUID();
  await dbExecute(
    env.DB,
    `INSERT INTO visitor_events (id, org_id, site_id, session_id, event_type, path, referrer, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ctx.orgId,
      ctx.siteId,
      v.sessionId,
      v.eventType,
      v.path ?? null,
      v.referrer ?? null,
      JSON.stringify(v.metadata ?? {}),
    ],
  );
  return { id };
}

/** Static-asset extensions that are NOT page views (skip recording). */
const NON_PAGE_EXT_RE =
  /\.(?:css|js|mjs|cjs|json|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|xml|txt|pdf|mp4|webm|mov|wasm|zip|gz|csv)$/i;

/**
 * True when a request path is a real page navigation (the thing a visitor
 * "clicks" to), not a static asset fetch. Root, trailing-slash, extensionless,
 * and `.html` count as pages; everything with an asset extension does not.
 */
export function isPageRequest(path: string): boolean {
  const clean = (path.split('?')[0] || '/').split('#')[0];
  if (clean === '/' || clean.endsWith('/')) return true;
  if (clean.endsWith('.html')) return true;
  return !NON_PAGE_EXT_RE.test(clean);
}

/** Obvious crawler/bot UAs we don't count as human pageviews. */
const BOT_UA_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|flipboard|tumblr|redditbot|gptbot|claudebot|claude-|perplexitybot|ccbot|bytespider|google-extended|applebot|headlesschrome|lighthouse|pagespeed/i;

/**
 * Privacy-preserving anonymous session id: a truncated SHA-256 of
 * `ip|ua|YYYY-MM-DD`. Stable per visitor per UTC day for unique-session counts,
 * but stores NO raw PII (the hash is one-way; the IP/UA are never persisted).
 */
async function anonSessionId(ip: string, ua: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const bytes = new TextEncoder().encode(`${ip}|${ua}|${day}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Record an anonymous edge pageview for a served site. Called fire-and-forget
 * from the Worker's site-serving path via `ctx.waitUntil` — Cloudflare-native,
 * no client beacon, no feature flag, never blocks or breaks serving.
 *
 * @remarks Skips non-page asset requests and known bots. All failures are
 * swallowed: analytics must never take down content delivery.
 *
 * @example
 * ```ts
 * c.executionCtx.waitUntil(
 *   recordPageviewFromRequest(c.env, { orgId: site.org_id, siteId: site.site_id }, c.req.raw, path),
 * );
 * ```
 */
export async function recordPageviewFromRequest(
  env: Env,
  ctx: { orgId: string; siteId: string },
  request: Request,
  path: string,
): Promise<void> {
  try {
    if (!isPageRequest(path)) return;
    const ua = request.headers.get('user-agent') ?? '';
    if (BOT_UA_RE.test(ua)) return;
    const ip = request.headers.get('cf-connecting-ip') ?? '';
    const referrer = request.headers.get('referer') ?? undefined;
    const cf = (request as unknown as { cf?: { country?: string } }).cf;
    const sessionId = await anonSessionId(ip, ua);
    await recordVisitorEvent(env, ctx, {
      sessionId,
      eventType: 'pageview',
      path: (path.split('?')[0] || '/').slice(0, 2048),
      referrer: referrer ? referrer.slice(0, 2048) : undefined,
      metadata: { country: cf?.country ?? null, ua: ua.slice(0, 256) },
    });
  } catch {
    // Analytics is best-effort; never surface to the visitor.
  }
}

/** Scalar COUNT/aggregate, 0 on any error (missing table etc.). */
async function scalar(env: Env, sql: string, params: unknown[]): Promise<number> {
  const { data, error } = await dbQuery<{ n: number }>(env.DB, sql, params);
  if (error) return 0;
  return Number(data[0]?.n ?? 0);
}

/** Roll up a site's traffic over a trailing window. */
export async function getTrafficSummary(
  env: Env,
  siteId: string,
  windowDays = 30,
): Promise<TrafficSummary> {
  const since = `-${windowDays} days`;
  const w = ['site_id = ?', "created_at >= datetime('now', ?)"].join(' AND ');

  const [pageviews, uniqueSessions, conversions, topPathRows, byTypeRows] = await Promise.all([
    scalar(env, `SELECT COUNT(*) AS n FROM visitor_events WHERE ${w} AND event_type = 'pageview'`, [
      siteId,
      since,
    ]),
    scalar(env, `SELECT COUNT(DISTINCT session_id) AS n FROM visitor_events WHERE ${w}`, [
      siteId,
      since,
    ]),
    scalar(
      env,
      `SELECT COUNT(*) AS n FROM visitor_events WHERE ${w} AND event_type = 'conversion'`,
      [siteId, since],
    ),
    dbQuery<{ path: string | null; n: number }>(
      env.DB,
      `SELECT path, COUNT(*) AS n FROM visitor_events WHERE ${w} AND event_type = 'pageview' AND path IS NOT NULL
       GROUP BY path ORDER BY n DESC LIMIT 10`,
      [siteId, since],
    ).then((r) => (r.error ? [] : r.data)),
    dbQuery<{ event_type: string; n: number }>(
      env.DB,
      `SELECT event_type, COUNT(*) AS n FROM visitor_events WHERE ${w} GROUP BY event_type ORDER BY n DESC`,
      [siteId, since],
    ).then((r) => (r.error ? [] : r.data)),
  ]);

  const topPaths: Array<z.infer<typeof PathCountSchema>> = topPathRows
    .filter((r) => r.path)
    .map((r) => ({ path: r.path as string, count: Number(r.n) }));
  const byType = byTypeRows
    .filter((r) => typeof r.event_type === 'string' && r.event_type)
    .map((r) => ({ type: r.event_type, count: Number(r.n) }));

  return TrafficSummarySchema.parse({
    pageviews,
    uniqueSessions,
    conversions,
    topPaths,
    byType,
    windowDays,
  });
}
