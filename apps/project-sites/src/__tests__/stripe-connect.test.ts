/**
 * Tests for src/services/stripe_connect.ts (item #97).
 */

jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQueryOne, dbUpdate } from '../services/db.js';
import {
  startConnectOnboarding,
  getConnectStatus,
  disconnectConnect,
  handleAccountUpdated,
} from '../services/stripe_connect.js';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

const mockDb = {} as D1Database;
const originalFetch = global.fetch;

const env = {
  STRIPE_SECRET_KEY: 'sk_test_xxx',
  STRIPE_CONNECT_CLIENT_ID: 'ca_test_xxx',
} as unknown as import('../types/env.js').Env;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('startConnectOnboarding', () => {
  it('creates an account, persists the id, and returns a fresh link', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: null });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'acct_new' }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ url: 'https://connect.stripe.com/link/abc' }),
        text: async () => '',
      });

    const result = await startConnectOnboarding(env, mockDb, {
      orgId: 'org-1',
      email: 'owner@acme.com',
      refreshUrl: 'https://example.com/refresh',
      returnUrl: 'https://example.com/return',
    });

    expect(result.account_id).toBe('acct_new');
    expect(result.url).toBe('https://connect.stripe.com/link/abc');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'orgs',
      { stripe_connect_account_id: 'acct_new' },
      'id = ?',
      ['org-1'],
    );
  });

  it('reuses an existing account id', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: 'acct_existing' });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://connect.stripe.com/link/xyz' }),
      text: async () => '',
    });

    const result = await startConnectOnboarding(env, mockDb, {
      orgId: 'org-1',
      email: 'owner@acme.com',
      refreshUrl: 'https://example.com/refresh',
      returnUrl: 'https://example.com/return',
    });

    expect(result.account_id).toBe('acct_existing');
    // No additional account create — only the account_links POST.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws when STRIPE_CONNECT_CLIENT_ID is missing', async () => {
    const noConnectEnv = { ...env, STRIPE_CONNECT_CLIENT_ID: undefined } as unknown as import('../types/env.js').Env;
    await expect(
      startConnectOnboarding(noConnectEnv, mockDb, {
        orgId: 'org-1',
        email: 'a@b.com',
        refreshUrl: 'x',
        returnUrl: 'y',
      }),
    ).rejects.toThrow(/STRIPE_CONNECT_CLIENT_ID/);
  });
});

describe('getConnectStatus', () => {
  it('returns disconnected shape when no account id', async () => {
    mockQueryOne.mockResolvedValueOnce({
      stripe_connect_account_id: null,
      stripe_connect_charges_enabled: 0,
      stripe_connect_payouts_enabled: 0,
    });
    const status = await getConnectStatus(env, mockDb, 'org-1');
    expect(status.connected).toBe(false);
    expect(status.charges_enabled).toBe(false);
  });

  it('returns connected shape with flags decoded', async () => {
    mockQueryOne.mockResolvedValueOnce({
      stripe_connect_account_id: 'acct_xx',
      stripe_connect_charges_enabled: 1,
      stripe_connect_payouts_enabled: 0,
    });
    const status = await getConnectStatus(env, mockDb, 'org-1');
    expect(status.connected).toBe(true);
    expect(status.charges_enabled).toBe(true);
    expect(status.payouts_enabled).toBe(false);
    expect(status.dashboard_url).toContain('acct_xx');
  });
});

describe('disconnectConnect', () => {
  it('calls deauthorize and clears the row', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: 'acct_to_drop' });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    });
    const result = await disconnectConnect(env, mockDb, 'org-1');
    expect(result.disconnected).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://connect.stripe.com/oauth/deauthorize',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'orgs',
      expect.objectContaining({
        stripe_connect_account_id: null,
        stripe_connect_charges_enabled: 0,
      }),
      'id = ?',
      ['org-1'],
    );
  });

  it('is a no-op when nothing connected', async () => {
    mockQueryOne.mockResolvedValueOnce({ stripe_connect_account_id: null });
    const result = await disconnectConnect(env, mockDb, 'org-1');
    expect(result.disconnected).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('handleAccountUpdated', () => {
  it('updates flags via metadata.org_id', async () => {
    await handleAccountUpdated(mockDb, {
      id: 'acct_yyy',
      charges_enabled: true,
      payouts_enabled: true,
      metadata: { org_id: 'org-1' },
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'orgs',
      expect.objectContaining({
        stripe_connect_charges_enabled: 1,
        stripe_connect_payouts_enabled: 1,
      }),
      'id = ?',
      ['org-1'],
    );
  });

  it('falls back to scanning by account id when metadata is missing', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-9' });
    await handleAccountUpdated(mockDb, {
      id: 'acct_yyy',
      charges_enabled: false,
      payouts_enabled: false,
    });
    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'orgs',
      expect.objectContaining({
        stripe_connect_charges_enabled: 0,
      }),
      'id = ?',
      ['org-9'],
    );
  });
});
