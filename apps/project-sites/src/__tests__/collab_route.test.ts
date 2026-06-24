/**
 * @module __tests__/collab_route
 * @description Guard-chain tests for the collab_editing WebSocket gateway
 * (`GET /api/sites/:id/collab`):
 *   (a) no orgId → 401
 *   (b) flag off → 404 (never 403)
 *   (c) COLLAB_ROOM binding absent → 503 (inert deploy)
 *   (d) flag on + binding present + non-WS request → 426
 *   (e) flag on + binding present + WS upgrade → forwarded to CollabRoomDO stub
 *
 * All dependencies mocked — never touches a real DO / D1 / flag store.
 */

// ─── Mocks (hoisted; use the GLOBAL jest per @swc/jest, never @jest/globals) ──

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(false),
}));

jest.mock('../services/site_ownership.js', () => ({
  requireOwnedSite: jest.fn().mockResolvedValue({ id: 'site-1' }),
}));

import { Hono } from 'hono';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { collabRoutes } from '../routes/collab.js';

const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;

/** Build a Hono app that seeds `orgId` then mounts the collab routes. */
function buildApp(orgId: string | undefined) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (orgId) c.set('orgId', orgId);
    await next();
  });
  app.route('/', collabRoutes as unknown as Hono);
  return app;
}

/** A fake COLLAB_ROOM DurableObjectNamespace whose stub echoes a marker. */
function fakeColabRoom() {
  const fetch = jest.fn().mockResolvedValue(new Response('forwarded', { status: 200 }));
  return {
    binding: {
      idFromName: jest.fn(() => ({ name: 'site:site-1' })),
      get: jest.fn(() => ({ fetch })),
    },
    fetch,
  };
}

const URL_PATH = 'http://local/api/sites/site-1/collab';

describe('GET /api/sites/:id/collab guard chain', () => {
  beforeEach(() => {
    mockIsFlagOn.mockReset().mockResolvedValue(false);
  });

  it('returns 401 when there is no authenticated org', async () => {
    const res = await buildApp(undefined).fetch(new Request(URL_PATH), {});
    expect(res.status).toBe(401);
  });

  it('returns 404 when the collab_editing flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await buildApp('org-1').fetch(new Request(URL_PATH), {});
    expect(res.status).toBe(404);
  });

  it('returns 503 when the COLLAB_ROOM binding is absent (inert deploy)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await buildApp('org-1').fetch(new Request(URL_PATH), {});
    expect(res.status).toBe(503);
  });

  it('returns 426 when the request is not a WebSocket upgrade', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const { binding } = fakeColabRoom();
    const res = await buildApp('org-1').fetch(new Request(URL_PATH), { COLLAB_ROOM: binding });
    expect(res.status).toBe(426);
  });

  it('forwards a WebSocket upgrade request to the CollabRoomDO stub', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const { binding, fetch } = fakeColabRoom();
    const res = await buildApp('org-1').fetch(
      new Request(URL_PATH, { headers: { upgrade: 'websocket' } }),
      { COLLAB_ROOM: binding },
    );
    expect(binding.idFromName).toHaveBeenCalledWith('site:site-1');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe('forwarded');
  });
});
