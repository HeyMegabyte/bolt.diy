/**
 * Encrypt/decrypt a `Record<string, string>` of environment variables via AES-GCM,
 * plus a `maskSecret` helper for safe display.
 *
 * Pure — caller provides the key; no Env dependency.
 *
 * Key format: base64-encoded 32 raw bytes (256-bit AES key).
 * Encrypted blob format: `base64(iv ‖ ciphertext)` where iv is 12 random bytes.
 *
 * @example Encrypt, decrypt, and mask
 * ```ts
 * import { encryptEnvVars, decryptEnvVars, maskSecret } from './env_encrypt.js';
 *
 * const key = btoa('0123456789abcdef0123456789abcdef');
 * const vars = { DATABASE_URL: 'postgres://…', API_KEY: 'sk-abc…' };
 *
 * const blob     = await encryptEnvVars(vars, key);
 * const decrypted = await decryptEnvVars(blob, key);
 * // decrypted === vars
 *
 * maskSecret(vars.API_KEY); // '***'
 * ```
 *
 * @throws {Error} when the key does not decode to exactly 32 bytes.
 * @throws {Error} when the ciphertext is tampered (GCM auth-tag failure) or
 *   the decrypted JSON does not parse as a `Record<string, string>`.
 */

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

async function importRawKey(raw: string): Promise<CryptoKey> {
  const buf = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (buf.length !== 32) throw new Error('Encryption key must decode to exactly 32 bytes');
  return crypto.subtle.importKey('raw', buf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Encrypt a `Record<string, string>` of env vars into a single base64 blob.
 *
 * Serialises the vars to JSON, generates a fresh 12-byte IV, encrypts under
 * the supplied key, and returns `base64(iv ‖ ciphertext)`.
 *
 * @param vars - Key-value pairs to encrypt.
 * @param key  - base64-encoded 32-byte AES-GCM key.
 * @returns Base64-encoded `iv ‖ ciphertext`.
 *
 * @example
 * ```ts
 * const vars  = { SECRET: 's3cret' };
 * const blob  = await encryptEnvVars(vars, key);
 * // blob is base64 of iv(12) ‖ ciphertext — safe to store in D1
 * ```
 */
export async function encryptEnvVars(vars: Record<string, string>, key: string): Promise<string> {
  const k = await importRawKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(vars));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, k, pt));
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64 blob produced by {@link encryptEnvVars} back into a
 * `Record<string, string>`.
 *
 * @param blob - Base64-encoded `iv ‖ ciphertext` previously returned by
 *   {@link encryptEnvVars}.
 * @param key  - base64-encoded 32-byte AES-GCM key (must match encryption key).
 * @returns The original env-var map.
 *
 * @example
 * ```ts
 * const vars = await decryptEnvVars(blob, key);
 * // vars === { SECRET: 's3cret' }
 * ```
 *
 * @throws {Error} if the blob is too short to contain an IV (< 13 bytes after
 *   decode), the GCM auth-tag fails (wrong / tampered key), or the decrypted
 *   payload is not valid JSON or not a `Record<string, string>`.
 */
export async function decryptEnvVars(blob: string, key: string): Promise<Record<string, string>> {
  const k = await importRawKey(key);
  const combined = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
  if (combined.length < 13) throw new Error('Encrypted blob too short — missing IV');
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ iv, name: 'AES-GCM' }, k, ct);
  const parsed = JSON.parse(new TextDecoder().decode(pt));

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Decrypted payload is not an object');
  }
  // Validate every value is a string.
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'string') {
      throw new Error(`Decrypted value for "${k}" is not a string`);
    }
  }
  return parsed as Record<string, string>;
}

/**
 * Replace a secret value with a safe display string.
 *
 * Always returns `'***'` — the secret's content is never exposed.
 *
 * @param _value - The secret to mask (unused; returned value is always `'***'`).
 * @returns The literal string `'***'`.
 *
 * @example
 * ```ts
 * maskSecret('sk-ant-abc123');        // '***'
 * maskSecret('');                     // '***'
 * maskSecret('short');                // '***'
 * ```
 */
export function maskSecret(_value: string): string {
  return '***';
}
