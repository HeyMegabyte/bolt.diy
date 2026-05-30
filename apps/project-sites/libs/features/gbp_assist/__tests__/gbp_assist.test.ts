/**
 * Unit tests for the GBP Assist feature module (idea #9).
 *
 * All external dependencies (D1, Places, LLM, feature flags, token_burn_meter)
 * are mocked — no real network/DB. Covers: status detect (profile found +
 * none), content-pack generation + 750-char clamp, checklist done-state, and
 * the flag-off 404 path on every route.
 */

import { Hono } from 'hono';

// ─── Mocks (must precede service/handler imports) ───────────────────────────

const mockDbQueryOne = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
}));

const mockLookup = jest.fn();
jest.mock('../../../../src/services/google_places.js', () => ({
  lookupBusiness: (...a: unknown[]) => mockLookup(...a),
}));

const mockLLM = jest.fn();
jest.mock('../../../../src/services/external_llm.js', () => ({
  callExternalLLM: (...a: unknown[]) => mockLLM(...a),
}));

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

const mockRecordSpend = jest.fn();
jest.mock('../../token_burn_meter/service.js', () => ({
  recordSpend: (...a: unknown[]) => mockRecordSpend(...a),
}));

import { checkGbpStatus, generateContentPack, getSetupChecklist } from '../service.js';
import { gbpAssist } from '../handlers.js';
import { GBP_DESCRIPTION_MAX } from '../schemas.js';

const SITE = {
  id: 'site_1',
  business_name: "Vito's Mens Salon",
  business_address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
  business_phone: '+19735551234',
  business_website: 'https://vitos.example',
  google_place_id: null,
};

const env = { DB: {}, GOOGLE_PLACES_API_KEY: 'gk_test' } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockDbQueryOne.mockResolvedValue(SITE);
  mockRecordSpend.mockResolvedValue(undefined);
});

// ─── checkGbpStatus ─────────────────────────────────────────────────────────

describe('checkGbpStatus', () => {
  test('returns hasProfile=true + review deep-link when Places finds the place', async () => {
    mockLookup.mockResolvedValue({
      place_id: 'place_xyz',
      types: ['hair_salon'],
      rating: 4.8,
      review_count: 212,
    });

    const status = await checkGbpStatus(env, 'site_1');

    expect(status.hasProfile).toBe(true);
    expect(status.placeId).toBe('place_xyz');
    expect(status.category).toBe('hair_salon');
    expect(status.rating).toBe(4.8);
    expect(status.reviewCount).toBe(212);
    expect(status.deepLink).toContain('writereview?placeid=place_xyz');
  });

  test('returns hasProfile=false + create deep-link when no place is found', async () => {
    mockLookup.mockResolvedValue(null);

    const status = await checkGbpStatus(env, 'site_1');

    expect(status.hasProfile).toBe(false);
    expect(status.deepLink).toBe('https://business.google.com/create');
  });

  test('throws site_not_found when the site is missing', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    await expect(checkGbpStatus(env, 'missing')).rejects.toThrow('site_not_found');
  });
});

// ─── generateContentPack ────────────────────────────────────────────────────

