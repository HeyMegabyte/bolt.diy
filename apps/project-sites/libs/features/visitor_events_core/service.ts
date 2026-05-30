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
