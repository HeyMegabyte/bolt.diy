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
import { enrichVisitor } from './enrich.js';
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
      // AN1 enrichment — device/browser/os + channel (+ utm when present) folded
      // into metadata JSON (no schema migration); powers AN10/AN13 owner widgets.
      metadata: {
        country: cf?.country ?? null,
        ua: ua.slice(0, 256),
        ...enrichVisitor(ua, referrer, path),
      },
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
  // AN3 — when the rollup-read flag is on, serve from analytics_daily (O(days)).
  // Fail-open: any flag-check error falls through to the live scan below.
  try {
    const { isFlagOn } = await import('../../../src/modules/feature_flags/services.js');
    if (await isFlagOn(env, 'analytics_rollup_read', { siteId })) {
      return getTrafficSummaryFromRollup(env, siteId, windowDays);
    }
  } catch {
    /* fall through to the live path */
  }

  const since = `-${windowDays} days`;
  const w = ['site_id = ?', "created_at >= datetime('now', ?)"].join(' AND ');
  // AN15 — the window immediately BEFORE the current one, for period-over-period
  // deltas: [now-2N, now-N). Same length as the current window.
  const prevSince = `-${windowDays * 2} days`;
  const pw = ['site_id = ?', "created_at >= datetime('now', ?)", "created_at < datetime('now', ?)"].join(
    ' AND ',
  );
  const pwParams = [siteId, prevSince, since];

  const [
    pageviews,
    uniqueSessions,
    conversions,
    topPathRows,
    byTypeRows,
    byDeviceRows,
    byChannelRows,
    prevPageviews,
    prevSessions,
    prevConversions,
    byCountryRows,
  ] = await Promise.all([
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
    dbQuery<{ path: string | null; n: number; u: number }>(
      env.DB,
      `SELECT path, COUNT(*) AS n, COUNT(DISTINCT session_id) AS u FROM visitor_events
       WHERE ${w} AND event_type = 'pageview' AND path IS NOT NULL
       GROUP BY path ORDER BY u DESC, n DESC LIMIT 10`,
      [siteId, since],
    ).then((r) => (r.error ? [] : r.data)),
    dbQuery<{ event_type: string; n: number }>(
      env.DB,
      `SELECT event_type, COUNT(*) AS n FROM visitor_events WHERE ${w} GROUP BY event_type ORDER BY n DESC`,
      [siteId, since],
    ).then((r) => (r.error ? [] : r.data)),
    // AN13 — device split over pageviews, from the AN1 metadata enrichment.
    dbQuery<{ label: string | null; n: number }>(
      env.DB,
      `SELECT json_extract(metadata, '$.device') AS label, COUNT(*) AS n FROM visitor_events
       WHERE ${w} AND event_type = 'pageview' GROUP BY label ORDER BY n DESC`,
      [siteId, since],
    ).then((r) => (r.error ? [] : r.data)),
    // AN10 — channel breakdown over pageviews (direct/organic/social/paid/email/referral).
    dbQuery<{ label: string | null; n: number }>(
      env.DB,
      `SELECT json_extract(metadata, '$.channel') AS label, COUNT(*) AS n FROM visitor_events
       WHERE ${w} AND event_type = 'pageview' GROUP BY label ORDER BY n DESC`,
      [siteId, since],
    ).then((r) => (r.error ? [] : r.data)),
    // AN15 — previous-window scalars (same three KPIs) for the delta badges.
    scalar(env, `SELECT COUNT(*) AS n FROM visitor_events WHERE ${pw} AND event_type = 'pageview'`, pwParams),
    scalar(env, `SELECT COUNT(DISTINCT session_id) AS n FROM visitor_events WHERE ${pw}`, pwParams),
    scalar(
      env,
      `SELECT COUNT(*) AS n FROM visitor_events WHERE ${pw} AND event_type = 'conversion'`,
      pwParams,
    ),
    // AN14 — visitors by country over pageviews (cf.country captured in metadata).
    dbQuery<{ label: string | null; n: number }>(
      env.DB,
      `SELECT json_extract(metadata, '$.country') AS label, COUNT(*) AS n FROM visitor_events
       WHERE ${w} AND event_type = 'pageview' GROUP BY label ORDER BY n DESC`,
      [siteId, since],
    ).then((r) => (r.error ? [] : r.data)),
  ]);

  const topPaths: Array<z.infer<typeof PathCountSchema>> = topPathRows
    .filter((r) => r.path)
    // `u` (COUNT DISTINCT session_id) is always present from the live query; fall
    // back to count for any row lacking it so the strict schema never sees NaN.
    .map((r) => ({ path: r.path as string, count: Number(r.n), uniques: Number(r.u ?? r.n) }));
  const byType = byTypeRows
    .filter((r) => typeof r.event_type === 'string' && r.event_type)
    .map((r) => ({ type: r.event_type, count: Number(r.n) }));
  // Null label = pre-AN1 events (no enrichment) → bucket as 'unknown'.
  const toLabelCounts = (rows: Array<{ label: string | null; n: number }>) =>
    rows.map((r) => ({ label: r.label ?? 'unknown', count: Number(r.n) }));
  const byDevice = toLabelCounts(byDeviceRows);
  const byChannel = toLabelCounts(byChannelRows);
  const byCountry = toLabelCounts(byCountryRows);

  return TrafficSummarySchema.parse({
    pageviews,
    uniqueSessions,
    conversions,
    topPaths,
    byType,
    byDevice,
    byChannel,
    byCountry,
    previous: {
      pageviews: prevPageviews,
      uniqueSessions: prevSessions,
      conversions: prevConversions,
    },
    windowDays,
  });
}

