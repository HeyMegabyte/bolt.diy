/**
 * @module __tests__/section_marketplace
 * @description Service + route tests for the Vertical Section Marketplace (#8).
 *
 * This module is a GLOBAL curated catalog (no per-tenant rows): builders browse
 * + fork bento sections shared across all orgs. So these tests lock the catalog
 * query shapes + the `section_marketplace` flag gate (404 when off, never 403),
 * NOT tenant isolation (there is no org-scoped data here by design).
 *
 * Both the routes (flag read via `env.DB.prepare(...).first()`) and the services
 * (`.bind().all()/.first()/.run()`) hit D1 directly, so a single SQL-routing D1
 * double drives the whole path and captures bound params.
 */

import { sectionMarketplace } from '../routes/section_marketplace.js';
import {
  listSectionsByIndustry,
  getSectionVariant,
  forkSection,
  getMarketplaceCatalog,
} from '../services/section_marketplace.js';
import { authApp } from './helpers/route_harness.js';
import type { Env } from '../types/env.js';

interface Captured {
  sql: string;
  params: unknown[];
}

/**
 * D1 double: answers the flag lookup, returns `rows` from `.all()`, `one` from
 * `.first()` (catalog/variant reads), and captures every prepared SQL + bound
 * params into `sink`.
 */
function mpDb(opts: {
  flagOn?: boolean;
  rows?: unknown[];
  one?: unknown;
  sink?: Captured[];
}): Env['DB'] {
  const { flagOn = true, rows = [], one = null, sink } = opts;
  return {
    prepare: (sql: string) => ({
      // assertFlagOn: `.prepare(...).first()` with no bind
      first: async () =>
        /feature_flags/.test(sql) ? { enabled: flagOn ? 1 : 0 } : (one as unknown),
      bind: (...params: unknown[]) => {
        sink?.push({ sql, params });
        return {
          first: async () => one as unknown,
          all: async () => ({ results: rows }),
          run: async () => ({ meta: {} }),
        };
      },
      all: async () => ({ results: rows }),
    }),
  } as unknown as Env['DB'];
}

const env = (opts: Parameters<typeof mpDb>[0]) => ({ DB: mpDb(opts) }) as unknown as Env;

// ─── service: listSectionsByIndustry ─────────────────────────────────
describe('listSectionsByIndustry (catalog query)', () => {
  it('base query filters only by deleted_at, binds limit', async () => {
    const sink: Captured[] = [];
    await listSectionsByIndustry(env({ sink }), undefined, undefined, 25);
    expect(sink[0]!.sql).toContain('WHERE deleted_at IS NULL');
    expect(sink[0]!.sql).not.toContain('AND industry = ?');
    expect(sink[0]!.params).toEqual(['25']);
  });

  it('adds an industry predicate when given', async () => {
    const sink: Captured[] = [];
    await listSectionsByIndustry(env({ sink }), 'nonprofit', undefined, 50);
    expect(sink[0]!.sql).toContain('AND industry = ?');
    expect(sink[0]!.params).toEqual(['nonprofit', '50']);
  });

  it('adds a slot predicate when given', async () => {
    const sink: Captured[] = [];
    await listSectionsByIndustry(env({ sink }), undefined, 'hero', 50);
    expect(sink[0]!.sql).toContain('AND slot = ?');
    expect(sink[0]!.params).toEqual(['hero', '50']);
  });

  it('binds industry + slot + limit in order', async () => {
    const sink: Captured[] = [];
    await listSectionsByIndustry(env({ sink }), 'salon', 'cta', 10);
    expect(sink[0]!.params).toEqual(['salon', 'cta', '10']);
  });

  it('maps rows to summaries with extracted schema fields', async () => {
    const rows = [
      {
        id: 's1',
        industry: 'nonprofit',
        name: 'Warm Hero',
        slot: 'hero',
        quality_score: 9,
        author: 'team',
        fork_count: 3,
        data_schema: JSON.stringify({ required: ['title', 'subtitle'] }),
      },
    ];
    const out = await listSectionsByIndustry(env({ rows }), 'nonprofit');
    expect(out).toHaveLength(1);
    expect(out[0]!.data_schema_fields).toEqual(['title', 'subtitle']);
    expect(out[0]!.fork_count).toBe(3);
  });
});

// ─── service: getSectionVariant ──────────────────────────────────────
describe('getSectionVariant', () => {
  it('binds the id and parses data_schema', async () => {
    const sink: Captured[] = [];
    const one = {
      id: 's1',
      industry: 'restaurant',
      name: 'Menu Grid',
      slot: 'services',
      html_template: '<section></section>',
      css_template: '.x{}',
      data_schema: JSON.stringify({ properties: { items: {} } }),
      quality_score: 8,
      author: 'team',
      fork_count: 0,
      created_at: 't',
      updated_at: 't',
    };
    const variant = await getSectionVariant(env({ one, sink }), 's1');
    expect(sink[0]!.params).toEqual(['s1']);
    expect(variant?.data_schema).toEqual({ properties: { items: {} } });
  });

  it('returns null for a missing variant', async () => {
    expect(await getSectionVariant(env({ one: null }), 'ghost')).toBeNull();
  });
});

// ─── service: forkSection ────────────────────────────────────────────
describe('forkSection', () => {
  it('issues an UPDATE then re-reads the fork_count', async () => {
    const sink: Captured[] = [];
    const out = await forkSection(env({ one: { id: 's1', fork_count: 4 }, sink }), 's1');
    expect(sink.some((c) => /UPDATE section_marketplace SET fork_count/.test(c.sql))).toBe(true);
    expect(out).toEqual({ id: 's1', fork_count: 4 });
  });

  it('defaults fork_count to 0 when the re-read misses', async () => {
    const out = await forkSection(env({ one: null }), 's1');
    expect(out.fork_count).toBe(0);
  });
});

// ─── service: getMarketplaceCatalog ──────────────────────────────────
describe('getMarketplaceCatalog', () => {
  it('splits GROUP_CONCAT slots into an array', async () => {
    const rows = [{ industry: 'nonprofit', section_count: 6, slots: 'hero,cta,faq' }];
    const out = await getMarketplaceCatalog(env({ rows }));
    expect(out[0]!.slots).toEqual(['hero', 'cta', 'faq']);
    expect(out[0]!.section_count).toBe(6);
  });
});

// ─── routes: flag gate + happy paths ─────────────────────────────────
describe('section_marketplace routes', () => {
  it('GET /api/section-marketplace → 404 when flag off', async () => {
    const app = authApp(sectionMarketplace, { userId: 'u', orgId: 'org-a' });
    const res = await app.request('/api/section-marketplace', {}, env({ flagOn: false }));
    expect(res.status).toBe(404);
  });

  it('GET /api/section-marketplace → 200 catalog when flag on', async () => {
    const app = authApp(sectionMarketplace, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      '/api/section-marketplace',
      {},
      env({ flagOn: true, rows: [{ industry: 'nonprofit', section_count: 6, slots: 'hero' }] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total_industries: number };
    expect(body.total_industries).toBe(1);
  });

  it('GET /sections/:id → 404 when the variant is missing', async () => {
    const app = authApp(sectionMarketplace, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      '/api/section-marketplace/sections/ghost',
      {},
      env({ flagOn: true, one: null }),
    );
    expect(res.status).toBe(404);
  });

  it('POST /sections/:id/fork → 404 when flag off', async () => {
    const app = authApp(sectionMarketplace, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      '/api/section-marketplace/sections/s1/fork',
      { method: 'POST' },
      env({ flagOn: false }),
    );
    expect(res.status).toBe(404);
  });
});
