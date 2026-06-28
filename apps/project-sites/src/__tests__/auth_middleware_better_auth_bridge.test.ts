/**
 * auth middleware — Better Auth session bridge (cutover). Locks the contract that
 * when the `better_auth` flag is on and no bearer token matched, the BA COOKIE
 * session resolves userId + orgId (via the shared memberships lookup), and that
 * resolution is best-effort (never blocks the request).
 */
let flagOn = true;
let baSession: { user?: { id?: string } } | null = { user: { id: 'u_ba' } };
let baThrows = false;
let membership: { org_id: string } | null = { org_id: 'org_1' };

jest.mock('../services/auth.js', () => ({ getSession: jest.fn(async () => null) }));
jest.mock('../lib/wait-until.js', () => ({ safeWaitUntil: jest.fn() }));
jest.mock('../services/db.js', () => ({ dbQueryOne: jest.fn(async () => membership) }));
jest.mock('../modules/feature_flags/services.js', () => ({ isFlagOn: jest.fn(async () => flagOn) }));
jest.mock('../auth/better-auth.js', () => ({
  makeAuth: () => ({
    api: {
      getSession: async () => {
        if (baThrows) throw new Error('boom');
        return baSession;
      },
    },
  }),
}));

import { authMiddleware } from '../middleware/auth.js';

function ctx(authHeader?: string) {
  const vars = new Map<string, unknown>();
  let nexted = 0;
  const c = {
    env: { DB: {} },
    req: {
      header: (k: string) => (k === 'Authorization' ? authHeader : undefined),
      raw: { headers: new Headers() },
    },
    get: (k: string) => vars.get(k),
    set: (k: string, v: unknown) => vars.set(k, v),
  } as never;
  const next = async () => {
    nexted += 1;
  };
  return { c, next, vars, nexted: () => nexted };
}

describe('Better Auth session bridge', () => {
  beforeEach(() => {
    flagOn = true;
    baSession = { user: { id: 'u_ba' } };
    baThrows = false;
    membership = { org_id: 'org_1' };
  });

  it('resolves userId + orgId from the BA cookie session when no bearer token', async () => {
    const { c, next, vars, nexted } = ctx(undefined);
    await authMiddleware(c, next);
    expect(vars.get('userId')).toBe('u_ba');
    expect(vars.get('orgId')).toBe('org_1');
    expect(nexted()).toBe(1);
  });

  it('does NOT run the bridge when the flag is off', async () => {
    flagOn = false;
    const { c, next, vars } = ctx(undefined);
    await authMiddleware(c, next);
    expect(vars.get('userId')).toBeUndefined();
  });

  it('sets userId even when the user has no membership (orgId stays unset)', async () => {
    membership = null;
    const { c, next, vars } = ctx(undefined);
    await authMiddleware(c, next);
    expect(vars.get('userId')).toBe('u_ba');
    expect(vars.get('orgId')).toBeUndefined();
  });

  it('is best-effort: a BA getSession throw never blocks the request', async () => {
    baThrows = true;
    const { c, next, vars, nexted } = ctx(undefined);
    await expect(authMiddleware(c, next)).resolves.toBeUndefined();
    expect(vars.get('userId')).toBeUndefined();
    expect(nexted()).toBe(1);
  });

  it('no BA session → userId stays unset, request continues', async () => {
    baSession = null;
    const { c, next, vars, nexted } = ctx(undefined);
    await authMiddleware(c, next);
    expect(vars.get('userId')).toBeUndefined();
    expect(nexted()).toBe(1);
  });
});
