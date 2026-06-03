/**
 * @module __tests__/section_marketplace_submissions
 * @description Service tests for the Section Marketplace creator-submission flow
 *              (IDEAS-50 #40). Convergence r35 — ADDITIVE coverage.
 *
 * This module is deliberately separate from `services/section_marketplace.ts`
 * (the read-only catalog, covered by `section_marketplace.test.ts`). Here we lock
 * the WRITE/curation path: `submitSection`, `reviewSubmission` (approve / reject /
 * not-found / not-pending), and `listPendingSubmissions`.
 *
 * Every call funnels through the `db.ts` helpers, which do
 * `db.prepare(sql).bind(...params).run()/.all()`. So a single SQL-routing D1
 * double drives the whole path and captures the bound params.
 */

import {
  submitSection,
  reviewSubmission,
  listPendingSubmissions,
  SectionSubmissionSchema,
  SectionIndustrySchema,
  SectionSlotSchema,
  SectionSubmissionStatusSchema,
  type SectionSubmission,
} from '../services/section_marketplace_submissions.js';
import type { Env } from '../types/env.js';

interface Captured {
  sql: string;
  params: unknown[];
}

/**
 * D1 double for the db.ts helper surface.
 *
 * - `.bind(...).run()`  → INSERT/UPDATE path; captures sql+params, returns meta.
 * - `.bind(...).all()`  → SELECT path; captures sql+params, returns `rows`.
 * - `firstRow` answers the `dbQueryOne` (`.all()` → `data[0]`) read used by
 *   `reviewSubmission`'s lookup. When `throwOn` matches the sql, the bound stmt
 *   rejects so we can exercise the helpers' error envelope.
 */
function subDb(opts: {
  rows?: unknown[];
  firstRow?: unknown;
  sink?: Captured[];
  throwOn?: RegExp;
}): Env['DB'] {
  const { rows, firstRow, sink, throwOn } = opts;
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => {
        sink?.push({ sql, params });
        const reject = throwOn && throwOn.test(sql);
        return {
          run: async () => {
            if (reject) throw new Error('boom');
            return { meta: { changes: 1 } };
          },
          all: async () => {
            if (reject) throw new Error('boom');
            // dbQueryOne reads data[0]; dbQuery reads the whole array.
            const results = rows ?? (firstRow !== undefined ? [firstRow] : []);
            return { results };
          },
          first: async () => firstRow ?? null,
        };
      },
    }),
  } as unknown as Env['DB'];
}

const env = (opts: Parameters<typeof subDb>[0] = {}) =>
  ({ DB: subDb(opts) }) as unknown as Env;

const validSubmission: SectionSubmission = {
  industry: 'nonprofit',
  name: 'Volunteer Heatmap',
  slot: 'services',
  html_template: '<section>{{volunteers}} volunteers this month</section>',
  css_template: 'section { display: grid; }',
  data_schema: { type: 'object', required: ['volunteers'] },
  price_cents: 1500,
};

// ─── Zod schema contracts ────────────────────────────────────────────
describe('SectionSubmissionSchema', () => {
  it('accepts a well-formed submission', () => {
    expect(SectionSubmissionSchema.safeParse(validSubmission).success).toBe(true);
  });

  it('defaults data_schema to {} when omitted', () => {
    const { data_schema: _omit, ...rest } = validSubmission;
    const parsed = SectionSubmissionSchema.parse(rest);
    expect(parsed.data_schema).toEqual({});
  });

  it('rejects an unknown industry', () => {
    expect(
      SectionSubmissionSchema.safeParse({ ...validSubmission, industry: 'crypto' }).success,
    ).toBe(false);
  });

  it('rejects an unknown slot', () => {
    expect(
      SectionSubmissionSchema.safeParse({ ...validSubmission, slot: 'banner' }).success,
    ).toBe(false);
  });

  it('rejects a name shorter than 3 chars', () => {
    expect(SectionSubmissionSchema.safeParse({ ...validSubmission, name: 'ab' }).success).toBe(
      false,
    );
  });

  it('rejects an html_template under the 20-char floor', () => {
    expect(
      SectionSubmissionSchema.safeParse({ ...validSubmission, html_template: '<p>x</p>' }).success,
    ).toBe(false);
  });

  it('rejects a negative price', () => {
    expect(
      SectionSubmissionSchema.safeParse({ ...validSubmission, price_cents: -1 }).success,
    ).toBe(false);
  });

  it('rejects a price above the $100 ceiling', () => {
    expect(
      SectionSubmissionSchema.safeParse({ ...validSubmission, price_cents: 10_001 }).success,
    ).toBe(false);
  });

  it('rejects a non-integer price', () => {
    expect(
      SectionSubmissionSchema.safeParse({ ...validSubmission, price_cents: 12.5 }).success,
    ).toBe(false);
  });

  it('allows an empty css_template (min 0)', () => {
    expect(
      SectionSubmissionSchema.safeParse({ ...validSubmission, css_template: '' }).success,
    ).toBe(true);
  });

  it('enum schemas enumerate the expected values', () => {
    expect(SectionIndustrySchema.options).toEqual([
      'nonprofit',
      'restaurant',
      'lawyer',
      'salon',
      'medical',
    ]);
    expect(SectionSlotSchema.options).toEqual([
      'hero',
      'services',
      'testimonials',
      'donor-wall',
      'faq',
      'cta',
    ]);
    expect(SectionSubmissionStatusSchema.options).toEqual(['pending', 'approved', 'rejected']);
  });
});

