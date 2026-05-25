/**
 * AES-GCM encryption helpers for MCP OAuth tokens.
 * Key is provided via env.MCP_ENCRYPTION_KEY (base64-encoded 32 bytes).
 * Encrypted blob format: base64(iv ‖ ciphertext) where iv is 12 bytes.
 */
import type { Env } from '../types/env.js';

async function getKey(env: Env): Promise<CryptoKey> {
  const raw = env.MCP_ENCRYPTION_KEY;
  if (!raw) throw new Error('MCP_ENCRYPTION_KEY not configured');
  const buf = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (buf.length !== 32) throw new Error('MCP_ENCRYPTION_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw', buf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
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
 * Symmetric counterpart of {@link encrypt}; uses the worker's MCP key.
 *
 * @example
 * ```ts
 * const token = await decrypt(env, row.token_ct);
 * ```
 *
 * @throws {Error} when the IV/ciphertext split fails or the key cannot decrypt.
 * @see {@link encrypt}
 */
export async function decrypt(env: Env, blob: string): Promise<string> {
  const key = await getKey(env);
  const combined = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}
