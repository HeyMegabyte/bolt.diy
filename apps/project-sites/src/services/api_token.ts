/**
 * @module services/api_token
 * @description Pure API token lifecycle manager. Creates tokens, checks expiry,
 * validates scope. No I/O — pure functions only.
 *
 * Every token is a value object ({@link ApiToken}) with an id, name, scope list,
 * creation and expiry timestamps, and a last-used timestamp. Tokens are
 * immutable after creation; callers persist in D1 (or any store) and hydrate
 * back into this shape for validation.
 *
 * All timestamps are Unix milliseconds (Number). Passing `nowMs` consistently
 * from the same clock source across calls to {@link isExpired} within a single
 * request ensures deterministic expiry checks.
 */

export type TokenScope = 'read' | 'write' | 'admin';

export interface ApiToken {
  /** Unique identifier (e.g. UUIDv4 or ULID). */
  id: string;
  /** Unix-ms creation timestamp. */
  createdAt: number;
  /** Unix-ms expiry timestamp, or null for a non-expiring token. */
  expiresAt: number | null;
  /** Unix-ms of most recent use, or null if never used. */
  lastUsedAt: number | null;
  /** Human-readable label for display in dashboards. */
  name: string;
  /** Permissions this token grants. At least one scope is required. */
  scopes: TokenScope[];
}

/**
 * Create a new API token.
 *
 * The returned token has `lastUsedAt: null` (never used) and `createdAt` set to
 * `nowMs` (or Date.now() if omitted). If `ttlMs` is a positive number,
 * `expiresAt` is set to `nowMs + ttlMs`; if null or undefined, the token never
 * expires.
 *
 * @param name - Human-readable label.
 * @param scopes - At least one scope; an empty array throws.
 * @param ttlMs - Milliseconds until expiry, or null/undefined for no expiry.
 * @param nowMs - Current time in Unix ms (defaults to Date.now()).
 * @returns A new ApiToken with populated timestamps.
 * @throws {RangeError} If scopes is empty.
 * @throws {RangeError} If ttlMs is zero or negative.
 *
 * @example
 * const token = createToken('CI deploy key', ['write'], 86_400_000);
 * // token.expiresAt === token.createdAt + 86_400_000
 *
 * @example
 * const neverExpires = createToken('read-only monitor', ['read'], null);
 * // neverExpires.expiresAt === null
 */
export function createToken(
  name: string,
  scopes: TokenScope[],
  ttlMs?: number | null,
  nowMs?: number,
): ApiToken {
  if (scopes.length === 0) {
    throw new RangeError('At least one scope is required');
  }
  if (ttlMs !== undefined && ttlMs !== null && ttlMs <= 0) {
    throw new RangeError('ttlMs must be positive, null, or undefined');
  }

  const now = nowMs ?? Date.now();
  return {
    createdAt: now,
    expiresAt: ttlMs != null ? now + ttlMs : null,
    id: crypto.randomUUID(),
    lastUsedAt: null,
    name,
    scopes: [...scopes],
  };
}

/**
 * Check whether an API token is expired.
 *
 * A token with `expiresAt === null` (never-expiring) is never expired.
 * When `nowMs` is omitted, Date.now() is used, making this suitable for
 * inline checks in route handlers.
 *
 * @param token - The token to check.
 * @param nowMs - Current time in Unix ms (defaults to Date.now()).
 * @returns True when the token has an expiry in the past.
 *
 * @example
 * const expired = isExpired(token, Date.now());
 * if (expired) return c.json({ error: 'Token expired' }, 401);
 */
export function isExpired(token: ApiToken, nowMs?: number): boolean {
  if (token.expiresAt === null) return false;
  return token.expiresAt <= (nowMs ?? Date.now());
}

/**
 * Check whether a token has a required scope.
 *
 * Returns true when the token's scope list contains the required scope.
 * "admin" grants "write" and "read" implicitly; "write" grants "read"
 * implicitly. An unknown scope name is checked for exact match only.
 *
 * @param token - The token to check.
 * @param required - The scope the caller requires.
 * @returns True when the token carries the required scope (directly or
 *   via implied hierarchy).
 *
 * @example
 * const canRead = hasScope(token, 'read');   // read, write, and admin tokens
 * const canWrite = hasScope(token, 'write'); // write and admin tokens only
 * const isAdmin = hasScope(token, 'admin');  // admin tokens only
 */
export function hasScope(token: ApiToken, required: TokenScope): boolean {
  if (token.scopes.includes('admin')) return true;
  if (required === 'read' && token.scopes.includes('write')) return true;
  return token.scopes.includes(required);
}
