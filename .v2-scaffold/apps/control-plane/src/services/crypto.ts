/**
 * AES-GCM helpers for secrets at rest. Per-record IV. Master key in MCP_ENCRYPTION_KEY.
 *
 * NEVER rotate MCP_ENCRYPTION_KEY without re-encryption job — every persisted ciphertext
 * is paired with its IV in the same row.
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

async function importKey(env: { MCP_ENCRYPTION_KEY: string }): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(env.MCP_ENCRYPTION_KEY), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string; // base64
}

export async function encryptString(
  env: { MCP_ENCRYPTION_KEY: string },
  plaintext: string,
): Promise<EncryptedBlob> {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ENC.encode(plaintext));
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

export async function decryptString(
  env: { MCP_ENCRYPTION_KEY: string },
  blob: EncryptedBlob,
): Promise<string> {
  const key = await importKey(env);
  const iv = Uint8Array.from(atob(blob.iv), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(blob.ciphertext), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return DEC.decode(pt);
}

/** Convenience: deterministic SHA-256 hex digest (used for cache keys + idempotency). */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', ENC.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string equality. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HMAC-SHA-256 hex signature of `data` using `secret`. Used for legal-grade
 * chain-of-custody signing (e.g. job photo records, `job_photos.server_signature`).
 *
 * @example
 * ```ts
 * const sig = await hmacSha256Hex(env.SESSION_SECRET, `${r2_key}|${captured_at}|${hash}`);
 * ```
 */
export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    ENC.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