describe('generateContentPack', () => {
  test('returns a validated pack and records best-effort spend', async () => {
    mockLLM.mockResolvedValue({
      output: JSON.stringify({
        primaryCategory: 'Hair salon',
        secondaryCategories: ['Barber shop', "Men's clothing store"],
        description: "Men's salon in Lake Hiawatha NJ offering precision cuts and hot-towel shaves.",
        services: ['Haircut', 'Beard trim', 'Hot-towel shave'],
        attributes: ['Wheelchair accessible', 'Appointments recommended'],
        firstPost: 'Now booking fall cuts — reserve your chair today.',
      }),
      model_used: 'gpt-4o-2024-11-20',
      token_count: 320,
      cost_estimate: 0.0021,
    });

    const pack = await generateContentPack(env, 'site_1', 'org_1');

    expect(pack.primaryCategory).toBe('Hair salon');
    expect(pack.secondaryCategories).toEqual(['Barber shop', "Men's clothing store"]);
    expect(pack.services).toContain('Hot-towel shave');
    expect(pack.firstPost).toMatch(/booking/i);
    expect(mockRecordSpend).toHaveBeenCalledWith(
      env,
      'org_1',
      expect.objectContaining({ model: 'gpt-4o-2024-11-20', usd: 0.0021, siteId: 'site_1' }),
    );
  });

  test('clamps an over-long description to the 750-char GBP limit at a word boundary', async () => {
    const longDesc = 'word '.repeat(400).trim(); // ~2000 chars
    mockLLM.mockResolvedValue({
      output: JSON.stringify({
        primaryCategory: 'Hair salon',
        secondaryCategories: [],
        description: longDesc,
        services: [],
        attributes: [],
        firstPost: 'Visit us today.',
      }),
      model_used: 'gpt-4o',
      token_count: 50,
      cost_estimate: 0.0005,
    });

    const pack = await generateContentPack(env, 'site_1');

    expect(pack.description.length).toBeLessThanOrEqual(GBP_DESCRIPTION_MAX);
    expect(pack.description.endsWith(' ')).toBe(false);
    expect(pack.description.startsWith('word')).toBe(true);
  });

  test('caps secondary categories at 9', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `Cat ${i}`);
    mockLLM.mockResolvedValue({
      output: JSON.stringify({
        primaryCategory: 'Hair salon',
        secondaryCategories: twelve,
        description: 'Short and valid.',
        services: [],
        attributes: [],
        firstPost: 'Hi.',
      }),
      model_used: 'gpt-4o',
      token_count: 10,
      cost_estimate: 0,
    });

    const pack = await generateContentPack(env, 'site_1');
    expect(pack.secondaryCategories).toHaveLength(9);
  });

  test('throws content_pack_parse_failed on non-JSON LLM output', async () => {
    mockLLM.mockResolvedValue({ output: 'not json', model_used: 'gpt-4o', token_count: 1, cost_estimate: 0 });
    await expect(generateContentPack(env, 'site_1')).rejects.toThrow('content_pack_parse_failed');
  });
});

// ─── getSetupChecklist ──────────────────────────────────────────────────────

describe('getSetupChecklist', () => {
  test('returns the 7 ordered steps all incomplete when no row exists', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const res = await getSetupChecklist(env, 'site_1');

    expect(res.siteId).toBe('site_1');
    expect(res.steps).toHaveLength(7);
    expect(res.steps[0].id).toBe('claim');
    expect(res.steps.every((s) => s.done === false)).toBe(true);
  });

  test('overlays persisted done-state from checklist_state JSON', async () => {
    mockDbQueryOne.mockResolvedValue({ checklist_state: JSON.stringify({ claim: true, verify: true }) });
    const res = await getSetupChecklist(env, 'site_1');

    expect(res.steps.find((s) => s.id === 'claim')?.done).toBe(true);
    expect(res.steps.find((s) => s.id === 'verify')?.done).toBe(true);
    expect(res.steps.find((s) => s.id === 'photos')?.done).toBe(false);
  });

  test('treats corrupt checklist_state as all-incomplete', async () => {
    mockDbQueryOne.mockResolvedValue({ checklist_state: '{not valid' });
    const res = await getSetupChecklist(env, 'site_1');
    expect(res.steps.every((s) => s.done === false)).toBe(true);
  });
});

// ─── flag-off 404 (every route) ─────────────────────────────────────────────

describe('handlers flag gating', () => {
  function appWith(flagOn: boolean, userId: string | null = 'user_1') {
    mockIsFlagOn.mockResolvedValue(flagOn);
    const app = new Hono();
    app.use('*', async (c, next) => {
      if (userId) c.set('userId', userId);
      c.set('orgId', 'org_1');
      await next();
    });
    app.route('/', gbpAssist);
    return app;
  }

  test('GET status returns 404 when flag off', async () => {
    const app = appWith(false);
    const res = await app.request('/api/sites/site_1/gbp/status');
    expect(res.status).toBe(404);
  });

  test('POST content-pack returns 404 when flag off', async () => {
    const app = appWith(false);
    const res = await app.request('/api/sites/site_1/gbp/content-pack', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  test('GET checklist returns 404 when flag off', async () => {
    const app = appWith(false);
    const res = await app.request('/api/sites/site_1/gbp/checklist');
    expect(res.status).toBe(404);
  });

  test('returns 401 when unauthenticated', async () => {
    const app = appWith(true, null);
    const res = await app.request('/api/sites/site_1/gbp/status');
    expect(res.status).toBe(401);
  });

  test('GET checklist returns 200 + steps when flag on', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const app = appWith(true);
    const res = await app.request('/api/sites/site_1/gbp/checklist', {}, { DB: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { steps: unknown[] };
    expect(body.steps).toHaveLength(7);
  });
});
