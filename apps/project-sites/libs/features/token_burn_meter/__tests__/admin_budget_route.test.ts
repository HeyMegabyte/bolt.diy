/**
 * Route-layer tests for the token_burn_meter ADMIN meter
 * (`GET /api/admin/usage/budget`) — previously UNTESTED. Verifies the flag gate,
 * the auth gate against the canonical super-admin allowlist (incl.
 * `hey@megabyte.space`, not a brian-only hardcode), and that non-admins get 404
 * (never 403 — no feature-existence leak).
 *
 * Only `getAllOrgMeters` is mocked (the admin route's data source); the auth gate
 * runs for real against a captured D1 stub that answers `isSuperAdmin`'s query.
 */

jest.mock('../service.js', () => ({
  ...jest.requireActual('../service.js'),
  getAllOrgMeters: jest.fn(async () => []),
}));

import { tokenBurnMeter } from '../handlers.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

/** D1 double answering isSuperAdmin's `SELECT is_super_admin, email FROM users`. */
function db(email: string | null) {
  const stmt = {
    bind: () => stmt,
    first: async () => null,
    run: async () => ({}),
    all: async () => ({ results: email ? [{ is_super_admin: 0, email }] : [] }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

const URL = '/api/admin/usage/budget';

describe('token_burn_meter admin meter (route layer)', () => {
  it('401 when unauthenticated', async () => {
    const app = authApp(tokenBurnMeter);
    expect((await app.request(URL, {}, harnessEnv(db(null), true))).status).toBe(401);
  });

  it('404 when the flag is off', async () => {
    const app = authApp(tokenBurnMeter, { userId: 'u', orgId: 'o' });
    expect(
      (await app.request(URL, {}, harnessEnv(db('brian@megabyte.space'), false))).status,
    ).toBe(404);
  });

  it('404 for an authenticated non-admin (never 403)', async () => {
    const app = authApp(tokenBurnMeter, { userId: 'u', orgId: 'o' });
    expect((await app.request(URL, {}, harnessEnv(db('nobody@example.com'), true))).status).toBe(404);
  });

  it('200 for brian@megabyte.space (canonical super-admin)', async () => {
    const app = authApp(tokenBurnMeter, { userId: 'admin', orgId: 'o' });
    const res = await app.request(URL, {}, harnessEnv(db('brian@megabyte.space'), true));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(0);
  });

  it('200 for hey@megabyte.space — canonical allowlist, not a brian-only hardcode', async () => {
    const app = authApp(tokenBurnMeter, { userId: 'admin', orgId: 'o' });
    const res = await app.request(URL, {}, harnessEnv(db('hey@megabyte.space'), true));
    expect(res.status).toBe(200);
  });
});
