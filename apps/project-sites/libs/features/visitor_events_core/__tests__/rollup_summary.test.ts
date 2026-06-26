import { getTrafficSummaryFromRollup } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

/**
 * D1 stub that answers by SQL shape: SUM(pageviews) → scalar row;
 * json_each → a per-label breakdown row keyed by which dimension is extracted.
 * dbExecute (rollupAnalyticsDaily's today-refresh) is a harmless no-op.
 */
function stubEnv(): Env {
  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            all: async () => {
              if (sql.includes('SUM(pageviews)')) return { results: [{ pv: 100, us: 40, cv: 5 }] };
              if (sql.includes('json_each')) {
                if (sql.includes("'$.path'")) return { results: [{ k: '/', c: 90, u: 30 }] };
                if (sql.includes("'$.type'")) return { results: [{ k: 'pageview', c: 100, u: 0 }] };
                return { results: [{ k: 'organic', c: 60, u: 0 }] };
              }
              return { results: [] };
            },
            first: async () => null,
            run: async () => ({ success: true, meta: { changes: 0 } }),
          };
        },
      };
    },
  };
  return { DB: db } as unknown as Env;
}

describe('getTrafficSummaryFromRollup (AN3 — rollup-read owner summary)', () => {
  it('assembles a valid TrafficSummary from rollup scalars + json_each breakdowns', async () => {
    const s = await getTrafficSummaryFromRollup(stubEnv(), 'site_1', 30);
    expect(s.pageviews).toBe(100);
    expect(s.uniqueSessions).toBe(40);
    expect(s.conversions).toBe(5);
    expect(s.windowDays).toBe(30);
    // topPaths carries uniques (the AN9 engagement signal) from the merged JSON.
    expect(s.topPaths[0]).toEqual({ path: '/', count: 90, uniques: 30 });
    expect(s.byType[0]).toEqual({ type: 'pageview', count: 100 });
    expect(s.byChannel.some((c) => c.label === 'organic')).toBe(true);
    expect(s.byDevice.length).toBeGreaterThan(0);
    expect(s.byCountry.length).toBeGreaterThan(0);
    // previous-window scalars present (same stub → same figures).
    expect(s.previous.pageviews).toBe(100);
  });

  it('passes the chosen window through to the result', async () => {
    const s = await getTrafficSummaryFromRollup(stubEnv(), 'site_1', 7);
    expect(s.windowDays).toBe(7);
  });
});
