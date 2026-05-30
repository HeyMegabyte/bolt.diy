/**
 * Route-LAYER tests for review_synthesis handlers (Hono app.request + harness).
 * Covers: POST 401/404-flag-off/404-cross-org/200-empty-synthesis (placeId null),
 * public GET 404-flag-off / 200-with-stored-synthesis.
 */

import { reviewSynthesis } from '../handlers.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

/** D1 double: site lookup (configurable org) + stored synthesis row (optional). */
function db(opts: { siteOrg?: string | null; stored?: boolean } = {}) {
  const siteOrg = opts.siteOrg === undefined ? 'org1' : opts.siteOrg;
  function prepare(sql: string) {
    const api = {
      bind: () => api,
      first: async () => null,
      run: async () => ({ meta: { changes: 1 } }),
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('FROM sites WHERE id')) {
          return {
            results: (siteOrg
              ? [{ id: 'site1', org_id: siteOrg, business_name: 'Vitos', google_place_id: null }]
              : []) as unknown as T[],
          };
        }
        if (sql.includes('FROM review_syntheses')) {
          return {
            results: (opts.stored
              ? [
                  {
                    id: 'syn1',
                    site_id: 'site1',
                    org_id: 'org1',
                    summary: '4.5-star...',
                    featured_json: '[]',
                    rating_value: 4.5,
                    review_count: 2,
                    ai_model: null,
                    created_at: '2026-05-29',
                  },
                ]
              : []) as unknown as T[],
          };
        }
        return { results: [] };
      },
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

describe('review_synthesis handlers (route layer)', () => {
  it('POST 401 when unauthenticated', async () => {
    const app = authApp(reviewSynthesis);
    expect(
      (
        await app.request(
          '/api/reviews/site1/synthesize',
          { method: 'POST' },
          harnessEnv(db(), true),
        )
      ).status,
    ).toBe(401);
  });

  it('POST 404 when flag off', async () => {
    const app = authApp(reviewSynthesis, { userId: 'u', orgId: 'org1' });
    expect(
      (
        await app.request(
          '/api/reviews/site1/synthesize',
          { method: 'POST' },
          harnessEnv(db(), false),
        )
      ).status,
    ).toBe(404);
  });

  it('POST 404 when site belongs to another org', async () => {
    const app = authApp(reviewSynthesis, { userId: 'u', orgId: 'org1' });
    expect(
      (
        await app.request(
          '/api/reviews/site1/synthesize',
          { method: 'POST' },
          harnessEnv(db({ siteOrg: 'OTHER' }), true),
        )
      ).status,
    ).toBe(404);
  });

  it('POST 200 synthesizes (no place id → empty, non-fabricated)', async () => {
    const app = authApp(reviewSynthesis, { userId: 'u', orgId: 'org1' });
    const res = await app.request(
      '/api/reviews/site1/synthesize',
      { method: 'POST' },
      harnessEnv(db(), true),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { aggregate: { reviewCount: number }; summary: string };
    expect(body.aggregate.reviewCount).toBe(0);
    expect(body.summary).toBe('');
  });

  it('public GET: 404 flag off, 200 with stored synthesis + jsonLd field', async () => {
    const open = authApp(reviewSynthesis);
    expect(
      (await open.request('/api/reviews/site1', {}, harnessEnv(db({ stored: true }), false)))
        .status,
    ).toBe(404);
    const res = await open.request(
      '/api/reviews/site1',
      {},
      harnessEnv(db({ stored: true }), true),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { synthesis: unknown; jsonLd: unknown };
    expect(body.synthesis).toBeDefined();
    expect('jsonLd' in body).toBe(true); // null is fine (0 reviews) but key present
  });
});
