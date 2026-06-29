/**
 * @module services/webhook_signature
 * @description Generic webhook HMAC signature builder and verifier for outbound
 * webhooks. We sign what we send so recipients can verify the payload came from
 * us, unchanged, and within a freshness window.
 *
 * Uses HMAC-SHA256 or HMAC-SHA512 (configurable per signer). Timestamps are
 * Unix milliseconds as strings to avoid JSON-parse ambiguity.
 *
 * ## Usage (sign — sending a webhook)
 *
 * ```ts
 * import { buildWebhookHeaders } from '../services/webhook_signature.js';
 *
 * const payload = JSON.stringify({ event: 'site.published', id: 'abc' });
 * const headers = await buildWebhookHeaders(payload, {
 *   secret: 'whsec_...',
 *   algorithm: 'sha256',
 * });
 * // headers = { 'x-webhook-signature': '<hex>', 'x-webhook-timestamp': '<ms>' }
 * ```
 *
 * ## Usage (verify — receiving our webhook)
 *
 * ```ts
 * import { verifySignature } from '../services/webhook_signature.js';
 *
 * const ok = await verifySignature(
 *   rawBody,
 *   req.headers['x-webhook-signature'],
 *   secret,
 *   req.headers['x-webhook-timestamp'],
 *   300_000, // 5 minutes
 * );
 * if (!ok) return new Response('signature mismatch', { status: 401 });
 * ```
 *
 * @packageDocumentation
 */

/** HMAC algorithm identifiers supported by this module. */
export type HmacAlgorithm = 'sha256' | 'sha512';

/** Configuration for a webhook signer instance. */
export interface WebhookSigner {
  /** Shared secret (UTF-8, ≥16 bytes recommended). */
  secret: string;
  /** HMAC hash algorithm. */
  algorithm: HmacAlgorithm;
}

/**
 * Map our short names to Web Crypto algorithm params.
 * @internal
 */
const HMAC_ALGO: Record<HmacAlgorithm, string> = {
  sha256: 'SHA-256',
  sha512: 'SHA-512',
};

/**
 * Compute an HMAC hex digest of the given payload.
 *
 * Uses Web Crypto (`crypto.subtle`) so it works in Workers, Node ≥19, and
 * modern browsers. Returns the lowercase hex-encoded digest.
 *
 * @param payload - The raw string to sign.
 * @param secret - Shared HMAC secret (UTF-8).
 * @param algorithm - Hash algorithm; defaults to `'sha256'`.
 * @returns Lowercase hex-encoded HMAC digest.
 *
 * @example
 * const sig = await signPayload('{"event":"ping"}', 'mysecret', 'sha256');
 * // → "5a8d3f7a..."
 */
export async function signPayload(
  payload: string,
  secret: string,
  algorithm: HmacAlgorithm = 'sha256',
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: HMAC_ALGO[algorithm] },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build the standard webhook signing headers for a payload.
 *
 * Returns `x-webhook-signature` (HMAC hex of the payload) and
 * `x-webhook-timestamp` (Unix milliseconds as a string). Recipients
 * use both to verify authenticity and freshness.
 *
 * @param payload - The raw webhook body string.
 * @param signer - The signer configuration (secret + algorithm).
 * @returns An object with the two signing headers.
 *
 * @example
 * const headers = await buildWebhookHeaders('{"event":"site.published"}', {
 *   secret: 'whsec_test',
 *   algorithm: 'sha256',
 * });
 * // → { 'x-webhook-signature': '<hex>', 'x-webhook-timestamp': '1719500000123' }
 */
export async function buildWebhookHeaders(
  payload: string,
  signer: WebhookSigner,
): Promise<{ 'x-webhook-signature': string; 'x-webhook-timestamp': string }> {
  const signature = await signPayload(payload, signer.secret, signer.algorithm);
  const timestamp = String(Date.now());
  return {
    'x-webhook-signature': signature,
    'x-webhook-timestamp': timestamp,
  };
}

/**
 * Verify an HMAC webhook signature with an optional freshness window.
 *
 * Recomputes the HMAC of `payload` with `secret` and compares it
 * (constant-time) against the provided `signature`. When `toleranceMs` is
 * provided, also checks that the `timestamp` is within that many milliseconds
 * of the current time.
 *
 * @param payload - The raw webhook body that was signed.
 * @param signature - The `x-webhook-signature` hex string from the request.
 * @param secret - The shared HMAC secret.
 * @param timestamp - The `x-webhook-timestamp` Unix ms string from the request.
 * @param toleranceMs - Optional freshness window in milliseconds. When set,
 *   the timestamp must be within this range of `Date.now()`.
 * @returns `true` if the signature matches and the timestamp is fresh (when
 *   tolerance is set), `false` otherwise.
 *
 * @example
 * // Verify with 5-minute freshness
 * const ok = await verifySignature(
 *   '{"event":"site.published"}',
 *   receivedSig,
 *   'whsec_test',
 *   receivedTs,
 *   300_000,
 * );
 */
export async function verifySignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  toleranceMs?: number,
): Promise<boolean> {
  // Infer algorithm from signature hex length: SHA-256 → 64 chars, SHA-512 → 128.
  const algorithm: HmacAlgorithm = signature.length >= 128 ? 'sha512' : 'sha256';
  const expected = await signPayload(payload, secret, algorithm);

  // Constant-time comparison to prevent timing attacks.
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (mismatch !== 0) return false;

  // Timestamp freshness check (optional).
  if (toleranceMs !== undefined) {
    const ts = parseInt(timestamp, 10);
    if (Number.isNaN(ts)) return false;
    const now = Date.now();
    if (Math.abs(now - ts) > toleranceMs) return false;
  }

  return true;
}
