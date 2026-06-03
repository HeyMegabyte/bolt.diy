/**
 * cf_credentials — per-org Cloudflare credential storage (encryption-at-rest).
 *
 * Security-critical: `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` are AES-GCM
 * encrypted in the `cf_credentials` D1 table before write, decrypted only on
 * read. This suite locks the encrypt-at-rest / decrypt round-trip, per-org
 * scoping, the decrypt-failure (tamper) path, and the auth-precedence resolver.
 *
 * Mocks ONLY `services/db.js` (D1) — the AES-GCM round-trip uses real Node 22
 * WebCrypto (`crypto.subtle`), exactly like the live Workers runtime.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbExecute: jest.fn(),
  dbInsert: jest.fn(),
  dbUpdate: jest.fn(),
}));

import { dbQueryOne, dbExecute } from '../services/db.js';
import {
  saveCfCredentials,
  loadCfCredentials,
  resolveCfCredentials,
  deleteCfCredentials,
  cfAuthHeaders,
} from '../services/cf_credentials.js';
import { encrypt } from '../services/ai_crypto.js';
import type { Env } from '../types/env.js';

const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockExecute = dbExecute as unknown as jest.Mock;

/** Build a minimally-typed Env stub with a real 32-byte AES key (base64). */
function makeEnv(extra: Record<string, unknown> = {}): Env {
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) keyBytes[i] = i + 1;
  let keyB64 = '';
  for (const byte of keyBytes) keyB64 += String.fromCharCode(byte);
  return {
    DB: {} as D1Database,
    MCP_ENCRYPTION_KEY: btoa(keyB64),
    ...extra,
  } as unknown as Env;
}