// ─── submitSection ───────────────────────────────────────────────────
describe('submitSection', () => {
  it('inserts into section_marketplace as pending and returns the id', async () => {
    const sink: Captured[] = [];
    const result = await submitSection(env({ sink }), validSubmission, 'usr_creator_42');

    expect(result.ok).toBe(true);
    expect(result.submission_status).toBe('pending');
    expect(result.id).toMatch(/^sec_/);

    const insert = sink.find((c) => /INSERT INTO section_marketplace/.test(c.sql));
    expect(insert).toBeDefined();
  });

  it('stamps submission_status=pending, quality_score 0, fork_count 0, and the creator', async () => {
    const sink: Captured[] = [];
    await submitSection(env({ sink }), validSubmission, 'usr_creator_42');

    const insert = sink.find((c) => /INSERT INTO section_marketplace/.test(c.sql))!;
    // params align with the column list in the INSERT (db.ts uses object-key order).
    expect(insert.params).toContain('pending');
    expect(insert.params).toContain('usr_creator_42'); // author AND creator_user_id
    expect(insert.params).toContain(1500); // price_cents passthrough
    expect(insert.params).toContain(0); // quality_score / fork_count seeds
  });

  it('serializes data_schema to JSON on the insert', async () => {
    const sink: Captured[] = [];
    await submitSection(env({ sink }), validSubmission, 'usr_creator_42');
    const insert = sink.find((c) => /INSERT INTO section_marketplace/.test(c.sql))!;
    expect(insert.params).toContain(JSON.stringify(validSubmission.data_schema));
  });

  it('handles an empty data_schema ({}) without error', async () => {
    const sink: Captured[] = [];
    const sub: SectionSubmission = { ...validSubmission, data_schema: {} };
    const result = await submitSection(env({ sink }), sub, 'usr_x');
    expect(result.ok).toBe(true);
    const insert = sink.find((c) => /INSERT INTO section_marketplace/.test(c.sql))!;
    expect(insert.params).toContain('{}');
  });

  it('throws DB_INSERT_FAILED when the insert errors', async () => {
    await expect(
      submitSection(env({ throwOn: /INSERT INTO section_marketplace/ }), validSubmission, 'u'),
    ).rejects.toThrow(/DB_INSERT_FAILED/);
  });

  it('generates a unique id per submission', async () => {
    const a = await submitSection(env(), validSubmission, 'u');
    const b = await submitSection(env(), validSubmission, 'u');
    expect(a.id).not.toBe(b.id);
  });
});

