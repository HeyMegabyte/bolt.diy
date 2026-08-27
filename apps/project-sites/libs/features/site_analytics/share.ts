/**
 * @module libs/features/site_analytics/share
 * @description AN48 — public shareable read-only analytics links. An owner mints
 * an HMAC-signed, time-boxed token for their site; anyone with the link can read
 * the (non-PII, aggregate) analytics summary until it expires. The token IS the
 * capability — unguessable + tamper-evident + expiring — so the public read
 * endpoint needs no session.
 *
 * Token shape: `"<siteId>.<expEpochMs>.<hmacHex>"` where the HMAC-SHA256 is over
 * `"<siteId>.<expEpochMs>"`. siteId is a UUID (no dots) and exp is digits, so a
 * single `.split('.')` recovers the three parts unambiguously.
 *
 * @packageDocumentation
 */

import { timingSafeEqual } from '../../../src/lib/timing_safe_equal.js';

/** Typed failure for share-token operations. */
export class ShareTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareTokenError';
  }
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}


/**
 * Mint a signed share token for a site, valid until `expEpochMs`.
 *
 * @param secret      - The server HMAC secret (never sent to the client).
 * @param siteId      - The site the token grants read access to.
 * @param expEpochMs  - Absolute expiry (Unix ms).
 * @returns `"<siteId>.<exp>.<sig>"`.
 * @throws {ShareTokenError} when the secret is empty.
 *
 * @example
 * const token = await mintShareToken(secret, 'site_1', Date.now() + 30 * 864e5);
 */
export async function mintShareToken(
  secret: string,
  siteId: string,
  expEpochMs: number,
): Promise<string> {
  if (!secret) throw new ShareTokenError('A signing secret is required.');
  if (!siteId) throw new ShareTokenError('siteId is required.');
  const base = `${siteId}.${expEpochMs}`;
  const sig = await hmacHex(secret, base);
  return `${base}.${sig}`;
}

/**
 * Verify a share token. Returns the `{ siteId, expEpochMs }` it grants ONLY when
 * the signature matches AND it has not expired; otherwise `null` (never trust an
 * unverified or stale token).
 *
 * @param secret - The server HMAC secret.
 * @param token  - The `"<siteId>.<exp>.<sig>"` string.
 * @param nowMs  - Current time (Unix ms) for the expiry check.
 * @returns `{ siteId, expEpochMs }` or `null`.
 *
 * @example
 * const grant = await verifyShareToken(secret, token, Date.now());
 * if (!grant) return notFound();
 */
export async function verifyShareToken(
  secret: string,
  token: string,
  nowMs: number,
): Promise<{ siteId: string; expEpochMs: number } | null> {
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [siteId, expStr, sig] = parts as [string, string, string];
  const expEpochMs = Number(expStr);
  if (!siteId || !Number.isInteger(expEpochMs) || expEpochMs <= 0) return null;
  const expected = await hmacHex(secret, `${siteId}.${expEpochMs}`);
  if (!timingSafeEqual(expected, sig)) return null;
  if (expEpochMs <= nowMs) return null; // expired
  return { siteId, expEpochMs };
}
