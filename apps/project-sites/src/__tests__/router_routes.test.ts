/**
 * Route-layer coverage for the `ai_auto_router` flag's two endpoints in
 * `src/routes/features.ts`:
 *   - POST /api/router/pick   → B.autoRoutePrompt
 *   - GET  /api/router/stats  → B.getRouterStats
 *
 * The SERVICE layer (autoRoutePrompt / getRouterStats) is already covered by
 * brilliant.test.ts. The ROUTE layer — the `requireFlag('ai_auto_router')` gate
 * (404 when off, no leak) + request wiring (body parse + defaults + query) — had
 * ZERO tests. Mocks only the two boundaries: the flag resolver and the brilliant
 * service; everything else (the real Hono sub-app) runs.
 */

// Override isFlagOn while keeping the rest of the module (features.ts also imports
// resolveFlag + FLAG_REGISTRY from here at module load).
jest.mock('../modules/feature_flags/services.js', () => ({
  ...jest.requireActual('../modules/feature_flags/services.js'),
  isFlagOn: jest.fn(),
}));

// Override just the two router service fns; keep every other B.* export intact
// (features.ts does `import * as B` and wires dozens of other handlers).
jest.mock('../services/brilliant.js', () => ({
  ...jest.requireActual('../services/brilliant.js'),
  autoRoutePrompt: jest.fn(),
  getRouterStats: jest.fn(),
}));

import features from '../routes/features.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { autoRoutePrompt, getRouterStats } from '../services/brilliant.js';

const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;
const mockAutoRoute = autoRoutePrompt as jest.MockedFunction<typeof autoRoutePrompt>;
const mockStats = getRouterStats as jest.MockedFunction<typeof getRouterStats>;

const env = {} as never;
const post = (path: string, body?: unknown) =>
  features.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) },
    env,
  );
const get = (path: string) => features.request(path, {}, env);

beforeEach(() => {
  jest.clearAllMocks();
  mockIsFlagOn.mockResolvedValue(true);
  mockAutoRoute.mockResolvedValue({ model: 'claude-sonnet-4-6', shape: 'implement' } as never);
  mockStats.mockResolvedValue({ total: 0, savings_usd: 0 } as never);
});

describe('POST /api/router/pick (ai_auto_router)', () => {
  it('404s (not_found, no leak) when the flag is off + never calls the service', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await post('/api/router/pick', { prompt: 'x' });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe('not_found');
    expect(mockAutoRoute).not.toHaveBeenCalled();
  });

  it('200s + routes the body prompt/org through to autoRoutePrompt', async () => {
    const res = await post('/api/router/pick', { prompt: 'refactor safety', org_id: 'org-9' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ model: 'claude-sonnet-4-6', shape: 'implement' });
    expect(mockAutoRoute).toHaveBeenCalledWith(env, { prompt: 'refactor safety', orgId: 'org-9' });
  });

  it('falls back to the demo prompt when the body is empty', async () => {
    const res = await post('/api/router/pick', {});
    expect(res.status).toBe(200);
    expect(mockAutoRoute).toHaveBeenCalledWith(env, { prompt: 'demo prompt', orgId: undefined });
  });
});

describe('GET /api/router/stats (ai_auto_router)', () => {
  it('404s when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await get('/api/router/stats');
    expect(res.status).toBe(404);
    expect(mockStats).not.toHaveBeenCalled();
  });

  it('200s + defaults org to demo-org when no org_id query', async () => {
    const res = await get('/api/router/stats');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 0, savings_usd: 0 });
    expect(mockStats).toHaveBeenCalledWith(env, 'demo-org');
  });

  it('passes the org_id query through to getRouterStats', async () => {
    await get('/api/router/stats?org_id=org-42');
    expect(mockStats).toHaveBeenCalledWith(env, 'org-42');
  });
});
