/**
 * AES-GCM encryption helpers for MCP OAuth tokens.
 * Key is provided via env.MCP_ENCRYPTION_KEY (base64-encoded 32 bytes).
 * Encrypted blob format: base64(iv ‖ ciphertext) where iv is 12 bytes.
 */
import type { Env } from '../types/env.js';

async function importRawKey(raw: string): Promise<CryptoKey> {
  const buf = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (buf.length !== 32) throw new Error('MCP_ENCRYPTION_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw', buf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function getKey(env: Env): Promise<CryptoKey> {
  const raw = env.MCP_ENCRYPTION_KEY;
  if (!raw) throw new Error('MCP_ENCRYPTION_KEY not configured');
  return importRawKey(raw);
}

/**
 * Low-level AES-GCM decrypt of a `base64(iv ‖ ciphertext)` blob under one key.
 *
 * @remarks Internal — {@link decrypt} wraps this with the primary→old key
 *   rotation fallback. Throws on a wrong key (GCM auth-tag failure).
 */
async function decryptWithKey(key: CryptoKey, blob: string): Promise<string> {
  const combined = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/**
 * AES-GCM encrypt a UTF-8 string using the worker's MCP encryption key.
 *
 * @remarks
 * Generates a fresh 12-byte IV per call and returns `base64(iv ‖ ciphertext)`.
 * Pair with {@link decrypt} for round-trip. Used by MCP OAuth + CF credentials.
 *
 * @example
 * ```ts
 * const blob = await encrypt(env, accessToken);
 * await dbInsert(env.DB, 'mcp_connections', { token_ct: blob });
 * ```
 *
 * @throws {Error} `MCP_ENCRYPTION_KEY not configured` when env secret missing.
 * @throws {Error} when the secret does not decode to exactly 32 bytes.
 * @see {@link decrypt}
 */
export async function encrypt(env: Env, plaintext: string): Promise<string> {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * AES-GCM decrypt a base64 `iv ‖ ciphertext` blob written by {@link encrypt}.
 *
 * @remarks
 * Symmetric counterpart of {@link encrypt}; uses the worker's primary MCP key.
 *
 * Zero-downtime key rotation: when `MCP_ENCRYPTION_KEY_OLD` is set and the
 * primary key fails to decrypt a blob (a value still encrypted under the old
 * key), this retries once with the old key. Rotation procedure: deploy the new
 * key as `MCP_ENCRYPTION_KEY` + the old key as `MCP_ENCRYPTION_KEY_OLD` → reads
 * keep working → next write re-encrypts the row under the new key → once all
 * rows are re-encrypted, drop `MCP_ENCRYPTION_KEY_OLD`. See
 * `docs/security/secret-at-rest-audit.md`.
 *
 * @example
 * ```ts
 * const token = await decrypt(env, row.token_ct);
 * ```
 *
 * @throws {Error} when the IV/ciphertext split fails or NEITHER key can decrypt.
 * @see {@link encrypt}
 */
export async function decrypt(env: Env, blob: string): Promise<string> {
  const key = await getKey(env);
  try {
    return await decryptWithKey(key, blob);
  } catch (primaryErr) {
    const old = env.MCP_ENCRYPTION_KEY_OLD;
    if (!old) throw primaryErr;
    // Rotation fallback: the blob may still be under the previous key.
    const oldKey = await importRawKey(old);
    return decryptWithKey(oldKey, blob);
  }
}

/**
 * Decrypt a stored secret to plaintext, falling back to the raw value when it is
 * NOT a valid ciphertext.
 *
 * @remarks
 * Migration-free reader for a column that historically stored plaintext and now
 * stores {@link encrypt} ciphertext. An encrypted blob decrypts normally; a legacy
 * plaintext value fails AES-GCM (the GCM auth tag makes accidental valid-decryption
 * impossible) and is returned unchanged — it re-encrypts on the owner's next write.
 * Use at every read site of a newly-encrypted column so old rows keep working with
 * no data migration.
 *
 * @example
 * ```ts
 * const token = await decryptOrPassthrough(env, row.access_token_encrypted);
 * ```
 * @see {@link encrypt}
 * @see {@link decrypt}
 */
export async function decryptOrPassthrough(env: Env, stored: string): Promise<string> {
  try {
    return await decrypt(env, stored);
  } catch {
    return stored; // legacy plaintext (pre-encryption row)
  }
}
