/**
 * Unit coverage for services/social_account_ctx — loads + decrypts
 * social_accounts rows into SocialAccountCtx and persists refreshed tokens.
 * db + ai_crypto mocked; no real APIs.
 */
jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbUpdate: jest.fn(),
}));
jest.mock('../services/ai_crypto.js', () => ({
  decrypt: jest.fn(),
  encrypt: jest.fn(),
}));

import { dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import { decrypt, encrypt } from '../services/ai_crypto.js';
import { loadAccount, loadAccountsByIds, markAccountError } from '../services/social_account_ctx.js';
import type { Env } from '../types/env.js';

const mQuery = dbQuery as unknown as jest.Mock;
const mQueryOne = dbQueryOne as unknown as jest.Mock;
const mUpdate = dbUpdate as unknown as jest.Mock;
const mDecrypt = decrypt as unknown as jest.Mock;
const mEncrypt = encrypt as unknown as jest.Mock;

const env = { DB: {} } as unknown as Env;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'acc-1', org_id: 'org-1', platform: 'x', external_id: 'ext', handle: '@h',
    access_token_encrypted: 'ct-access', refresh_token_encrypted: 'ct-refresh',
    token_expires_at: '2030-01-01', scopes: 'read,write', metadata_json: '{"k":1}', status: 'active',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mDecrypt.mockImplementation((_e, ct: string) => Promise.resolve(`plain(${ct})`));
  mEncrypt.mockImplementation((_e, pt: string) => Promise.resolve(`enc(${pt})`));
  mUpdate.mockResolvedValue({});
});

describe('loadAccount', () => {
  it('decrypts a found row into a SocialAccountCtx', async () => {
    mQueryOne.mockResolvedValue(row());
    const ctx = await loadAccount(env, 'acc-1');
    expect(ctx).not.toBeNull();
    expect(ctx!.access_token).toBe('plain(ct-access)');
    expect(ctx!.refresh_token).toBe('plain(ct-refresh)');
    expect(ctx!.metadata).toEqual({ k: 1 });
    expect(ctx!.platform).toBe('x');
  });

  it('returns null when the row is missing', async () => {
    mQueryOne.mockResolvedValue(null);
    expect(await loadAccount(env, 'nope')).toBeNull();
  });

  it('returns null when the row has no access token', async () => {
    mQueryOne.mockResolvedValue(row({ access_token_encrypted: null }));
    expect(await loadAccount(env, 'acc-1')).toBeNull();
  });

  it('null refresh token + null metadata coalesce cleanly', async () => {
    mQueryOne.mockResolvedValue(row({ refresh_token_encrypted: null, metadata_json: null }));
    const ctx = await loadAccount(env, 'acc-1');
    expect(ctx!.refresh_token).toBeNull();
    expect(ctx!.metadata).toEqual({});
    expect(mDecrypt).toHaveBeenCalledTimes(1); // only the access token
  });
});

describe('loadAccountsByIds', () => {
  it('short-circuits on an empty id list without querying', async () => {
    expect(await loadAccountsByIds(env, [])).toEqual([]);
    expect(mQuery).not.toHaveBeenCalled();
  });

  it('builds an IN placeholder set and returns built contexts', async () => {
    mQuery.mockResolvedValue({ data: [row({ id: 'a' }), row({ id: 'b' })] });
    const out = await loadAccountsByIds(env, ['a', 'b']);
    expect(out).toHaveLength(2);
    const sql = mQuery.mock.calls[0][1] as string;
    expect(sql).toContain('IN (?,?)');
  });

  it('skips rows that lack an access token', async () => {
    mQuery.mockResolvedValue({ data: [row({ id: 'a' }), row({ id: 'b', access_token_encrypted: null })] });
    const out = await loadAccountsByIds(env, ['a', 'b']);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
  });
});

describe('onTokenRefresh callback', () => {
  it('encrypts the new access token + expiry and updates the row', async () => {
    mQueryOne.mockResolvedValue(row());
    const ctx = await loadAccount(env, 'acc-1');
    await ctx!.onTokenRefresh({ access_token: 'newA', expires_at: '2031-01-01' });
    const [, table, updates, where, params] = mUpdate.mock.calls[0];
    expect(table).toBe('social_accounts');
    expect(updates).toMatchObject({ access_token_encrypted: 'enc(newA)', token_expires_at: '2031-01-01' });
    expect(updates.refresh_token_encrypted).toBeUndefined(); // no refresh supplied
    expect(where).toBe('id = ?');
    expect(params).toEqual(['acc-1']);
  });

  it('also encrypts a supplied refresh token', async () => {
    mQueryOne.mockResolvedValue(row());
    const ctx = await loadAccount(env, 'acc-1');
    await ctx!.onTokenRefresh({ access_token: 'newA', refresh_token: 'newR' });
    const updates = mUpdate.mock.calls[0][2];
    expect(updates.refresh_token_encrypted).toBe('enc(newR)');
    expect(updates.token_expires_at).toBeNull(); // expires_at omitted → null
  });
});

describe('markAccountError', () => {
  it('sets status=error with a 500-char-capped reason', async () => {
    await markAccountError(env, 'acc-1', 'x'.repeat(700));
    const [, table, updates, where, params] = mUpdate.mock.calls[0];
    expect(table).toBe('social_accounts');
    expect(updates.status).toBe('error');
    expect(updates.last_error).toHaveLength(500);
    expect(where).toBe('id = ?');
    expect(params).toEqual(['acc-1']);
  });
});
