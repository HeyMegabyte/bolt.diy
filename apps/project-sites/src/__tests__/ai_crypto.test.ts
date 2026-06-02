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
import { encrypt, decrypt } from '../services/ai_crypto.js';
import type { Env } from '../types/env.js';

// 32 raw bytes → base64 (getKey requires the secret to decode to exactly 32).
const KEY_A = btoa('0123456789abcdef0123456789abcdef');
const KEY_B = btoa('FEDCBA9876543210FEDCBA9876543210');
const envWith = (k: string): Env => ({ MCP_ENCRYPTION_KEY: k }) as unknown as Env;

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
});
