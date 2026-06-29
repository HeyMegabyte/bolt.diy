/**
 * @module services/rate_bypass
 * @description HMAC-signed admin bypass tokens for rate-limit overrides.
 * Pure — zero I/O, no env bindings. Tokens are self-contained: the payload
 * (adminId + expiry) is base64url-encoded and signed with HMAC-SHA256.
 * Callers pass the shared secret on both generation and validation.
 *
 * @example
 * ```ts
 * import { generateBypassToken, validateBypass, BYPASS_SECRET_LENGTH } from './rate_bypass';
 *
 * const secret = crypto.randomUUID();
 * console.assert(secret.length >= BYPASS_SECRET_LENGTH); // true
 *
 * const token = generateBypassToken('admin_2abc', secret);
 * const payload = validateBypass(token, secret);
 * // payload === { adminId: 'admin_2abc', expiresAt: <future-epoch-ms> }
 *
 * // Tampered token
 * const bad = validateBypass(token + 'x', secret);
 * // bad === null
 * ```
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimum byte-length for a bypass signing secret.
 *
 * The caller MUST provision a secret at least this long (e.g. via
 * `crypto.randomUUID()` which yields 128 bits / 36 chars — comfortably
 * above 32). {@link generateBypassToken} does not check the length;
 * the caller is responsible for key strength.
 */
export const BYPASS_SECRET_LENGTH = 32;

/** Default TTL for bypass tokens: 15 minutes. */
export const DEFAULT_BYPASS_TTL_MS = 900_000;

/** Decoded payload extracted from a valid HMAC-signed bypass token. */
export interface BypassTokenPayload {
  /** Unique identifier of the admin user. */
  readonly adminId: string;
  /** Unix-epoch timestamp (ms) after which the token expires. */
  readonly expiresAt: number;
}

/** Error thrown when `adminId` is empty or whitespace-only. */
export class EmptyAdminIdError extends Error {
  constructor() {
    super('adminId must be a non-empty string');
    this.name = 'EmptyAdminIdError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * Constant-time string comparison to prevent timing side-channels on HMAC
 * signature verification.
 *
 * Returns `false` immediately (after a self-probe to keep the allocation
 * cost uniform) when lengths differ, and delegates to `timingSafeEqual`
 * when they match.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // uniform cost vs. the match path
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an HMAC-SHA256 signed bypass token.
 *
 * The token encodes the admin identity and an expiry timestamp. It is
 * self-contained — no server-side look-up is required at validation time.
 * The caller must already possess the shared `secret` (e.g. an env var)
 * and provision one that satisfies {@link BYPASS_SECRET_LENGTH}.
 *
 * @param adminId - Unique admin user identifier (must be non-empty).
 * @param secret  - Shared HMAC signing secret (≥ {@link BYPASS_SECRET_LENGTH}
 *                  bytes recommended).
 * @param ttlMs   - Token lifetime in milliseconds
 *                  (defaults to {@link DEFAULT_BYPASS_TTL_MS}).
 * @returns A dot-separated `{payload}.{signature}` token string.
 * @throws {EmptyAdminIdError} When `adminId` is empty or whitespace-only.
 *
 * @example
 * ```ts
 * const secret = crypto.randomUUID();
 * const token = generateBypassToken('user_abc', secret);
 * // token format: <base64url-payload>.<base64url-hmac>
 *
 * // Custom TTL (5 seconds)
 * const quick = generateBypassToken('user_abc', secret, 5_000);
 * ```
 */
export function generateBypassToken(
  adminId: string,
  secret: string,
  ttlMs: number = DEFAULT_BYPASS_TTL_MS,
): string {
  if (!adminId || !adminId.trim()) throw new EmptyAdminIdError();

  const payload: BypassTokenPayload = {
    adminId: adminId.trim(),
    expiresAt: Date.now() + ttlMs,
  };

  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signature = base64UrlEncode(createHmac('sha256', secret).update(encodedPayload).digest());

  return `${encodedPayload}.${signature}`;
}

/**
 * Validate an HMAC-signed bypass token.
 *
 * Rejects tokens whose HMAC does not match (tampered), whose payload
 * cannot be decoded, or whose expiry timestamp is in the past.
 * NEVER throws — returns the decoded payload on success, or `null` on
 * any validation failure.
 *
 * @param token  - The dot-separated `{payload}.{signature}` token string
 *                 produced by {@link generateBypassToken}.
 * @param secret - The same HMAC signing secret used at generation time.
 * @returns The decoded {@link BypassTokenPayload} when the token is valid,
 *          or `null` when the token is malformed, tampered, or expired.
 *
 * @example
 * ```ts
 * const secret = crypto.randomUUID();
 * const token = generateBypassToken('admin-1', secret);
 *
 * const valid = validateBypass(token, secret);
 * // valid === { adminId: 'admin-1', expiresAt: <number> }
 *
 * const tampered = validateBypass(token + 'x', secret);
 * // tampered === null
 *
 * const badSecret = validateBypass(token, 'wrong-secret');
 * // badSecret === null
 * ```
 */
export function validateBypass(token: string, secret: string): BypassTokenPayload | null {
  try {
    const dotIdx = token.lastIndexOf('.');
    if (dotIdx <= 0 || dotIdx >= token.length - 1) return null;

    const payloadStr = token.slice(0, dotIdx);
    const sigReceived = token.slice(dotIdx + 1);

    // Re-compute the expected HMAC and compare in constant time
    const sigExpected = base64UrlEncode(createHmac('sha256', secret).update(payloadStr).digest());

    if (!constantTimeEqual(sigReceived, sigExpected)) return null;

    const raw = Buffer.from(payloadStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (typeof parsed.adminId !== 'string' || parsed.adminId.length === 0) {
      return null;
    }

    if (typeof parsed.expiresAt !== 'number') return null;

    if (parsed.expiresAt <= Date.now()) return null;

    return { adminId: parsed.adminId, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}