/** Shape of the D1 row `loadCfCredentials` SELECTs (after our encrypt). */
function storedRow(encrypted_blob: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred-1',
    org_id: 'org-A',
    encrypted_blob,
    iv: 'inline',
    last_validated_at: null,
    last_validated_account_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// saveCfCredentials — encrypt-at-rest (ciphertext != plaintext)
// ────────────────────────────────────────────────────────────
describe('saveCfCredentials (encrypt at rest)', () => {
  it('encrypts email+api_key before write — ciphertext never contains plaintext', async () => {
    const env = makeEnv();
    mockExecute.mockResolvedValueOnce({ error: null, changes: 1 });

    await saveCfCredentials(env, 'org-A', 'user@example.com', 'cf-secret-key-9999', 'acct-123');

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const params = mockExecute.mock.calls[0][2] as unknown[];
    // INSERT order: id, org_id, encrypted_blob, iv, last_validated_at, account_id, created, updated
    const orgId = params[1] as string;
    const blob = params[2] as string;
    expect(orgId).toBe('org-A');
    expect(blob).not.toContain('cf-secret-key-9999');
    expect(blob).not.toContain('user@example.com');
    // account id is persisted for caching
    expect(params[5]).toBe('acct-123');
  });

  it('writes via UPSERT (ON CONFLICT) so re-save overwrites the same org row', async () => {
    const env = makeEnv();
    mockExecute.mockResolvedValue({ error: null, changes: 1 });

    await saveCfCredentials(env, 'org-A', 'a@x.com', 'key-1', null);
    await saveCfCredentials(env, 'org-A', 'b@x.com', 'key-2', null);

    expect(mockExecute).toHaveBeenCalledTimes(2);
    const sql = mockExecute.mock.calls[0][1] as string;
    expect(sql).toMatch(/ON CONFLICT\(org_id\) DO UPDATE/i);
    // Two distinct ciphertexts (fresh IV per encrypt → distinct blobs)
    const blob1 = (mockExecute.mock.calls[0][2] as unknown[])[2] as string;
    const blob2 = (mockExecute.mock.calls[1][2] as unknown[])[2] as string;
    expect(blob1).not.toBe(blob2);
  });
});

// ────────────────────────────────────────────────────────────
// loadCfCredentials — decrypt round-trip + tamper rejection + scoping
// ────────────────────────────────────────────────────────────
describe('loadCfCredentials (decrypt round-trip)', () => {
  it('decrypts a stored blob back to the original email + api_key', async () => {
    const env = makeEnv();
    const blob = await encrypt(env, JSON.stringify({ api_key: 'cf-roundtrip-key', email: 'rt@example.com' }));
    mockQueryOne.mockResolvedValueOnce(storedRow(blob));

    const rec = await loadCfCredentials(env, 'org-A');
    expect(rec).not.toBeNull();
    expect(rec!.api_key).toBe('cf-roundtrip-key');
    expect(rec!.email).toBe('rt@example.com');
    expect(rec!.org_id).toBe('org-A');
  });

  it('scopes the SELECT to the requested org_id and excludes soft-deleted rows', async () => {
    const env = makeEnv();
    const blob = await encrypt(env, JSON.stringify({ api_key: 'k', email: 'e@x.com' }));
    mockQueryOne.mockResolvedValueOnce(storedRow(blob, { org_id: 'org-XYZ' }));

    await loadCfCredentials(env, 'org-XYZ');
    const [, sql, sqlParams] = mockQueryOne.mock.calls[0] as [unknown, string, unknown[]];
    expect(sql).toContain('WHERE org_id = ?');
    expect(sql).toContain('deleted_at IS NULL');
    expect(sqlParams[0]).toBe('org-XYZ');
  });

  it('returns null when no row exists for the org (missing credential)', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await loadCfCredentials(env, 'org-none')).toBeNull();
  });

  it('returns null (never throws) on a TAMPERED blob — GCM auth-tag failure', async () => {
    const env = makeEnv();
    const blob = await encrypt(env, JSON.stringify({ api_key: 'k', email: 'e@x.com' }));
    // Flip a byte in the middle of base64(iv‖ct) and re-encode.
    const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    const mid = Math.floor(bytes.length / 2);
    bytes[mid] = bytes[mid]! ^ 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    mockQueryOne.mockResolvedValueOnce(storedRow(tampered));

    // Decrypt failure must be swallowed → null (the credential is treated absent),
    // never a thrown error that leaks to the analytics caller.
    expect(await loadCfCredentials(env, 'org-A')).toBeNull();
  });

  it('returns null when stored blob was encrypted under a DIFFERENT key', async () => {
    const wrongKeyEnv = makeEnv({ MCP_ENCRYPTION_KEY: btoa('FEDCBA9876543210FEDCBA9876543210') });
    const blob = await encrypt(wrongKeyEnv, JSON.stringify({ api_key: 'k', email: 'e@x.com' }));
    const realEnv = makeEnv(); // key i+1 — cannot decrypt the wrong-key blob
    mockQueryOne.mockResolvedValueOnce(storedRow(blob));
    expect(await loadCfCredentials(realEnv, 'org-A')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// save → load full encrypt/decrypt cycle (end-to-end through D1 shape)
// ────────────────────────────────────────────────────────────
describe('save → load full cycle', () => {
  it('decrypt(stored ciphertext from save) === original credentials', async () => {
    const env = makeEnv();
    mockExecute.mockResolvedValueOnce({ error: null, changes: 1 });

    await saveCfCredentials(env, 'org-A', 'cycle@example.com', 'cf-cycle-secret', 'acct-99');

    // Reuse the ciphertext the save produced as the row a subsequent load reads.
    const writtenBlob = (mockExecute.mock.calls[0][2] as unknown[])[2] as string;
    mockQueryOne.mockResolvedValueOnce(storedRow(writtenBlob, { last_validated_account_id: 'acct-99' }));

    const rec = await loadCfCredentials(env, 'org-A');
    expect(rec!.email).toBe('cycle@example.com');
    expect(rec!.api_key).toBe('cf-cycle-secret');
    expect(rec!.last_validated_account_id).toBe('acct-99');
  });
});

// ────────────────────────────────────────────────────────────
// deleteCfCredentials — soft delete
// ────────────────────────────────────────────────────────────
describe('deleteCfCredentials', () => {
  it('soft-deletes by setting deleted_at, scoped to org_id', async () => {
    const env = makeEnv();
    mockExecute.mockResolvedValueOnce({ error: null, changes: 1 });

    await deleteCfCredentials(env, 'org-A');
    const [, sql, params] = mockExecute.mock.calls[0] as [unknown, string, unknown[]];
    expect(sql).toMatch(/UPDATE cf_credentials SET deleted_at/i);
    expect(sql).toContain('WHERE org_id = ?');
    // last param is the org id
    expect(params[params.length - 1]).toBe('org-A');
  });
});

// ────────────────────────────────────────────────────────────
// resolveCfCredentials — auth precedence (per-org > bundled global > token)
// ────────────────────────────────────────────────────────────
describe('resolveCfCredentials (auth precedence)', () => {
  it('prefers the per-org stored global key when present', async () => {
    const env = makeEnv({ CF_API_TOKEN: 'bundled-token' });
    const blob = await encrypt(env, JSON.stringify({ api_key: 'org-key', email: 'org@x.com' }));
    mockQueryOne.mockResolvedValueOnce(storedRow(blob));

    const auth = await resolveCfCredentials(env, 'org-A');
    expect(auth).toEqual({ apiKey: 'org-key', email: 'org@x.com', kind: 'global' });
  });

  it('falls back to bundled CLOUDFLARE_EMAIL+KEY when org has none', async () => {
    const env = makeEnv({ CLOUDFLARE_EMAIL: 'admin@mb.com', CLOUDFLARE_API_KEY: 'bundled-key' });
    mockQueryOne.mockResolvedValueOnce(null); // no per-org row

    const auth = await resolveCfCredentials(env, 'org-A');
    expect(auth).toEqual({ apiKey: 'bundled-key', email: 'admin@mb.com', kind: 'global' });
  });

  it('falls back to the bundled CF_API_TOKEN bearer when no global key exists', async () => {
    const env = makeEnv({ CF_API_TOKEN: 'bearer-tok' });
    mockQueryOne.mockResolvedValueOnce(null);

    const auth = await resolveCfCredentials(env, 'org-A');
    expect(auth).toEqual({ kind: 'token', token: 'bearer-tok' });
  });

  it('returns null when no credential is available at any tier', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await resolveCfCredentials(env, 'org-A')).toBeNull();
  });

  it('skips the D1 lookup entirely when orgId is null', async () => {
    const env = makeEnv({ CF_API_TOKEN: 'bearer-tok' });
    const auth = await resolveCfCredentials(env, null);
    expect(auth).toEqual({ kind: 'token', token: 'bearer-tok' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────
// cfAuthHeaders — header shape per auth kind
// ────────────────────────────────────────────────────────────
describe('cfAuthHeaders', () => {
  it('uses X-Auth-Email + X-Auth-Key for global auth', () => {
    expect(cfAuthHeaders({ kind: 'global', email: 'e@x.com', apiKey: 'k' })).toEqual({
      'X-Auth-Email': 'e@x.com',
      'X-Auth-Key': 'k',
    });
  });

  it('uses Authorization: Bearer for token auth', () => {
    expect(cfAuthHeaders({ kind: 'token', token: 'tok-123' })).toEqual({
      Authorization: 'Bearer tok-123',
    });
  });
});
