/**
 * env_encrypt unit tests — AES-GCM env-var encryption, decryption, and masking.
 *
 * Uses real `crypto.subtle` (Node 22 WebCrypto). No mocks — these are pure
 * crypto round-trip and edge-case assertions.
 */
import { encryptEnvVars, decryptEnvVars, maskSecret } from '../services/env_encrypt.js';

// Two distinct 32-byte keys for cross-key rejection tests.
const KEY_A = btoa('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const KEY_B = btoa('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

describe('encryptEnvVars / decryptEnvVars', () => {
  it('round-trips a simple env-var map', async () => {
    const vars = { SECRET: 's3cret', URL: 'postgres://localhost:5432/db' };
    const blob = await encryptEnvVars(vars, KEY_A);
    expect(blob).not.toContain('s3cret'); // ciphertext must not leak plaintext
    expect(await decryptEnvVars(blob, KEY_A)).toEqual(vars);
  });

  it('round-trips an empty map', async () => {
    const blob = await encryptEnvVars({}, KEY_A);
    expect(await decryptEnvVars(blob, KEY_A)).toEqual({});
  });

  it('round-trips a single-entry map', async () => {
    const blob = await encryptEnvVars({ API_KEY: 'sk-abc123' }, KEY_A);
    expect(await decryptEnvVars(blob, KEY_A)).toEqual({ API_KEY: 'sk-abc123' });
  });

  it('round-trips unicode values', async () => {
    const vars = { GREETING: 'héllo — café ☕', EMOJI: '🔐🔑' };
    const blob = await encryptEnvVars(vars, KEY_A);
    expect(await decryptEnvVars(blob, KEY_A)).toEqual(vars);
  });

  it('produces different blobs for the same input (random IV)', async () => {
    const vars = { KEY: 'value' };
    const a = await encryptEnvVars(vars, KEY_A);
    const b = await encryptEnvVars(vars, KEY_A);
    expect(a).not.toBe(b); // distinct IVs → distinct ciphertexts
    expect(await decryptEnvVars(a, KEY_A)).toEqual(vars);
    expect(await decryptEnvVars(b, KEY_A)).toEqual(vars);
  });

  it('rejects decryption under a different key', async () => {
    const blob = await encryptEnvVars({ X: 'y' }, KEY_A);
    await expect(decryptEnvVars(blob, KEY_B)).rejects.toThrow();
  });

  it('rejects a tampered ciphertext (GCM auth tag)', async () => {
    const blob = await encryptEnvVars({ X: 'y' }, KEY_A);
    const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    const mid = Math.floor(bytes.length / 2);
    bytes[mid] = bytes[mid]! ^ 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptEnvVars(tampered, KEY_A)).rejects.toThrow();
  });

  it('rejects a truncated blob', async () => {
    await expect(decryptEnvVars(btoa('toolate'), KEY_A)).rejects.toThrow(/too short/i);
  });

  it('rejects an empty blob', async () => {
    await expect(decryptEnvVars('', KEY_A)).rejects.toThrow();
  });

  it('throws on a key that is not 32 bytes', async () => {
    const short = btoa('short');
    await expect(encryptEnvVars({ X: 'y' }, short)).rejects.toThrow(/32 bytes/i);
    await expect(encryptEnvVars({ X: 'y' }, '')).rejects.toThrow();
  });

  it('throws when decrypted JSON is an array (not Record<string,string>)', async () => {
    const k = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(KEY_A), (c) => c.charCodeAt(0)),
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pt = new TextEncoder().encode(JSON.stringify(['a', 'b']));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, pt));
    const combined = new Uint8Array(iv.length + ct.length);
    combined.set(iv, 0);
    combined.set(ct, iv.length);
    const blob = btoa(String.fromCharCode(...combined));
    await expect(decryptEnvVars(blob, KEY_A)).rejects.toThrow(/not an object/i);
  });

  it('throws when a decrypted value is not a string', async () => {
    const k = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(KEY_A), (c) => c.charCodeAt(0)),
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pt = new TextEncoder().encode(JSON.stringify({ COUNT: 42 }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, pt));
    const combined = new Uint8Array(iv.length + ct.length);
    combined.set(iv, 0);
    combined.set(ct, iv.length);
    const blob = btoa(String.fromCharCode(...combined));
    await expect(decryptEnvVars(blob, KEY_A)).rejects.toThrow(/not a string/i);
  });
});

describe('maskSecret', () => {
  it('returns *** for any input', () => {
    expect(maskSecret('sk-abc123')).toBe('***');
    expect(maskSecret('')).toBe('***');
    expect(maskSecret('a')).toBe('***');
    expect(maskSecret('very-long-secret-value-here')).toBe('***');
  });
});
