import { getFormAnalytics } from '../service.js';
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

describe('getFormAnalytics (AN17 — per-form completion rate + abandonment)', () => {
  it('derives completion rate + abandonment per form from start/submit counts', async () => {
    const rows = [
      { form: 'contact', eventType: 'form_start', n: 10 },
      { form: 'contact', eventType: 'form_submit', n: 4 },
      { form: 'newsletter', eventType: 'form_start', n: 5 },
      { form: 'newsletter', eventType: 'form_submit', n: 5 },
    ];
    const { forms } = await getFormAnalytics(stubEnv(rows), 'site_1', 30);
    // Ranked by starts desc → contact (10) first.
    expect(forms[0]).toEqual({
      form: 'contact',
      starts: 10,
      submits: 4,
      completionRate: 40,
      abandoned: 6,
    });
    expect(forms[1]).toEqual({
      form: 'newsletter',
      starts: 5,
      submits: 5,
      completionRate: 100,
      abandoned: 0,
    });
  });

  it('caps completionRate at 100 and floors abandoned at 0 (autofill submit w/o focus)', async () => {
    const rows = [
      { form: 'quick', eventType: 'form_start', n: 2 },
      { form: 'quick', eventType: 'form_submit', n: 5 },
    ];
    const { forms } = await getFormAnalytics(stubEnv(rows), 'site_1');
    expect(forms[0].completionRate).toBe(100);
    expect(forms[0].abandoned).toBe(0);
  });

  it('coalesces a null form key to (unnamed)', async () => {
    const { forms } = await getFormAnalytics(
      stubEnv([{ form: null, eventType: 'form_start', n: 3 }]),
      'site_1',
    );
    expect(forms[0].form).toBe('(unnamed)');
    expect(forms[0].completionRate).toBe(0); // 0 submits / 3 starts
  });

  it('returns an empty list (never throws) when there are no form events', async () => {
    const { forms } = await getFormAnalytics(stubEnv([]), 'site_1');
    expect(forms).toEqual([]);
  });

  it('scopes the query to the site + form events + clamps the window (SQL + params)', async () => {
    const cap: Cap = { sql: '', params: [] };
    await getFormAnalytics(stubEnv([], cap), 'site_1', 9999);
    expect(cap.sql).toContain("eventType IN ('form_start', 'form_submit')");
    expect(cap.sql).toContain("json_extract(payload, '$.form')");
    expect(cap.params).toEqual(['site_1', 30 * 86_400]);
  });
});
