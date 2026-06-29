/**
 * @module services/client_token
 *
 * @description
 * Pure. Short-lived client token issuer. Produces opaque tokens for embedded
 * widgets and iframes (bolt editor, preview panes). Each token carries a
 * site+user+scope claim set and a deterministic expiry — no DB read needed
 * to check validity.
 *
 * The token itself is a random UUID (no embedded payload, no JWT, no signing).
 * Claims live in the return value only; the Worker stores nothing about the
 * token. Verifiers read the {@link ClientToken} object from the same in-memory
 * scope that minted it, never persisted across requests.
 *
 * @see services/bolt_embed.ts (consumer — embedded editor session wrapping)
 */

/** A short-lived client token for embedded sessions. */
export interface ClientToken {
  readonly token: string;
  readonly expiresAt: number;
  readonly scope: string[];
  readonly siteId: string;
  readonly userId: string;
}

/** Default TTL: 5 minutes (300 000 ms). */
export const DEFAULT_TTL_MS = 300_000;

/**
 * Mint a new short-lived client token.
 *
 * The token value is a new random UUID. All other fields are provided or
 * computed from the arguments — no store, no side-effects.
 *
 * @param siteId - The site the token grants access to.
 * @param userId - The authenticated user the token is bound to.
 * @param scope - Permission scopes (e.g. `["editor:read", "editor:write"]`).
 * @param ttlMs - Lifetime in milliseconds (default {@link DEFAULT_TTL_MS}).
 * @param nowMs - Current epoch ms (default `Date.now()`). Pass a fixed value
 *   in tests for deterministic expiry.
 * @returns A new {@link ClientToken} with a random token value.
 * @example
 * const tok = mintToken('site-abc', 'user-42', ['editor:write']);
 * // → { token: '…', expiresAt: now+300000, scope: ['editor:write'],
 * //     siteId: 'site-abc', userId: 'user-42' }
 */
export function mintToken(
  siteId: string,
  userId: string,
  scope: string[],
  ttlMs: number = DEFAULT_TTL_MS,
  nowMs: number = Date.now(),
): ClientToken {
  return {
    expiresAt: nowMs + ttlMs,
    scope: [...scope],
    siteId,
    token: crypto.randomUUID(),
    userId,
  };
}

/**
 * Check whether a client token has expired.
 *
 * @param token - The token to check.
 * @param nowMs - Current epoch ms (default `Date.now()`). Pass a fixed value
 *   in tests for deterministic expiry.
 * @returns `true` when the token's expiry has passed.
 * @example
 * isExpired(tok, tok.expiresAt - 1) // → false
 * isExpired(tok, tok.expiresAt)     // → true (expired at exactly this ms)
 */
export function isExpired(token: ClientToken, nowMs: number = Date.now()): boolean {
  return nowMs >= token.expiresAt;
}

/**
 * Extract the payload claims from a client token as a plain record.
 *
 * Useful for serialising into logs or passing to middleware that consumes
 * plain objects.
 *
 * @param token - The client token.
 * @returns A record with `siteId`, `userId`, `scope` (array), and `exp`
 *   (alias for `expiresAt`).
 * @example
 * tokenPayload(tok)
 * // → { siteId: 'site-abc', userId: 'user-42',
 * //     scope: ['editor:write'], exp: 1719500000000 }
 */
export function tokenPayload(token: ClientToken): Record<string, unknown> {
  return {
    exp: token.expiresAt,
    scope: token.scope,
    siteId: token.siteId,
    userId: token.userId,
  };
}
