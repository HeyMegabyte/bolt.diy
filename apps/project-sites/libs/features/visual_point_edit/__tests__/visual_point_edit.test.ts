// --- module mocks (must come before imports) ---

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

import { Hono } from 'hono';
import { visualPointEdit } from '../handlers.js';

// --- test app wiring ---

function buildApp(userId?: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    await next();
  });
  app.route('/', visualPointEdit);
  return app;
}

const stubEnv = {} as never;

// --- tests ---

describe('visual_point_edit handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsFlagOn.mockResolvedValue(true);
  });

  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);

    const app = buildApp('user-123');
    const res = await app.request(
      '/api/editor/point-edit',
      {
        method: 'POST',
        body: JSON.stringify({ nodeId: '#hero', instruction: 'Make bold', siteId: 'site-001' }),
        headers: { 'Content-Type': 'application/json' },
      },
      stubEnv,
    );

    expect(res.status).toBe(404);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 401 when userId is missing', async () => {
    const app = buildApp(undefined);
    const res = await app.request(
      '/api/editor/point-edit',
      {
        method: 'POST',
        body: JSON.stringify({ nodeId: '#hero', instruction: 'Make bold', siteId: 'site-001' }),
        headers: { 'Content-Type': 'application/json' },
      },
      stubEnv,
    );

    expect(res.status).toBe(401);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 for a missing body field', async () => {
    mockIsFlagOn.mockResolvedValue(true);

    const app = buildApp('user-123');
    const res = await app.request(
      '/api/editor/point-edit',
      {
        method: 'POST',
        body: JSON.stringify({ nodeId: '#hero' }), // missing instruction + siteId
        headers: { 'Content-Type': 'application/json' },
      },
      stubEnv,
    );

    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with patched:true on a valid request', async () => {
    mockIsFlagOn.mockResolvedValue(true);

    const app = buildApp('user-123');
    const res = await app.request(
      '/api/editor/point-edit',
      {
        method: 'POST',
        body: JSON.stringify({ nodeId: '#hero', instruction: 'Make bold', siteId: 'site-001' }),
        headers: { 'Content-Type': 'application/json' },
      },
      stubEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; patched: boolean; node: string };
    expect(json.ok).toBe(true);
    expect(json.patched).toBe(true);
    expect(json.node).toBe('#hero');
  });
});
