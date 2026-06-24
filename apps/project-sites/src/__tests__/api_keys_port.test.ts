/**
 * api_keys_port — §30 Unkey-shaped API-key port over the D1 api_tokens keystore.
 *
 * Locks the port (FakeApiKeyProvider create/verify/revoke round-trip) and the D1
 * adapter (delegation to api_tokens create/verify/revoke, Unkey-shaped result
 * mapping, scope filtering, fail-soft on a thrown verify error). The api_tokens
 * service is mocked so no D1 I/O happens. Global `jest`; `as unknown as jest.Mock`.
 */
jest.mock('../services/api_tokens.js', () => ({
  createApiToken: jest.fn(),
  verifyApiToken: jest.fn(),
  revokeApiToken: jest.fn(),
  VALID_SCOPES: ['sites:read', 'sites:write', 'media:read', 'me:read'],
}));

import { FakeApiKeyProvider } from '../platform/api-keys.js';
import { D1ApiKeyProvider, getApiKeyProvider } from '../middleware/api-keys.js';
import { createApiToken, verifyApiToken, revokeApiToken } from '../services/api_tokens.js';

const mCreate = createApiToken as unknown as jest.Mock;
const mVerify = verifyApiToken as unknown as jest.Mock;
const mRevoke = revokeApiToken as unknown as jest.Mock;
const env = { DB: {} } as never;

beforeEach(() => jest.clearAllMocks());

describe('FakeApiKeyProvider', () => {
  it('round-trips create → verify → revoke', async () => {
    const p = new FakeApiKeyProvider();
    const { keyId, key } = await p.createKey({ ownerId: 'o1', name: 't', scopes: ['sites:read'] });
    expect(await p.verifyKey(key)).toEqual({
      valid: true,
      code: 'VALID',
      keyId,
      ownerId: 'o1',
      scopes: ['sites:read'],
    });
    expect(await p.revokeKey(keyId, 'o1')).toBe(true);
    expect(await p.verifyKey(key)).toEqual({ valid: false, code: 'NOT_FOUND' });
  });

  it('returns NOT_FOUND for an unknown key', async () => {
    const p = new FakeApiKeyProvider();
    expect(await p.verifyKey('nope')).toEqual({ valid: false, code: 'NOT_FOUND' });
  });
});

describe('D1ApiKeyProvider', () => {
  it('createKey delegates to createApiToken and returns {keyId, key}', async () => {
    mCreate.mockResolvedValue({ token: { id: 'tok_1' }, plaintext: 'psk_abc' });
    const p = new D1ApiKeyProvider(env);
    const res = await p.createKey({
      ownerId: 'o1',
      name: 'ci',
      scopes: ['sites:read', 'bogus:scope'],
      expiresAt: null,
    });
    expect(res).toEqual({ keyId: 'tok_1', key: 'psk_abc' });
    // unknown scope filtered out before hitting the keystore
    expect(mCreate).toHaveBeenCalledWith(env.DB, 'o1', 'ci', ['sites:read'], null, null);
  });

  it('verifyKey maps a valid row to the Unkey VALID shape', async () => {
    mVerify.mockResolvedValue({ id: 'tok_1', org_id: 'o1', scopes: '["sites:read","me:read"]' });
    const p = new D1ApiKeyProvider(env);
    expect(await p.verifyKey('psk_abc')).toEqual({
      valid: true,
      code: 'VALID',
      keyId: 'tok_1',
      ownerId: 'o1',
      scopes: ['sites:read', 'me:read'],
    });
  });

  it('verifyKey returns NOT_FOUND when the keystore returns null', async () => {
    mVerify.mockResolvedValue(null);
    const p = new D1ApiKeyProvider(env);
    expect(await p.verifyKey('psk_x')).toEqual({ valid: false, code: 'NOT_FOUND' });
  });

  it('verifyKey fails soft to NOT_FOUND when the keystore throws', async () => {
    mVerify.mockRejectedValue(new Error('D1 down'));
    const p = new D1ApiKeyProvider(env);
    expect(await p.verifyKey('psk_x')).toEqual({ valid: false, code: 'NOT_FOUND' });
  });

  it('revokeKey delegates to revokeApiToken(db, ownerId, keyId)', async () => {
    mRevoke.mockResolvedValue(true);
    const p = new D1ApiKeyProvider(env);
    expect(await p.revokeKey('tok_1', 'o1')).toBe(true);
    expect(mRevoke).toHaveBeenCalledWith(env.DB, 'o1', 'tok_1');
  });
});

describe('getApiKeyProvider', () => {
  it('returns the D1-backed provider (always available, no env gate)', () => {
    const p = getApiKeyProvider(env);
    expect(p.name).toBe('projectsites-d1-api-tokens');
    expect(p).toBeInstanceOf(D1ApiKeyProvider);
  });
});
