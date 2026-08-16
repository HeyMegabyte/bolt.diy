/**
 * ai_crypto — AES-GCM encryption-at-rest security properties.
 *
 * `encrypt`/`decrypt` protect user secrets in D1 (MCP OAuth tokens, CF
 * credentials). The round-trip was only smoke-tested indirectly via
 * `ai_env_vars`. This suite locks the security-critical guarantees directly:
 *   1. round-trip fidelity,
 *   2. TAMPER REJECTION (the GCM auth tag — the reason GCM is used over CTR),
 *   3. wrong-key rejection,
 *   4. unique IV per call (no IV reuse → no nonce-reuse catastrophe),
 *   5. key-length validation.
 *
 * Uses real `crypto.subtle` (Node 22 WebCrypto). No mocks — these are pure
 * crypto assertions.
 */
import { encrypt, decrypt, decryptOrPassthrough } from '../services/ai_crypto.js';
import type { Env } from '../types/env.js';

// 32 raw bytes → base64 (getKey requires the secret to decode to exactly 32).
const KEY_A = btoa('0123456789abcdef0123456789abcdef');
const KEY_B = btoa('FEDCBA9876543210FEDCBA9876543210');
const envWith = (k: string): Env => ({ MCP_ENCRYPTION_KEY: k }) as unknown as Env;
const envRotating = (primary: string, old: string): Env =>
  ({ MCP_ENCRYPTION_KEY: primary, MCP_ENCRYPTION_KEY_OLD: old }) as unknown as Env;

describe('ai_crypto AES-GCM', () => {
  it('round-trips plaintext exactly', async () => {
    const env = envWith(KEY_A);
    const secret = 'sk-ant-api03-very-secret-token_value-123';
    const blob = await encrypt(env, secret);
    expect(blob).not.toContain(secret); // ciphertext must not leak plaintext
    expect(await decrypt(env, blob)).toBe(secret);
  });

  it('round-trips unicode + empty string', async () => {
    const env = envWith(KEY_A);
    for (const s of ['', 'café ☕ — naïve', '🔐🔑']) {
      expect(await decrypt(env, await encrypt(env, s))).toBe(s);
    }
  });

  it('REJECTS a tampered ciphertext (GCM auth tag)', async () => {
    const env = envWith(KEY_A);
    const blob = await encrypt(env, 'tamper-me');
    // Flip a byte in the middle of base64(iv‖ct) and re-encode.
    const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    const mid = Math.floor(bytes.length / 2);
    bytes[mid] = bytes[mid]! ^ 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decrypt(env, tampered)).rejects.toThrow();
  });

  it('REJECTS decryption under a different key', async () => {
    const blob = await encrypt(envWith(KEY_A), 'cross-key');
    await expect(decrypt(envWith(KEY_B), blob)).rejects.toThrow();
  });

  it('uses a fresh IV per call (same plaintext → different blobs)', async () => {
    const env = envWith(KEY_A);
    const a = await encrypt(env, 'same-input');
    const b = await encrypt(env, 'same-input');
    expect(a).not.toBe(b); // 12-byte random IV prepended → distinct ciphertext
    expect(await decrypt(env, a)).toBe('same-input');
    expect(await decrypt(env, b)).toBe('same-input');
  });

  it('throws when the key is missing or not 32 bytes', async () => {
    await expect(encrypt(envWith(''), 'x')).rejects.toThrow(/not configured/i);
    await expect(encrypt(envWith(btoa('too-short')), 'x')).rejects.toThrow(/32 bytes/i);
  });

  // ── Zero-downtime key rotation (MCP_ENCRYPTION_KEY_OLD fallback) ──
  it('decrypts a blob written under the OLD key when rotating (primary fails → old succeeds)', async () => {
    // Value was encrypted under KEY_B (the soon-to-be-old key).
    const blob = await encrypt(envWith(KEY_B), 'rotate-me');
    // Now KEY_A is primary, KEY_B is the configured fallback.
    const env = envRotating(KEY_A, KEY_B);
    expect(await decrypt(env, blob)).toBe('rotate-me');
  });

  it('still decrypts NEW-key blobs while a rotation fallback is configured', async () => {
    const env = envRotating(KEY_A, KEY_B);
    const blob = await encrypt(env, 'new-key-value'); // encrypts under primary KEY_A
    expect(await decrypt(env, blob)).toBe('new-key-value');
  });

  it('throws when NEITHER the primary nor the old key can decrypt', async () => {
    const blob = await encrypt(envWith(KEY_A), 'orphan');
    // Primary KEY_B, old also wrong → both fail → surfaces the error.
    const env = envRotating(KEY_B, btoa('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'));
    await expect(decrypt(env, blob)).rejects.toThrow();
  });

  // ── decryptOrPassthrough: migration-free reader for a newly-encrypted column ──
  it('decryptOrPassthrough decrypts a real ciphertext blob', async () => {
    const env = envWith(KEY_A);
    const blob = await encrypt(env, 'ghp_encrypted_token');
    expect(await decryptOrPassthrough(env, blob)).toBe('ghp_encrypted_token');
  });

  it('decryptOrPassthrough returns a LEGACY PLAINTEXT value unchanged (never garbles it)', async () => {
    const env = envWith(KEY_A);
    // Pre-encryption plaintext secrets are not valid iv‖ct GCM blobs → passthrough,
    // so legacy rows keep working with no data migration.
    for (const legacy of ['ghp_legacy_plaintext_token_123', 'sk-plain', 'not base64!!!']) {
      expect(await decryptOrPassthrough(env, legacy)).toBe(legacy);
    }
  });
});
