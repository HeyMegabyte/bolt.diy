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

/** UPDATE that sets one `json_extract`-dimension breakdown column for a day. */
function metaBreakdownUpdate(column: string, metaKey: string): string {
  return `
UPDATE analytics_daily SET ${column} = (
  SELECT json_group_array(json_object('label', label, 'count', c)) FROM (
    SELECT json_extract(ve.metadata, '$.${metaKey}') AS label, COUNT(*) AS c
    FROM visitor_events ve
    WHERE ve.site_id = analytics_daily.site_id AND date(ve.created_at) = analytics_daily.day
      AND ve.event_type = 'pageview'
    GROUP BY label ORDER BY c DESC
  )
) WHERE day = ?`.trim();
}

/** Per-dimension breakdown UPDATEs, run after the scalar INSERT for the same day. */
export const BREAKDOWN_UPDATES: ReadonlyArray<string> = [
  // Top pages by views (path, not metadata).
  `
UPDATE analytics_daily SET top_paths_json = (
  SELECT json_group_array(json_object('path', path, 'count', c)) FROM (
    SELECT ve.path AS path, COUNT(*) AS c
    FROM visitor_events ve
    WHERE ve.site_id = analytics_daily.site_id AND date(ve.created_at) = analytics_daily.day
      AND ve.event_type = 'pageview' AND ve.path IS NOT NULL
    GROUP BY ve.path ORDER BY c DESC LIMIT 10
  )
) WHERE day = ?`.trim(),
  metaBreakdownUpdate('by_channel_json', 'channel'),
  metaBreakdownUpdate('by_device_json', 'device'),
  metaBreakdownUpdate('by_country_json', 'country'),
  // Event-type mix over ALL events (not just pageviews), mirroring byType.
  `
UPDATE analytics_daily SET by_type_json = (
  SELECT json_group_array(json_object('type', t, 'count', c)) FROM (
    SELECT ve.event_type AS t, COUNT(*) AS c
    FROM visitor_events ve
    WHERE ve.site_id = analytics_daily.site_id AND date(ve.created_at) = analytics_daily.day
    GROUP BY ve.event_type ORDER BY c DESC
  )
) WHERE day = ?`.trim(),
];

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
  // Fill the per-dimension breakdown JSON columns for the rows just upserted.
  // Best-effort: a breakdown failure must not lose the scalar rollup.
  for (const sql of BREAKDOWN_UPDATES) {
    await dbExecute(env.DB, sql, [target]);
  }
  return { day: target, changes: res.changes, error: res.error };
}
