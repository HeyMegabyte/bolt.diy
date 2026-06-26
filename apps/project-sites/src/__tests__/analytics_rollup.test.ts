import {
  rollupAnalyticsDaily,
  utcDayBefore,
  ROLLUP_SQL,
  BREAKDOWN_UPDATES,
} from '../services/analytics_rollup.js';
import type { Env } from '../types/env.js';

interface Captured {
  sql: string;
  params: unknown[];
}

/** Minimal D1 stub: records prepare()/bind() and resolves run() with a change count. */
function stubEnv(changes = 3): { env: Env; calls: Captured[] } {
  const calls: Captured[] = [];
  const db = {
    prepare(sql: string) {
      const call: Captured = { sql, params: [] };
      return {
        bind(...params: unknown[]) {
          call.params = params;
          calls.push(call);
          return this;
        },
        run: async () => ({ success: true, meta: { changes } }),
        all: async () => ({ results: [] }),
        first: async () => null,
      };
    },
  };
  return { env: { DB: db } as unknown as Env, calls };
}

describe('analytics_rollup (AN5 — daily visitor_events → analytics_daily)', () => {
  it('utcDayBefore() returns the UTC day N days before the reference', () => {
    expect(utcDayBefore(new Date('2026-06-25T04:00:00Z'))).toBe('2026-06-24');
    expect(utcDayBefore(new Date('2026-06-25T23:59:59Z'))).toBe('2026-06-24');
    expect(utcDayBefore(new Date('2026-03-01T00:00:00Z'))).toBe('2026-02-28');
    expect(utcDayBefore(new Date('2026-06-25T00:00:00Z'), 7)).toBe('2026-06-18');
  });

  it('ROLLUP_SQL mirrors the canonical metric definitions + is an idempotent upsert', () => {
    expect(ROLLUP_SQL).toContain('INSERT INTO analytics_daily');
    expect(ROLLUP_SQL).toContain("event_type = 'pageview'");
    expect(ROLLUP_SQL).toContain('COUNT(DISTINCT session_id)');
    expect(ROLLUP_SQL).toContain("event_type = 'conversion'");
    expect(ROLLUP_SQL).toContain('ON CONFLICT(site_id, day) DO UPDATE');
    expect(ROLLUP_SQL).toContain('GROUP BY site_id, org_id');
  });

  it('rolls up an explicit day: scalar INSERT + one UPDATE per breakdown dimension', async () => {
    const { env, calls } = stubEnv(5);
    const res = await rollupAnalyticsDaily(env, '2026-06-24');
    expect(res.day).toBe('2026-06-24');
    expect(res.changes).toBe(5);
    expect(res.error).toBeNull();
    // 1 scalar INSERT + 4 breakdown UPDATEs (top_paths/channel/device/country).
    expect(calls.length).toBe(1 + BREAKDOWN_UPDATES.length);
    expect(calls.length).toBe(5);
    expect(calls[0].sql).toContain('INSERT INTO analytics_daily');
    expect(calls[0].params).toEqual(['2026-06-24', '2026-06-24']);
    // every breakdown UPDATE is scoped to the same day with a single param
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].sql).toContain('UPDATE analytics_daily SET');
      expect(calls[i].params).toEqual(['2026-06-24']);
    }
  });

  it('BREAKDOWN_UPDATES cover the four dimensions with json_group_array', () => {
    const joined = BREAKDOWN_UPDATES.join('\n');
    expect(BREAKDOWN_UPDATES.length).toBe(4);
    expect(joined).toContain('top_paths_json');
    expect(joined).toContain('by_channel_json');
    expect(joined).toContain('by_device_json');
    expect(joined).toContain('by_country_json');
    expect(joined).toContain('json_group_array');
    expect(joined).toContain("json_extract(ve.metadata, '$.channel')");
  });

  it('defaults to yesterday when no day is given', async () => {
    const { env, calls } = stubEnv();
    const res = await rollupAnalyticsDaily(env);
    // default day is a valid YYYY-MM-DD and bound to both placeholders
    expect(res.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calls[0].params).toEqual([res.day, res.day]);
  });
});