/**
 * AN3 — the SAME shape as {@link getTrafficSummary}, read O(days) from the
 * `analytics_daily` rollup instead of scanning O(events) of `visitor_events`.
 *
 * @remarks
 * Today's (incomplete) rollup row is refreshed on demand first (the cron only
 * fills through yesterday), then the whole window is summed from the rollup via
 * SQL `json_each` (no JS JSON parsing). Window is CALENDAR-day aligned (last N
 * days incl. today) — a slightly different boundary than the live rolling
 * `now - N days`. `uniqueSessions` is summed across days (approximate: a session
 * spanning two days counts in each). Gated behind `analytics_rollup_read`.
 */
export async function getTrafficSummaryFromRollup(
  env: Env,
  siteId: string,
  windowDays = 30,
): Promise<TrafficSummary> {
  // Keep today's rollup row current — best-effort (a stale today degrades, never throws).
  try {
    const { rollupAnalyticsDaily } = await import('../../../src/services/analytics_rollup.js');
    await rollupAnalyticsDaily(env, new Date().toISOString().slice(0, 10));
  } catch {
    /* ignore — fall back to whatever the rollup already has */
  }

  const curStart = `-${windowDays - 1} days`; // inclusive of today → N calendar days
  const prevStart = `-${windowDays * 2 - 1} days`;
  const prevEnd = `-${windowDays} days`;

  const sumScalars = async (
    start: string,
    end: string | null,
  ): Promise<{ pageviews: number; uniqueSessions: number; conversions: number }> => {
    const where = end
      ? `site_id = ? AND day >= date('now', ?) AND day <= date('now', ?)`
      : `site_id = ? AND day >= date('now', ?)`;
    const params = end ? [siteId, start, end] : [siteId, start];
    const { data } = await dbQuery<{ pv: number; us: number; cv: number }>(
      env.DB,
      `SELECT COALESCE(SUM(pageviews),0) AS pv, COALESCE(SUM(unique_sessions),0) AS us,
              COALESCE(SUM(conversions),0) AS cv FROM analytics_daily WHERE ${where}`,
      params,
    );
    const r = data[0] ?? { pv: 0, us: 0, cv: 0 };
    return { pageviews: Number(r.pv), uniqueSessions: Number(r.us), conversions: Number(r.cv) };
  };

  /** Sum a JSON-array breakdown column across the window via json_each. */
  const merge = async (
    col: string,
    keyField: string,
  ): Promise<Array<{ k: string | null; c: number; u: number }>> => {
    const { data, error } = await dbQuery<{ k: string | null; c: number; u: number }>(
      env.DB,
      `SELECT json_extract(je.value, '$.${keyField}') AS k,
              SUM(CAST(json_extract(je.value, '$.count') AS INTEGER)) AS c,
              SUM(CAST(COALESCE(json_extract(je.value, '$.uniques'), 0) AS INTEGER)) AS u
       FROM analytics_daily ad, json_each(ad.${col}) je
       WHERE ad.site_id = ? AND ad.day >= date('now', ?) AND ad.${col} IS NOT NULL
       GROUP BY k ORDER BY c DESC`,
      [siteId, curStart],
    );
    return error ? [] : data;
  };

  const [cur, prev, pathRows, typeRows, channelRows, deviceRows, countryRows] = await Promise.all([
    sumScalars(curStart, null),
    sumScalars(prevStart, prevEnd),
    merge('top_paths_json', 'path'),
    merge('by_type_json', 'type'),
    merge('by_channel_json', 'label'),
    merge('by_device_json', 'label'),
    merge('by_country_json', 'label'),
  ]);

  return TrafficSummarySchema.parse({
    pageviews: cur.pageviews,
    uniqueSessions: cur.uniqueSessions,
    conversions: cur.conversions,
    topPaths: pathRows.map((r) => ({ path: String(r.k ?? '/'), count: Number(r.c), uniques: Number(r.u) })),
    byType: typeRows.map((r) => ({ type: String(r.k ?? 'unknown'), count: Number(r.c) })),
    byDevice: deviceRows.map((r) => ({ label: String(r.k ?? 'unknown'), count: Number(r.c) })),
    byChannel: channelRows.map((r) => ({ label: String(r.k ?? 'unknown'), count: Number(r.c) })),
    byCountry: countryRows.map((r) => ({ label: String(r.k ?? 'unknown'), count: Number(r.c) })),
    previous: {
      pageviews: prev.pageviews,
      uniqueSessions: prev.uniqueSessions,
      conversions: prev.conversions,
    },
    windowDays,
  });
}
