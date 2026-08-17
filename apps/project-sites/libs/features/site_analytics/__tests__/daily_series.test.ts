import { getDailySeries } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

interface Cap {
  sql: string;
  params: unknown[];
}

/** D1 stub: dbQuery calls prepare(sql).bind(...params).all() → { results }. */
function stubEnv(rows: unknown[], cap?: Cap): Env {
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          if (cap) {
            cap.sql = sql;
            cap.params = params;
          }
          return {
            all: async () => ({ results: rows }),
            first: async () => rows[0] ?? null,
            run: async () => ({ success: true }),
          };
        },
      };
    },
  };
  return { DB: db } as unknown as Env;
}

describe('getDailySeries (per-day traffic series — live visitor_events, includes today)', () => {
  it('maps snake_case rows to the camelCase DailyPoint shape', async () => {
    const rows = [
      { day: '2026-06-23', pageviews: 10, unique_sessions: 7, conversions: 1 },
      { day: '2026-06-24', pageviews: 20, unique_sessions: 12, conversions: 3 },
    ];
    const { days } = await getDailySeries(stubEnv(rows), 'site_1', 30);
    expect(days.length).toBe(2);
    expect(days[0]).toEqual({ day: '2026-06-23', pageviews: 10, uniqueSessions: 7, conversions: 1 });
    expect(days[1].uniqueSessions).toBe(12);
  });

  it('reads LIVE visitor_events bucketed by date(created_at) — NOT the analytics_daily rollup (which never has today)', async () => {
    const cap: Cap = { sql: '', params: [] };
    await getDailySeries(stubEnv([], cap), 'site_1', 30);
    // Source is the live event table so the newest day (today) is never dropped, and
    // the bars stay consistent with the live headline totals (getTrafficSummary).
    expect(cap.sql).toMatch(/FROM visitor_events/);
    expect(cap.sql).not.toMatch(/FROM analytics_daily/);
    // Bucketed per UTC calendar day, filtered on the raw (index-usable) created_at.
    expect(cap.sql).toMatch(/GROUP BY date\(created_at\)/);
    expect(cap.sql).toMatch(/created_at >= datetime\('now', \?\)/);
    // Same metric definitions as getTrafficSummary (pageview / DISTINCT session / conversion).
    expect(cap.sql).toMatch(/event_type = 'pageview'/);
    expect(cap.sql).toMatch(/COUNT\(DISTINCT session_id\)/);
    expect(cap.sql).toMatch(/event_type = 'conversion'/);
  });

  it('clamps an out-of-range window to the 30-day default in the date() bound', async () => {
    const cap: Cap = { sql: '', params: [] };
    await getDailySeries(stubEnv([], cap), 'site_1', 9999);
    expect(cap.params).toEqual(['site_1', '-30 days']);
    await getDailySeries(stubEnv([], cap), 'site_1', 7);
    expect(cap.params).toEqual(['site_1', '-7 days']);
  });

  it('returns an empty series (never throws) when there are no rows', async () => {
    const { days } = await getDailySeries(stubEnv([]), 'site_1');
    expect(days).toEqual([]);
  });
});
