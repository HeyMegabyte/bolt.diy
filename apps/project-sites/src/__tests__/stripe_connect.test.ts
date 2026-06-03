jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQueryOne, dbUpdate } from '../services/db.js';
import {
  PLATFORM_FEE_BPS,
  startConnectOnboarding,
  getConnectStatus,
  disconnectConnect,
  handleAccountUpdated,
} from '../services/stripe_connect.js';

const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockUpdate = dbUpdate as unknown as jest.Mock;

const baseEnv = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_CONNECT_CLIENT_ID: 'ca_test_123',
} as any;

const noKeyEnv = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_CONNECT_CLIENT_ID: undefined,
} as any;

const mockDb = {} as D1Database;

const originalFetch = global.fetch;
let warnSpy: jest.SpyInstance;

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
}
function httpErr(status: number, text: string): Response {
  return { ok: false, status, json: async () => ({}), text: async () => text } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  global.fetch = originalFetch;
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------
describe('PLATFORM_FEE_BPS', () => {
  it('is 150 basis points (1.5%)', () => {
    expect(PLATFORM_FEE_BPS).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// startConnectOnboarding
// ---------------------------------------------------------------------------
describe('startConnectOnboarding', () => {
  const opts = {
    orgId: 'org-1',
    email: 'owner@acme.com',
    refreshUrl: 'https://x/refresh',
    returnUrl: 'https://x/done',
  };

  it('throws a 503-shaped error when Connect is not configured', async () => {
    await expect(startConnectOnboarding(noKeyEnv, mockDb, opts)).rejects.toMatchObject({
      message: expect.stringContaining('Stripe Connect not configured'),
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws when the org is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(startConnectOnboarding(baseEnv, mockDb, opts)).rejects.toMatchObject({
      message: 'Organization not found',
    });
  });

  it('creates a new account + persists it, then builds an account link', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: null });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonOk({ id: 'acct_new' }))
      .mockResolvedValueOnce(jsonOk({ url: 'https://connect.stripe.com/setup/x' }));

    const result = await startConnectOnboarding(baseEnv, mockDb, opts);

    expect(result).toEqual({ url: 'https://connect.stripe.com/setup/x', account_id: 'acct_new' });
    // account create + account link = two Stripe calls
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const acctCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(acctCall[0]).toBe('https://api.stripe.com/v1/accounts');
    expect(acctCall[1].method).toBe('POST');
    expect(acctCall[1].headers.Authorization).toBe('Bearer sk_test_123');
    const acctBody = (acctCall[1].body as URLSearchParams).toString();
    expect(acctBody).toContain('type=standard');
    expect(acctBody).toContain('email=owner%40acme.com');
    expect(acctBody).toContain('metadata%5Borg_id%5D=org-1');
    // new account id persisted to the org row
    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'orgs',
      { stripe_connect_account_id: 'acct_new' },
      'id = ?',
      ['org-1'],
    );
    const linkCall = (global.fetch as jest.Mock).mock.calls[1];
    expect(linkCall[0]).toBe('https://api.stripe.com/v1/account_links');
    const linkBody = (linkCall[1].body as URLSearchParams).toString();
    expect(linkBody).toContain('account=acct_new');
    expect(linkBody).toContain('type=account_onboarding');
  });

  it('reuses an existing account id without creating a new account', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: 'acct_existing' });
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonOk({ url: 'https://link/x' }));

    const result = await startConnectOnboarding(baseEnv, mockDb, opts);

    expect(result.account_id).toBe('acct_existing');
    // only the account-link call fires; no account-create
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://api.stripe.com/v1/account_links');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws when the account-create call returns non-200', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: null });
    (global.fetch as jest.Mock).mockResolvedValueOnce(httpErr(400, 'invalid email'));

    await expect(startConnectOnboarding(baseEnv, mockDb, opts)).rejects.toMatchObject({
      message: expect.stringContaining('Stripe Connect account create failed: invalid email'),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws when the account-link call returns non-200', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: 'acct_existing' });
    (global.fetch as jest.Mock).mockResolvedValueOnce(httpErr(500, 'stripe down'));

    await expect(startConnectOnboarding(baseEnv, mockDb, opts)).rejects.toMatchObject({
      message: expect.stringContaining('Stripe Connect account link failed: stripe down'),
    });
  });

  it('propagates a network throw from fetch (resilience)', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: 'acct_existing' });
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(startConnectOnboarding(baseEnv, mockDb, opts)).rejects.toThrow('ECONNRESET');
  });
});

