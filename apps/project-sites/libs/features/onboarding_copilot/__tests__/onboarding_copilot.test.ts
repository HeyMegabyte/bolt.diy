/**
 * Tests for the onboarding_copilot feature module.
 * Covers: buildChecklist service unit tests, flag-off 404, no-orgId 401,
 * checklist happy-path 200, and dismiss happy-path 200.
 */
import { Hono } from 'hono';

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

const mockDbQueryOne = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
  dbQuery: jest.fn().mockResolvedValue({ data: [] }),
  dbInsert: jest.fn().mockResolvedValue({}),
  dbExecute: jest.fn().mockResolvedValue(undefined),
}));

import { buildChecklist, FLAG_KEY, dismissedKey, DISMISS_TTL } from '../service.js';
import { onboardingCopilot } from '../handlers.js';

// ---------------------------------------------------------------------------
// CACHE_KV stub
// ---------------------------------------------------------------------------
const mockKvGet = jest.fn<Promise<string | null>, [string]>();
const mockKvPut = jest.fn<Promise<void>, [string, string, { expirationTtl?: number }]>();
const mockCacheKV = { get: mockKvGet, put: mockKvPut };

// ---------------------------------------------------------------------------
// App factory — mounts onboardingCopilot at /api/onboarding matching src/index
// ---------------------------------------------------------------------------
function app(orgId: string | null = null) {
  const a = new Hono<{ Bindings: { DB: unknown; CACHE_KV: typeof mockCacheKV }; Variables: { orgId: string } }>();
  a.use('*', async (c, next) => {
    // Inject KV stub into env
    (c.env as Record<string, unknown>).CACHE_KV = mockCacheKV;
    if (orgId !== null) (c as unknown as { set: (k: string, v: string) => void }).set('orgId', orgId);
    await next();
  });
  a.route('/api/onboarding', onboardingCopilot);
  return a;
}

const GET_CHECKLIST = (orgId: string | null = 'org-123') =>
  app(orgId).request(
    '/api/onboarding/checklist',
    { method: 'GET' },
    {} as never,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );

const POST_DISMISS = (orgId: string | null = 'org-123') =>
  app(orgId).request(
    '/api/onboarding/dismiss',
    { method: 'POST' },
    {} as never,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );

beforeEach(() => {
  mockIsFlagOn.mockReset();
  mockDbQueryOne.mockReset();
  mockKvGet.mockReset();
  mockKvPut.mockReset();
});

// ---------------------------------------------------------------------------
// 1. Service unit tests — buildChecklist
// ---------------------------------------------------------------------------
describe('buildChecklist()', () => {
  it('marks all steps incomplete when org is brand new', () => {
    const result = buildChecklist({ hasSite: false, hasPublished: false, hasDomain: false, dismissed: false });
    expect(result.complete).toBe(false);
    expect(result.dismissed).toBe(false);
    expect(result.steps[0].id).toBe('create_site');
    expect(result.steps[0].done).toBe(false);
    expect(result.steps[0].next).toBe(true);
    expect(result.steps.filter((s) => s.next).length).toBe(1);
  });

  it('marks create_site done and advances next to publish_site', () => {
    const result = buildChecklist({ hasSite: true, hasPublished: false, hasDomain: false, dismissed: false });
    expect(result.steps[0].done).toBe(true);
    expect(result.steps[0].next).toBe(false);
    expect(result.steps[1].id).toBe('publish_site');
    expect(result.steps[1].next).toBe(true);
  });

  it('marks first two steps done, advances next to add_custom_domain', () => {
    const result = buildChecklist({ hasSite: true, hasPublished: true, hasDomain: false, dismissed: false });
    expect(result.steps[0].done).toBe(true);
    expect(result.steps[1].done).toBe(true);
    expect(result.steps[2].id).toBe('add_custom_domain');
    expect(result.steps[2].next).toBe(true);
  });

  it('reflects dismissed flag in response', () => {
    const result = buildChecklist({ hasSite: false, hasPublished: false, hasDomain: false, dismissed: true });
    expect(result.dismissed).toBe(true);
  });

  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('onboarding_copilot');
  });

  it('builds the correct KV dismiss key', () => {
    expect(dismissedKey('org-abc')).toBe('onboarding:dismissed:org-abc');
  });

  it('exports DISMISS_TTL as 1 year in seconds', () => {
    expect(DISMISS_TTL).toBe(31_536_000);
  });
});

// ---------------------------------------------------------------------------
// 2. GET /checklist — flag off → 404
// ---------------------------------------------------------------------------
describe('GET /api/onboarding/checklist — flag gate', () => {
  it('returns 404 when the onboarding_copilot flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await GET_CHECKLIST();
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 3. GET /checklist — no orgId → 401
// ---------------------------------------------------------------------------
describe('GET /api/onboarding/checklist — auth', () => {
  it('returns 401 when no orgId is present', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET_CHECKLIST(null);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// 4. GET /checklist — happy path → 200
// ---------------------------------------------------------------------------
describe('GET /api/onboarding/checklist — happy path', () => {
  it('returns 200 with the full checklist for a new org', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    // D1 counts: 0 sites, 0 published, 0 domains
    mockDbQueryOne.mockResolvedValue({ n: 0 });
    mockKvGet.mockResolvedValue(null);

    const res = await GET_CHECKLIST();
    expect(res.status).toBe(200);

    const body = await res.json() as { dismissed: boolean; complete: boolean; steps: Array<{ id: string; done: boolean; next: boolean }> };
    expect(body.dismissed).toBe(false);
    expect(body.complete).toBe(false);
    expect(body.steps).toHaveLength(4);
    expect(body.steps[0].id).toBe('create_site');
    expect(body.steps[0].done).toBe(false);
    expect(body.steps[0].next).toBe(true);
  });

  it('reflects dismissed=true when KV returns "1"', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockDbQueryOne.mockResolvedValue({ n: 0 });
    mockKvGet.mockResolvedValue('1');

    const res = await GET_CHECKLIST();
    expect(res.status).toBe(200);
    const body = await res.json() as { dismissed: boolean };
    expect(body.dismissed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. POST /dismiss — flag off → 404
// ---------------------------------------------------------------------------
describe('POST /api/onboarding/dismiss — flag gate', () => {
  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await POST_DISMISS();
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 6. POST /dismiss — no orgId → 401
// ---------------------------------------------------------------------------
describe('POST /api/onboarding/dismiss — auth', () => {
  it('returns 401 when no orgId is present', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await POST_DISMISS(null);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// 7. POST /dismiss — happy path → 200
// ---------------------------------------------------------------------------
describe('POST /api/onboarding/dismiss — happy path', () => {
  it('writes to KV and returns {dismissed:true}', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockKvPut.mockResolvedValue(undefined);

    const res = await POST_DISMISS();
    expect(res.status).toBe(200);

    const body = await res.json() as { dismissed: boolean };
    expect(body.dismissed).toBe(true);
    expect(mockKvPut).toHaveBeenCalledWith(
      dismissedKey('org-123'),
      '1',
      { expirationTtl: DISMISS_TTL },
    );
  });
});
