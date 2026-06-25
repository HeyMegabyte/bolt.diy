/**
 * @module services/analytics_rollup
 * @description AN5 — daily rollup of `visitor_events` into `analytics_daily`.
 *
 * One SQL `INSERT … SELECT … ON CONFLICT` aggregates a single UTC day's raw
 * events into per-site/per-day scalar rows so owner analytics can answer
 * "last N days" in O(days) instead of scanning O(events). Idempotent: re-running
 * a day UPSERTs the same row. Wired into the Worker `scheduled()` cron.
 *
 * Metric definitions mirror `visitor_events_core/service.ts` exactly:
 *  - pageviews       = events with `event_type = 'pageview'`
 *  - unique_sessions = COUNT(DISTINCT session_id)
 *  - conversions     = events with `event_type = 'conversion'`
 */
import type { Env } from '../types/env.js';
import { dbExecute } from './db.js';

/**
 * The UTC calendar day (`YYYY-MM-DD`) `daysBack` days before `ref`.
 *
 * @example
 * utcDayBefore(new Date('2026-06-25T04:00:00Z')); // '2026-06-24'
 */
export function utcDayBefore(ref: Date, daysBack = 1): string {
  return new Date(ref.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);
}

/** Aggregation + idempotent upsert for ONE day. `?` bound twice with the same day. */
export const ROLLUP_SQL = `
INSERT INTO analytics_daily (site_id, org_id, day, pageviews, unique_sessions, conversions, total_events)
SELECT site_id, org_id, ? AS day,
  SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS pageviews,
  COUNT(DISTINCT session_id) AS unique_sessions,
  SUM(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END) AS conversions,
  COUNT(*) AS total_events
FROM visitor_events
WHERE date(created_at) = ?
GROUP BY site_id, org_id
ON CONFLICT(site_id, day) DO UPDATE SET
  org_id = excluded.org_id,
  pageviews = excluded.pageviews,
  unique_sessions = excluded.unique_sessions,
  conversions = excluded.conversions,
  total_events = excluded.total_events,
  updated_at = datetime('now')
`.trim();

/**
 * Roll up one UTC day of `visitor_events` into `analytics_daily`.
 *
 * @param env - Worker bindings (requires `DB`).
 * @param day - UTC `YYYY-MM-DD` to roll up; defaults to yesterday.
 * @returns the day processed and the D1 change count.
 * @throws never — surfaces D1 errors in the returned `error` field.
 *
 * @example
 * await rollupAnalyticsDaily(env);             // yesterday
 * await rollupAnalyticsDaily(env, '2026-06-24'); // a specific day (backfill)
 */
export async function rollupAnalyticsDaily(
  env: Env,
  day?: string,
): Promise<{ day: string; changes: number; error: string | null }> {
  const target = day ?? utcDayBefore(new Date());
  const res = await dbExecute(env.DB, ROLLUP_SQL, [target, target]);
  return { day: target, changes: res.changes, error: res.error };
}