// ---------------------------------------------------------------------------
// getConnectStatus
// ---------------------------------------------------------------------------
describe('getConnectStatus', () => {
  it('returns disconnected when no account id on the row', async () => {
    mockQueryOne.mockResolvedValueOnce({
      stripe_connect_account_id: null,
      stripe_connect_charges_enabled: 0,
      stripe_connect_payouts_enabled: 0,
    });

    const status = await getConnectStatus(baseEnv, mockDb, 'org-1');

    expect(status).toEqual({
      connected: false,
      charges_enabled: false,
      payouts_enabled: false,
      dashboard_url: null,
      account_id: null,
    });
    // no Stripe round-trip — cheap, DB-only
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns disconnected when the row is entirely missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const status = await getConnectStatus(baseEnv, mockDb, 'org-1');

    expect(status.connected).toBe(false);
    expect(status.account_id).toBeNull();
  });

  it('returns connected with charges flag true + dashboard url', async () => {
    mockQueryOne.mockResolvedValueOnce({
      stripe_connect_account_id: 'acct_x',
      stripe_connect_charges_enabled: 1,
      stripe_connect_payouts_enabled: 1,
    });

    const status = await getConnectStatus(baseEnv, mockDb, 'org-1');

    expect(status).toEqual({
      connected: true,
      charges_enabled: true,
      payouts_enabled: true,
      dashboard_url: 'https://dashboard.stripe.com/acct_x',
      account_id: 'acct_x',
    });
  });

  it('maps 0 flags to false even when an account exists', async () => {
    mockQueryOne.mockResolvedValueOnce({
      stripe_connect_account_id: 'acct_x',
      stripe_connect_charges_enabled: 0,
      stripe_connect_payouts_enabled: 0,
    });

    const status = await getConnectStatus(baseEnv, mockDb, 'org-1');

    expect(status.connected).toBe(true);
    expect(status.charges_enabled).toBe(false);
    expect(status.payouts_enabled).toBe(false);
  });

  it('omits the dashboard url when Connect is not configured', async () => {
    mockQueryOne.mockResolvedValueOnce({
      stripe_connect_account_id: 'acct_x',
      stripe_connect_charges_enabled: 1,
      stripe_connect_payouts_enabled: 1,
    });

    const status = await getConnectStatus(noKeyEnv, mockDb, 'org-1');

    expect(status.connected).toBe(true);
    expect(status.dashboard_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// disconnectConnect
// ---------------------------------------------------------------------------
describe('disconnectConnect', () => {
  it('throws a 503-shaped error when Connect is not configured', async () => {
    await expect(disconnectConnect(noKeyEnv, mockDb, 'org-1')).rejects.toMatchObject({
      message: expect.stringContaining('Stripe Connect not configured'),
    });
  });

  it('returns { disconnected: false } when the org has no account id', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: null });

    const result = await disconnectConnect(baseEnv, mockDb, 'org-1');

    expect(result).toEqual({ disconnected: false });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('deauthorizes via Stripe then clears the cached row', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: 'acct_x' });
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonOk({ stripe_user_id: 'acct_x' }));

    const result = await disconnectConnect(baseEnv, mockDb, 'org-1');

    expect(result).toEqual({ disconnected: true });
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('https://connect.stripe.com/oauth/deauthorize');
    const body = (call[1].body as URLSearchParams).toString();
    expect(body).toContain('client_id=ca_test_123');
    expect(body).toContain('stripe_user_id=acct_x');
    // cache cleared
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0];
    expect(updateArgs[1]).toBe('orgs');
    expect(updateArgs[2]).toMatchObject({
      stripe_connect_account_id: null,
      stripe_connect_charges_enabled: 0,
      stripe_connect_payouts_enabled: 0,
    });
    expect(typeof updateArgs[2].stripe_connect_updated_at).toBe('string');
    expect(updateArgs[3]).toBe('id = ?');
    expect(updateArgs[4]).toEqual(['org-1']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('clears the cache anyway + warns when deauthorize returns non-ok (already revoked)', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: 'acct_x' });
    (global.fetch as jest.Mock).mockResolvedValueOnce(httpErr(401, 'already revoked'));

    const result = await disconnectConnect(baseEnv, mockDb, 'org-1');

    expect(result).toEqual({ disconnected: true });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(logged).toMatchObject({ level: 'warn', service: 'stripe_connect', status: 401 });
  });
});

// ---------------------------------------------------------------------------
// handleAccountUpdated
// ---------------------------------------------------------------------------
describe('handleAccountUpdated', () => {
  it('updates the org found via metadata.org_id without a DB lookup', async () => {
    await handleAccountUpdated(mockDb, {
      id: 'acct_x',
      charges_enabled: true,
      payouts_enabled: true,
      metadata: { org_id: 'org-1' },
    });

    // metadata path → no SELECT, just the UPDATE
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const args = mockUpdate.mock.calls[0];
    expect(args[2]).toMatchObject({
      stripe_connect_charges_enabled: 1,
      stripe_connect_payouts_enabled: 1,
    });
    expect(args[4]).toEqual(['org-1']);
  });

  it('falls back to a scan by account id when metadata is absent', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-2' });

    await handleAccountUpdated(mockDb, {
      id: 'acct_y',
      charges_enabled: false,
      payouts_enabled: false,
    });

    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne.mock.calls[0][2]).toEqual(['acct_y']);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const args = mockUpdate.mock.calls[0];
    expect(args[2]).toMatchObject({
      stripe_connect_charges_enabled: 0,
      stripe_connect_payouts_enabled: 0,
    });
    expect(args[4]).toEqual(['org-2']);
  });

  it('warns + no-ops when no org can be resolved', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    await handleAccountUpdated(mockDb, { id: 'acct_unknown', charges_enabled: true });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(logged).toMatchObject({ service: 'stripe_connect', account_id: 'acct_unknown' });
  });

  it('coerces undefined enable flags to 0 (idempotent persistence)', async () => {
    await handleAccountUpdated(mockDb, { id: 'acct_z', metadata: { org_id: 'org-3' } });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][2]).toMatchObject({
      stripe_connect_charges_enabled: 0,
      stripe_connect_payouts_enabled: 0,
    });
  });
});
