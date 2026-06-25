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

describe('getDailySeries (AN5 follow-on — analytics_daily series)', () => {
  it('maps snake_case rollup rows to the camelCase DailyPoint shape', async () => {
    const rows = [
      { day: '2026-06-23', pageviews: 10, unique_sessions: 7, conversions: 1 },
      { day: '2026-06-24', pageviews: 20, unique_sessions: 12, conversions: 3 },
    ];
    const { days } = await getDailySeries(stubEnv(rows), 'site_1', 30);
    expect(days.length).toBe(2);
    expect(days[0]).toEqual({ day: '2026-06-23', pageviews: 10, uniqueSessions: 7, conversions: 1 });
    expect(days[1].uniqueSessions).toBe(12);
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
