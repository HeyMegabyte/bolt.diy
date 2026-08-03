import type { Env } from '../../../src/types/env.js';
import { dbQuery } from '../../../src/services/db.js';

interface SparkRow { date: string; visits: number }

export async function getSparkline(env: Env, siteId: string, days = 7): Promise<{ siteId: string; days: { date: string; visits: number }[] }> {
  // analytics_daily real columns are `day` (YYYY-MM-DD) + `pageviews` — NOT date/visits.
  // Alias back to {date,visits} so the SparkRow shape + caller stay unchanged; use
  // date('now',...) (date-only) so the day comparison matches inclusively.
  const rows = await dbQuery<SparkRow>(env.DB, `SELECT day as date, COALESCE(SUM(pageviews),0) as visits FROM analytics_daily WHERE site_id=? AND day >= date('now','-'||?||' days') GROUP BY day ORDER BY day`, [siteId, String(days)]);
  return { siteId, days: (rows.data ?? []).map(r => ({ date: r.date, visits: Number(r.visits) })) };
}
