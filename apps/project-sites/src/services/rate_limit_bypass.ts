/**
 * Admin bypass tokens for rate limiting.
 *
 * @remarks
 * Pure provider — zero I/O, no env bindings. Generates self-contained tokens
 * by encoding the admin ID and expiry timestamp as base64 JSON. No shared
 * state, no external storage — token validity is derived from its content
 * and the current time.  Tokens are NOT cryptographically signed; they are
 * trusted only when created and consumed within the same logical system.
 *
 * @example
 * ```ts
 * import { createBypassToken, isValid, BYPASS_TTL_MS } from './rate_limit_bypass';
 *
 * const token = createBypassToken('user_2abcxyz');
 * console.log(isValid(token)); // true
 *
 * // Expire it
 * console.log(isValid(token, Date.now() + BYPASS_TTL_MS + 1)); // false
 * ```
 */

import { Buffer } from 'node:buffer';

/** Default TTL for bypass tokens: 1 hour. */
export const BYPASS_TTL_MS = 3_600_000;

/** Decoded payload inside a valid bypass token. */
export interface BypassTokenPayload {
  /** Unique identifier of the admin user who created this token. */
  adminId: string;
  /** Unix-epoch timestamp (ms) after which the token expires. */
  expiresAt: number;
}

/** Error thrown when `adminId` is empty. */
export class EmptyAdminIdError extends Error {
  constructor() {
    super('adminId must be a non-empty string');
    this.name = 'EmptyAdminIdError';
  }
}

/**
 * Create a self-contained admin bypass token.
 *
 * The token encodes the admin ID and expiry timestamp as base64-encoded JSON.
 * No server-side storage is needed — callers decode and check expiry in-place.
 *
 * @param adminId - Unique identifier of the admin user (must be non-empty)
 * @param ttlMs - Time-to-live in milliseconds (defaults to {@link BYPASS_TTL_MS})
 * @returns A base64-encoded token string that can be decoded back to a
 *          {@link BypassTokenPayload}.
 * @throws {EmptyAdminIdError} when `adminId` is empty
 *
 * @example
 * ```ts
 * // 5-minute token
 * const token = createBypassToken('user_2abc', 300_000);
 *
 * // Default 1-hour token
 * const defaultToken = createBypassToken('user_2abc');
 * ```
 */
export function createBypassToken(adminId: string, ttlMs: number = BYPASS_TTL_MS): string {
  if (!adminId || !adminId.trim()) throw new EmptyAdminIdError();

  const payload: BypassTokenPayload = {
    adminId,
    expiresAt: Date.now() + ttlMs,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/**
 * Check whether a bypass token is valid and not yet expired.
 *
 * Returns `false` for any decoding failure (malformed base64, non-JSON,
 * missing fields, expired timestamp). Never throws.
 *
 * @param token - The raw token string to validate
 * @param nowMs - Reference timestamp for expiry comparison
 *                (defaults to `Date.now()`)
 * @returns `true` when the token is well-formed and its `expiresAt` is
 *          strictly later than `nowMs`
 *
 * @example
 * ```ts
 * isValid(createBypassToken('admin-1'));                          // true
 * isValid(createBypassToken('admin-1', 0), Date.now() + 1);      // false
 * isValid('');                                                    // false
 * isValid('not-base64');                                          // false
 * isValid('e30=');  // base64('{}') — missing adminId            // false
 * ```
 */
export function isValid(token: string, nowMs: number = Date.now()): boolean {
  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const payload = JSON.parse(raw) as BypassTokenPayload;

    return (
      typeof payload.adminId === 'string' &&
      payload.adminId.length > 0 &&
      typeof payload.expiresAt === 'number' &&
      payload.expiresAt > nowMs
    );
  } catch {
    return false;
  }
}
