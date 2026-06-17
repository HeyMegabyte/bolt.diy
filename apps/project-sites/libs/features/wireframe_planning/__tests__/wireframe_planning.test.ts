/**
 * Unit + route-layer tests for the wireframe_planning feature module.
 *
 * All external deps (D1, feature flags) are mocked — no network/DB.
 * Covers service (buildWireframePlan / getWireframePlan) and every route
 * (flag-off 404, missing siteId 400, valid POST 201, GET null, GET with plan).
 */

import { Hono } from 'hono';

// ─── Mocks (must precede service/handler imports) ───────────────────────────

const mockDbInsert = jest.fn();
const mockDbQuery = jest.fn();
const mockDbQueryOne = jest.fn();
const mockDbExecute = jest.fn();

jest.mock('../../../../src/services/db.js', () => ({
  dbInsert: (...a: unknown[]) => mockDbInsert(...a),
  dbQuery: (...a: unknown[]) => mockDbQuery(...a),
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
  dbExecute: (...a: unknown[]) => mockDbExecute(...a),
}));

const mockIsFlagOn = jest.fn();

jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

import { buildWireframePlan, getWireframePlan } from '../service.js';
import { wireframePlanning } from '../handlers.js';

const env = { DB: {} } as never;

/** Mount the handler under a parent app that injects an optional authed user. */
function appWith(userId?: string): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    await next();
  });
  app.route('/', wireframePlanning);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbInsert.mockResolvedValue(undefined);
  mockDbExecute.mockResolvedValue(undefined);
  mockDbQuery.mockResolvedValue({ data: [] });
  mockDbQueryOne.mockResolvedValue(null);
  mockIsFlagOn.mockResolvedValue(true);
});

// ─── service: buildWireframePlan ────────────────────────────────────────────

describe('buildWireframePlan', () => {
  it('inserts a row and returns a plan with default sections', async () => {
    const plan = await buildWireframePlan(env, 'site_1', 'Build me a plumbing website');
    expect(plan.siteId).toBe('site_1');
    expect(plan.prompt).toBe('Build me a plumbing website');
    expect(plan.sections).toEqual(['Hero', 'About', 'Services', 'Contact']);
    expect(typeof plan.id).toBe('string');
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockDbInsert.mock.calls[0];
    expect(table).toBe('wireframe_plans');
    expect(record).toMatchObject({ site_id: 'site_1', prompt: 'Build me a plumbing website' });
  });
});

// ─── service: getWireframePlan ──────────────────────────────────────────────

describe('getWireframePlan', () => {
  it('returns null when no row exists', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const plan = await getWireframePlan(env, 'site_missing');
    expect(plan).toBeNull();
  });

  it('deserializes and returns the plan when a row exists', async () => {
    mockDbQueryOne.mockResolvedValue({
      id: 'plan_1',
      site_id: 'site_1',
      prompt: 'A bakery website',
      sections: JSON.stringify(['Hero', 'Menu', 'Contact']),
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const plan = await getWireframePlan(env, 'site_1');
    expect(plan).toMatchObject({
      id: 'plan_1',
      siteId: 'site_1',
      prompt: 'A bakery website',
      sections: ['Hero', 'Menu', 'Contact'],
    });
  });
});

// ─── routes: POST /api/wireframe/plan ───────────────────────────────────────

describe('POST /api/wireframe/plan', () => {
  const body = (o: Record<string, unknown>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(o),
  });

  it('404s when the flag is off (no leak)', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await appWith('user_1').request(
      '/api/wireframe/plan',
      body({ siteId: 'site_1', prompt: 'A great plumbing website' }),
      env,
    );
    expect(res.status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('401s without auth', async () => {
    const res = await appWith().request(
      '/api/wireframe/plan',
      body({ siteId: 'site_1', prompt: 'A great plumbing website' }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('400s when siteId is missing', async () => {
    const res = await appWith('user_1').request(
      '/api/wireframe/plan',
      body({ prompt: 'A great plumbing website' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('400s when prompt is too short', async () => {
    const res = await appWith('user_1').request(
      '/api/wireframe/plan',
      body({ siteId: 'site_1', prompt: 'short' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('201s and returns the plan on a valid request', async () => {
    const res = await appWith('user_1').request(
      '/api/wireframe/plan',
      body({ siteId: 'site_1', prompt: 'A great plumbing website please' }),
      env,
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; plan: { siteId: string; sections: string[] } };
    expect(json.ok).toBe(true);
    expect(json.plan.siteId).toBe('site_1');
    expect(json.plan.sections).toEqual(['Hero', 'About', 'Services', 'Contact']);
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });
});

// ─── routes: GET /api/wireframe/:siteId ────────────────────────────────────

describe('GET /api/wireframe/:siteId', () => {
  it('404s when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await appWith('user_1').request('/api/wireframe/site_1', {}, env);
    expect(res.status).toBe(404);
  });

  it('401s without auth', async () => {
    const res = await appWith().request('/api/wireframe/site_1', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns null plan when no wireframe exists', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const res = await appWith('user_1').request('/api/wireframe/site_no_plan', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; plan: null };
    expect(json.ok).toBe(true);
    expect(json.plan).toBeNull();
  });

  it('returns the plan after a POST', async () => {
    mockDbQueryOne.mockResolvedValue({
      id: 'plan_42',
      site_id: 'site_1',
      prompt: 'A great plumbing website please',
      sections: JSON.stringify(['Hero', 'About', 'Services', 'Contact']),
      created_at: '2026-06-17T00:00:00.000Z',
    });
    const res = await appWith('user_1').request('/api/wireframe/site_1', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; plan: { id: string; sections: string[] } };
    expect(json.ok).toBe(true);
    expect(json.plan?.id).toBe('plan_42');
    expect(json.plan?.sections).toEqual(['Hero', 'About', 'Services', 'Contact']);
  });
});
