/**
 * Flag-GATING coverage for the shared guard helpers in `src/lib/feature_guard.ts`.
 * The sibling `feature_guard.test.ts` covers the error envelopes + the
 * unauthenticated short-circuit (which returns BEFORE any flag lookup), but the
 * actual flag-gating semantics — used by contacts_core / email_marketing /
 * site_analytics / data_export and every public flag-gated route — were
 * untested:
 *   requireOrgFlag: flag-off → 404 (no leak) + flag-on → returns {orgId,userId}
 *   requireFlag   : flag-off → 404 + flag-on → true
 *
 * `isFlagOn` is mocked so the branches are exercised deterministically.
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  ...jest.requireActual('../modules/feature_flags/services.js'),
  isFlagOn: jest.fn(),
}));

import { requireOrgFlag, requireFlag, type AppCtx } from '../lib/feature_guard.js';
import { isFlagOn } from '../modules/feature_flags/services.js';

const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;

/** Minimal Hono context double: get() reads a bag, json() echoes (body,status). */
function ctx(vars: Record<string, unknown>): AppCtx {
  return {
    get: (k: string) => vars[k],
    env: {},
    json: (body: unknown, status?: number) => ({ body, status: status ?? 200 }),
  } as unknown as AppCtx;
}

const authed = { userId: 'u1', orgId: 'o1', requestId: 'r1' };

beforeEach(() => {
  jest.clearAllMocks();
  // flag-off paths emit a structured logFlagOff() warn — silence it in test output.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('requireOrgFlag — flag gating', () => {
  it('returns 404 (NOT_FOUND, no leak) when the flag is OFF for an authed caller', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const r = (await requireOrgFlag(ctx(authed), 'site_analytics')) as unknown as {
      status: number;
      body: { error: { code: string } };
    };
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect(mockIsFlagOn).toHaveBeenCalledWith({}, 'site_analytics', { orgId: 'o1', userId: 'u1' });
  });

  it('returns the {orgId,userId} scope (not a Response) when the flag is ON', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const r = await requireOrgFlag(ctx(authed), 'site_analytics');
    expect(r).toEqual({ orgId: 'o1', userId: 'u1' });
  });
});

describe('requireFlag — public gate', () => {
  it('returns a 404 Response when the flag is OFF', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const r = (await requireFlag(ctx({ requestId: 'r1' }), 'donations_engine')) as unknown as {
      status: number;
      body: { error: { code: string } };
    };
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('returns true when the flag is ON', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    expect(await requireFlag(ctx({}), 'donations_engine')).toBe(true);
  });

  it('resolves the flag against whatever scope the context carries', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    await requireFlag(ctx({ orgId: 'oX', userId: 'uX' }), 'public_api');
    expect(mockIsFlagOn).toHaveBeenCalledWith({}, 'public_api', { orgId: 'oX', userId: 'uX' });
  });
});
