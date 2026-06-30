/**
 * Pure OAuth 2.0 refresh-token request builder and token-expiry calculator.
 *
 * Stateless helpers for constructing refresh-token endpoint requests and
 * computing expiry timestamps from `expires_in` values.  Every function here
 * is a pure function: same inputs -> same outputs.  No I/O, no env
 * requirement, no side effects.
 *
 * @remarks
 * The {@link OAUTH_GRANT_TYPES} constant covers the three grant types this
 * system supports.  Consumers of {@link refreshToken} typically pass the
 * result's `body` and `headers` to `fetch(url, { method: 'POST', headers,
 * body: body.toString() })`.
 *
 * @module oauth_token
 */

import type { OAuthGrantType } from './oauth_client.js';

// ───────────── Constants ─────────────

/**
 * The three OAuth 2.0 grant types this system supports.
 *
 * @example
 * OAUTH_GRANT_TYPES.includes('refresh_token');
 * // -> true
 *
 * @example
 * OAUTH_GRANT_TYPES.includes('implicit');
 * // -> false
 */
export const OAUTH_GRANT_TYPES: readonly OAuthGrantType[] = [
  'authorization_code',
  'client_credentials',
  'refresh_token',
] as const;

// ───────────── Error classes ─────────────

/**
 * Thrown when {@link refreshToken} receives invalid or missing parameters.
 */
export class RefreshTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefreshTokenError';
  }
}

/**
 * Thrown when {@link tokenExpiry} receives an invalid `expiresIn` value.
 */
export class TokenExpiryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenExpiryError';
  }
}

// ───────────── Types ─────────────

/** Return type of {@link refreshToken}. */
export interface RefreshTokenRequest {
  /** URL-encoded body suitable for a POST to the token endpoint. */
  body: URLSearchParams;
  /** Standard OAuth 2.0 headers (Basic auth, content-type, accept). */
  headers: Record<string, string>;
}

// ───────────── Public API ─────────────

/**
 * Builds a token-endpoint HTTP request body and headers for the
 * `refresh_token` grant type.
 *
 * The returned `body` is an `x-www-form-urlencoded` {@link URLSearchParams}
 * with `grant_type`, `client_id`, `client_secret`, and `refresh_token` set.
 * Headers include Basic auth derived from the client credentials, JSON accept,
 * and the form content type.
 *
 * @param clientId - The OAuth 2.0 client identifier.
 * @param clientSecret - The OAuth 2.0 client secret.
 * @param refreshTokenValue - A previously-issued refresh token that has not
 *   yet been revoked.
 * @returns An object containing the `URLSearchParams` body and request
 *   headers.
 * @throws {RefreshTokenError} when any parameter is empty or missing.
 *
 * @example
 * const req = refreshToken('abc123', 's3cret', 'rtoken_v2_xyz');
 * const response = await fetch('https://oauth2.example.com/token', {
 *   method: 'POST',
 *   headers: req.headers,
 *   body: req.body.toString(),
 * });
 *
 * @example
 * refreshToken('', 's3cret', 'rtoken');
 * // -> throws RefreshTokenError: clientId is required
 */
export function refreshToken(
  clientId: string,
  clientSecret: string,
  refreshTokenValue: string,
): RefreshTokenRequest {
  if (!clientId) {
    throw new RefreshTokenError('clientId is required');
  }
  if (!clientSecret) {
    throw new RefreshTokenError('clientSecret is required');
  }
  if (!refreshTokenValue) {
    throw new RefreshTokenError('refreshToken is required');
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('refresh_token', refreshTokenValue);

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  return { body, headers };
}

/**
 * Converts an OAuth 2.0 `expires_in` value (seconds) into a `Date` object.
 *
 * The returned date is computed as `Date.now() + expiresIn * 1000`.
 *
 * @param expiresIn - Token lifetime in seconds (must be a non-negative finite
 *   number).
 * @returns A `Date` representing the moment the token expires.
 * @throws {TokenExpiryError} when `expiresIn` is negative, NaN, or infinite.
 *
 * @example
 * const expiry = tokenExpiry(3600);
 * // -> Date ~1 hour from now
 *
 * @example
 * tokenExpiry(-1);
 * // -> throws TokenExpiryError: expiresIn must be non-negative
 *
 * @example
 * tokenExpiry(Infinity);
 * // -> throws TokenExpiryError: expiresIn must be a finite number
 */
export function tokenExpiry(expiresIn: number): Date {
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) {
    throw new TokenExpiryError('expiresIn must be a finite number');
  }
  if (expiresIn < 0) {
    throw new TokenExpiryError('expiresIn must be non-negative');
  }

  const ms = Math.round(expiresIn * 1000);
  return new Date(Date.now() + ms);
}
