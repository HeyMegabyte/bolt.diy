import { getConversionsBySection } from '../service.js';
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

describe('getConversionsBySection (AN27 — section-level conversion attribution)', () => {
  it('aggregates section+kind rows into ranked per-section totals with percent + kind split', async () => {
    // 4 services calls + 2 services directions = 6; 2 contact calls; 2 unattributed = 10 total.
    const rows = [
      { section: 'services', kind: 'call', n: 4 },
      { section: 'services', kind: 'directions', n: 2 },
      { section: 'contact', kind: 'call', n: 2 },
      { section: '(unattributed)', kind: 'email', n: 2 },
    ];
    const out = await getConversionsBySection(stubEnv(rows), 'site_1', 30);
    expect(out.totalConversions).toBe(10);
    // Ranked by count desc — services first.
    expect(out.sections[0]).toEqual({
      section: 'services',
      count: 6,
      percent: 60,
      calls: 4,
      directions: 2,
      emails: 0,
    });
    expect(out.sections[1]).toMatchObject({ section: 'contact', count: 2, percent: 20, calls: 2 });
    expect(out.sections[2]).toMatchObject({ section: '(unattributed)', count: 2, emails: 2 });
  });

  it('coalesces a null section to (unattributed) so conversions are never lost', async () => {
    const out = await getConversionsBySection(
      stubEnv([{ section: null, kind: 'call', n: 3 }]),
      'site_1',
    );
    expect(out.sections[0].section).toBe('(unattributed)');
    expect(out.totalConversions).toBe(3);
  });

  it('returns zero totals (never throws) when there are no conversion events', async () => {
    const out = await getConversionsBySection(stubEnv([]), 'site_1');
    expect(out.totalConversions).toBe(0);
    expect(out.sections).toEqual([]);
  });

  it('clamps an out-of-range window to 30 days in the datetime bound', async () => {
    const cap: Cap = { sql: '', params: [] };
    await getConversionsBySection(stubEnv([], cap), 'site_1', 9999);
    expect(cap.params).toEqual(['site_1', '-30 days']);
    await getConversionsBySection(stubEnv([], cap), 'site_1', 7);
    expect(cap.params).toEqual(['site_1', '-7 days']);
  });

  it('only counts conversion events scoped to the site (SQL asserts the filter)', async () => {
    const cap: Cap = { sql: '', params: [] };
    await getConversionsBySection(stubEnv([], cap), 'site_1');
    expect(cap.sql).toContain("event_type = 'conversion'");
    expect(cap.sql).toContain('site_id = ?');
    expect(cap.sql).toContain('FROM visitor_events');
    expect(cap.sql).toContain("json_extract(metadata, '$.section')");
  });
});
