import type { Env } from '../../../src/types/env.js';
import { dbQuery } from '../../../src/services/db.js';

interface SparkRow { date: string; visits: number }

export async function getSparkline(env: Env, siteId: string, days = 7): Promise<{ siteId: string; days: { date: string; visits: number }[] }> {
  const rows = await dbQuery<SparkRow>(env.DB, `SELECT date, COALESCE(SUM(visits),0) as visits FROM analytics_daily WHERE site_id=? AND date >= datetime('now','-'||?||' days') GROUP BY date ORDER BY date`, [siteId, String(days)]);
  return { siteId, days: (rows.data ?? []).map(r => ({ date: r.date, visits: Number(r.visits) })) };
}
