/**
 * Crew schedule predictor (backlog #41).
 *
 * @remarks
 *  V1 is a roll-up: count completed bookings per crew per (day-of-week, hour)
 *  bucket over the last 12 weeks, normalize to 0..1 intensity. No ML — a SQL
 *  count gives a useful "when is this crew historically busy" heatmap
 *  immediately. We can swap in a smoothed forecast later without touching the
 *  consumer shape.
 *
 *  Days: 0=Sun…6=Sat (matches JavaScript `Date.getUTCDay()`).
 *  Hours: 0..23 UTC.
 *
 * @example
 *   const heatmap = await buildCrewHeatmap(env, { tenantId, crewId, weeks: 12 });
 *   // → { cells: [{ day:1, hour:9, intensity:0.84, count:42 }, …] }
 */
import type { Env } from '../env.js';
import { dbQuery } from './db.js';

export interface HeatmapCell {
  readonly day: number;   // 0..6 (UTC)
  readonly hour: number;  // 0..23
  readonly intensity: number; // 0..1 normalized
  readonly count: number;
}

export interface HeatmapResult {
  readonly crew_id: string;
  readonly window_days: number;
  readonly cells: ReadonlyArray<HeatmapCell>;
  readonly max_count: number;
  readonly total_bookings: number;
}

export async function buildCrewHeatmap(
  env: Env,
  args: {
    tenantId: string;
    crewId: string;
    weeks?: number;
  },
): Promise<HeatmapResult> {
  const weeks = args.weeks ?? 12;
  const windowDays = weeks * 7;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  // D1 SQLite: strftime with `%w` = weekday (0..6), `%H` = hour (00..23).
  // `jobs.completed_at` is the source of truth for "this crew did work".
  const rows = await dbQuery<{ day: number; hour: number; count: number }>(
    env.DB,
    `SELECT CAST(strftime('%w', completed_at) AS INTEGER) AS day,
            CAST(strftime('%H', completed_at) AS INTEGER) AS hour,
            COUNT(*) AS count
       FROM jobs
      WHERE tenant_id = ?1
        AND crew_id   = ?2
        AND completed_at IS NOT NULL
        AND completed_at >= ?3
      GROUP BY day, hour`,
    [args.tenantId, args.crewId, since],
  );

  // Initialize the 7×24 grid so the UI never has to fill missing cells.
  const cells: HeatmapCell[] = [];
  const byKey = new Map<string, number>();
  let max = 0;
  let total = 0;
  for (const r of rows) {
    const k = `${r.day}:${r.hour}`;
    byKey.set(k, r.count);
    if (r.count > max) max = r.count;
    total += r.count;
  }
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const count = byKey.get(`${d}:${h}`) ?? 0;
      cells.push({
        day: d,
        hour: h,
        count,
        intensity: max > 0 ? count / max : 0,
      });
    }
  }

  return {
    crew_id: args.crewId,
    window_days: windowDays,
    cells,
    max_count: max,
    total_bookings: total,
  };
}
