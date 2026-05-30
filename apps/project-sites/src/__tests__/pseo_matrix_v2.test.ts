/**
 * @module __tests__/pseo_matrix_v2
 * @description Unit tests for pSEO Matrix v2 schemas + pure helpers + the
 * service `siteOrgId` resolver + route-layer multi-tenant isolation (feature #29).
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbExecute: jest.fn().mockResolvedValue({ error: null }),
}));

import { dbQuery, dbQueryOne } from '../services/db.js';
import {
  axisComboHash,
  comboToSlug,
  computeUniqueDataPct,
  PseoAxisSchema,
  PseoGenerateRequestSchema,
  UNIQUE_DATA_FLOOR_PCT,
  MAX_PAGES_PER_AXIS,
} from '../../libs/features/pseo_matrix/feature.schemas.js';
import { siteOrgId } from '../services/pseo_matrix_v2.js';
import { pseoMatrixV2Routes } from '../routes/pseo_matrix_v2.js';
import { authApp, harnessEnv } from './helpers/route_harness.js';
import type { Env } from '../types/env.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
});

describe('pseo_matrix_v2 schemas', () => {
  it('UNIQUE_DATA_FLOOR_PCT is 40 (post-March-2026 floor)', () => {
    expect(UNIQUE_DATA_FLOOR_PCT).toBe(40);
  });

  it('caps axes at 200 values per axis', () => {
    expect(MAX_PAGES_PER_AXIS).toBe(200);
    const tooMany = { axisName: 'city', values: Array.from({ length: 201 }, () => 'x') };
    expect(PseoAxisSchema.safeParse(tooMany).success).toBe(false);
  });

  it('rejects malformed axis names', () => {
    expect(PseoAxisSchema.safeParse({ axisName: 'BadName', values: ['x'] }).success).toBe(false);
    expect(PseoAxisSchema.safeParse({ axisName: 'good_name', values: ['x'] }).success).toBe(true);
  });

  it('PseoGenerateRequest requires >=1 axis', () => {
    expect(PseoGenerateRequestSchema.safeParse({ axes: [] }).success).toBe(false);
    expect(
      PseoGenerateRequestSchema.safeParse({
        axes: [{ axisName: 'task', values: ['x'], cap: 1 }],
      }).success,
    ).toBe(true);
  });

  it('axisComboHash is deterministic regardless of key order', () => {
    const a = axisComboHash({ city: 'Newark', task: 'book-now' });
    const b = axisComboHash({ task: 'book-now', city: 'Newark' });
    expect(a).toBe(b);
  });

  it('axisComboHash distinguishes different combos', () => {
    expect(axisComboHash({ city: 'Newark' })).not.toBe(axisComboHash({ city: 'Trenton' }));
  });

  it('comboToSlug builds clean kebab paths', () => {
    expect(comboToSlug({ task: 'Book Now', city: 'Newark NJ' })).toBe('/tasks/book-now/newark-nj');
    expect(comboToSlug({ city: 'New York City' }, '/c')).toBe('/c/new-york-city');
  });

  it('computeUniqueDataPct returns 0 for empty content', () => {
    expect(computeUniqueDataPct({ googlePlaces: 0, reviews: 0, pricing: 0, other: 0 }, 0)).toBe(0);
  });

  it('computeUniqueDataPct passes 40% floor with enough real-data points', () => {
    // 4 places (100pts) + 4 reviews (60pts) + 2 pricing (40pts) = 200 source pts
    // wordCount 500 → 200/500 = 40% exactly.
    const pct = computeUniqueDataPct({ googlePlaces: 4, reviews: 4, pricing: 2, other: 0 }, 500);
    expect(pct).toBeGreaterThanOrEqual(40);
  });

  it('computeUniqueDataPct flags below-floor for keyword-only content', () => {
    // Zero real-data points + 1000 word count → 0%
    const pct = computeUniqueDataPct({ googlePlaces: 0, reviews: 0, pricing: 0, other: 0 }, 1000);
    expect(pct).toBe(0);
    expect(pct).toBeLessThan(UNIQUE_DATA_FLOOR_PCT);
  });

  it('computeUniqueDataPct clamps at 100', () => {
    const pct = computeUniqueDataPct(
      { googlePlaces: 100, reviews: 100, pricing: 100, other: 100 },
      100,
    );
    expect(pct).toBe(100);
  });
});

// ─── Service: siteOrgId (tenant-ownership resolver) ──────────────────
describe('siteOrgId', () => {
  it('returns the owning org for an existing site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org_7' } as never);
    expect(await siteOrgId({ DB: {} } as never, 'site_1')).toBe('org_7');
    const [, sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain('SELECT org_id FROM sites');
    expect(params).toEqual(['site_1']);
  });

  it('returns undefined for a missing site', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await siteOrgId({ DB: {} } as never, 'ghost')).toBeUndefined();
  });
});

// ─── Route layer: auth + flag + tenant isolation ─────────────────────
describe('pseo_matrix_v2 handler (route layer — tenant isolation)', () => {
  // isFlagOn reads CACHE_KV (flagKv); the flag-off path falls through to
  // env.DB.prepare — this stub keeps that resolving to the registry default.
  const routeDb = () =>
    ({
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: {} }),
        }),
      }),
    }) as unknown as Env['DB'];
  const env = (flagOn: boolean) => harnessEnv(routeDb(), flagOn) as Env;
  const AXES = '/site1/pseo/v2/axes';

  it('401 when unauthenticated', async () => {
    const app = authApp(pseoMatrixV2Routes);
    expect((await app.request(AXES, {}, env(true))).status).toBe(401);
  });

  it('404 when the flag is off', async () => {
    const app = authApp(pseoMatrixV2Routes, { userId: 'u', orgId: 'org-a' });
    expect((await app.request(AXES, {}, env(false))).status).toBe(404);
  });

  it('404 listing axes for a site owned by another org (cross-org read blocked)', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as never); // siteOrgId
    const app = authApp(pseoMatrixV2Routes, { userId: 'u', orgId: 'org-a' });
    expect((await app.request(AXES, {}, env(true))).status).toBe(404);
  });

  it('404 listing axes for a non-existent site', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // siteOrgId → undefined
    const app = authApp(pseoMatrixV2Routes, { userId: 'u', orgId: 'org-a' });
    expect((await app.request(AXES, {}, env(true))).status).toBe(404);
  });

  it('200 lists axes for an org-owned site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as never); // siteOrgId owned
    mockQuery.mockResolvedValueOnce({ data: [], error: null }); // listAxes
    const app = authApp(pseoMatrixV2Routes, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(AXES, {}, env(true));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { siteId: string };
    expect(body.siteId).toBe('site1');
  });

  it('404 publishing onto a site owned by another org (no publish path)', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as never); // siteOrgId
    const app = authApp(pseoMatrixV2Routes, { userId: 'u', orgId: 'org-a' });
    const res = await app.request(
      '/site1/pseo/v2/publish',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageIds: ['p1'] }),
      },
      env(true),
    );
    expect(res.status).toBe(404);
  });
});