// ─── reviewSubmission ────────────────────────────────────────────────
describe('reviewSubmission', () => {
  it('throws SUBMISSION_NOT_FOUND when the id does not resolve', async () => {
    await expect(
      reviewSubmission(env({ firstRow: undefined }), {
        id: 'ghost',
        decision: 'approve',
        reviewer_user_id: 'admin',
      }),
    ).rejects.toThrow('SUBMISSION_NOT_FOUND');
  });

  it('throws SUBMISSION_NOT_PENDING when already approved', async () => {
    await expect(
      reviewSubmission(env({ firstRow: { id: 's1', submission_status: 'approved' } }), {
        id: 's1',
        decision: 'approve',
        reviewer_user_id: 'admin',
      }),
    ).rejects.toThrow('SUBMISSION_NOT_PENDING');
  });

  it('throws SUBMISSION_NOT_PENDING when already rejected', async () => {
    await expect(
      reviewSubmission(env({ firstRow: { id: 's1', submission_status: 'rejected' } }), {
        id: 's1',
        decision: 'reject',
        reviewer_user_id: 'admin',
      }),
    ).rejects.toThrow('SUBMISSION_NOT_PENDING');
  });

  it('approve → status approved + reviewer + default quality_score 5.0', async () => {
    const sink: Captured[] = [];
    const result = await reviewSubmission(
      env({ firstRow: { id: 's1', submission_status: 'pending' }, sink }),
      { id: 's1', decision: 'approve', reviewer_user_id: 'admin' },
    );

    expect(result).toEqual({ ok: true, id: 's1', submission_status: 'approved' });
    const upd = sink.find((c) => /UPDATE section_marketplace/.test(c.sql))!;
    expect(upd.params).toContain('approved');
    expect(upd.params).toContain('admin');
    expect(upd.params).toContain(5.0);
    expect(upd.params).toContain('s1'); // WHERE id = ?
  });

  it('approve honors an explicit quality_score override', async () => {
    const sink: Captured[] = [];
    await reviewSubmission(
      env({ firstRow: { id: 's1', submission_status: 'pending' }, sink }),
      { id: 's1', decision: 'approve', reviewer_user_id: 'admin', quality_score: 9 },
    );
    const upd = sink.find((c) => /UPDATE section_marketplace/.test(c.sql))!;
    expect(upd.params).toContain(9);
    expect(upd.params).not.toContain(5.0);
  });

  it('reject → status rejected + records the rejection_reason', async () => {
    const sink: Captured[] = [];
    const result = await reviewSubmission(
      env({ firstRow: { id: 's1', submission_status: 'pending' }, sink }),
      {
        id: 's1',
        decision: 'reject',
        reviewer_user_id: 'admin',
        rejection_reason: 'Inline styles not allowed',
      },
    );

    expect(result).toEqual({ ok: true, id: 's1', submission_status: 'rejected' });
    const upd = sink.find((c) => /UPDATE section_marketplace/.test(c.sql))!;
    expect(upd.params).toContain('rejected');
    expect(upd.params).toContain('Inline styles not allowed');
    expect(upd.params).toContain('admin');
  });

  it('reject without a reason stores null', async () => {
    const sink: Captured[] = [];
    await reviewSubmission(env({ firstRow: { id: 's1', submission_status: 'pending' }, sink }), {
      id: 's1',
      decision: 'reject',
      reviewer_user_id: 'admin',
    });
    const upd = sink.find((c) => /UPDATE section_marketplace/.test(c.sql))!;
    expect(upd.params).toContain(null);
  });

  it('binds the id (deleted_at guard) on the lookup read', async () => {
    const sink: Captured[] = [];
    await reviewSubmission(env({ firstRow: { id: 's1', submission_status: 'pending' }, sink }), {
      id: 's1',
      decision: 'approve',
      reviewer_user_id: 'admin',
    });
    const lookup = sink.find((c) => /SELECT id, submission_status/.test(c.sql))!;
    expect(lookup.sql).toContain('deleted_at IS NULL');
    expect(lookup.params).toEqual(['s1']);
  });
});

// ─── listPendingSubmissions ──────────────────────────────────────────
describe('listPendingSubmissions', () => {
  it('queries only pending, non-deleted rows ordered oldest-first', async () => {
    const sink: Captured[] = [];
    await listPendingSubmissions(env({ rows: [], sink }));
    const q = sink[0]!;
    expect(q.sql).toContain("submission_status = 'pending'");
    expect(q.sql).toContain('deleted_at IS NULL');
    expect(q.sql).toContain('ORDER BY submitted_at ASC');
  });

  it('defaults the limit to 100', async () => {
    const sink: Captured[] = [];
    await listPendingSubmissions(env({ rows: [], sink }));
    expect(sink[0]!.params).toEqual([100]);
  });

  it('caps the limit at 500', async () => {
    const sink: Captured[] = [];
    await listPendingSubmissions(env({ rows: [], sink }), 9999);
    expect(sink[0]!.params).toEqual([500]);
  });

  it('passes a smaller explicit limit through unchanged', async () => {
    const sink: Captured[] = [];
    await listPendingSubmissions(env({ rows: [], sink }), 25);
    expect(sink[0]!.params).toEqual([25]);
  });

  it('returns the rows it gets back', async () => {
    const rows = [
      {
        id: 'sec_1',
        industry: 'nonprofit',
        name: 'Heatmap',
        slot: 'services',
        price_cents: 1500,
        creator_user_id: 'usr_1',
        submitted_at: '2026-01-01T00:00:00Z',
      },
    ];
    const out = await listPendingSubmissions(env({ rows }));
    expect(out).toEqual(rows);
  });

  it('returns [] when there are no pending submissions', async () => {
    const out = await listPendingSubmissions(env({ rows: [] }));
    expect(out).toEqual([]);
  });
});
