/**
 * @module services/sso_session
 *
 * @description Pure SSO/OIDC session manager. Creates ephemeral session records
 * from an OIDC `id_token` and checks their expiry. No I/O, no side-effects, no
 * runtime deps.
 *
 * An SSO session is distinct from a D1 user session — it represents an active
 * OIDC login window (the brief window between IdP callback and D1 session
 * establishment), not the long-lived application session.
 *
 * @packageDocumentation
 */

/**
 * Default TTL for an SSO session, in milliseconds (1 hour).
 */
export const SSO_SESSION_TTL = 3_600_000;

/**
 * An ephemeral SSO/OIDC session record.
 *
 * Created when a user authenticates through an external IdP and consumed when
 * the corresponding {@link SsoSession} is established. `idToken` is the raw JWT
 * from the provider; store it only long enough to verify + exchange it for a
 * D1 session.
 */
export interface SsoSession {
  /** The user identifier that the IdP authenticated. */
  readonly userId: string;
  /** SSO provider key (e.g. `'google'`, `'github'`, `'custom_oidc'`). */
  readonly provider: string;
  /** Raw JWT `id_token` from the OIDC provider (opaque, not validated here). */
  readonly idToken: string;
  /** Unix-ms timestamp when the session was created (`Date.now()`). */
  readonly createdAt: number;
  /** Unix-ms timestamp when the session expires (≈ `createdAt + SSO_SESSION_TTL`). */
  readonly expiresAt: number;
}

/**
 * Create an {@link SsoSession} from an OIDC authentication result.
 *
 * Sets `createdAt` to `Date.now()` and `expiresAt` to `createdAt +
 * {@link SSO_SESSION_TTL}`.
 *
 * @param userId - The user identifier returned by the IdP.
 * @param provider - The SSO provider name (e.g. `'google'`, `'okta'`).
 * @param idToken - Raw JWT `id_token` from the provider's token endpoint.
 * @returns A fully-formed {@link SsoSession}.
 *
 * @example
 * const session = createSsoSession('usr_abc', 'google', 'eyJhbGciOi...');
 * // session.createdAt  ≈ Date.now()
 * // session.expiresAt  ≈ session.createdAt + 3_600_000
 * // session.provider   === 'google'
 * // session.userId     === 'usr_abc'
 */
export function createSsoSession(userId: string, provider: string, idToken: string): SsoSession {
  const createdAt = Date.now();
  return {
    createdAt,
    expiresAt: createdAt + SSO_SESSION_TTL,
    idToken,
    provider,
    userId,
  };
}

/**
 * Check whether an {@link SsoSession} is expired.
 *
 * When `nowMs` is omitted, uses `Date.now()`. A session whose `expiresAt` is
 * equal to `nowMs` is considered expired (use a strict-later check — the
 * threshold is `>=`, not `>`).
 *
 * @param session - The session to check.
 * @param nowMs - Optional override for the current time in ms. Defaults to
 *   `Date.now()`.
 * @returns `true` when the session has expired or `nowMs >= session.expiresAt`.
 *
 * @example
 * const session = createSsoSession('usr_abc', 'google', 'eyJhbGciOi...');
 * isExpired(session, session.createdAt);          // → false (just created)
 * isExpired(session, session.expiresAt);           // → true  (at the boundary)
 * isExpired(session, session.createdAt + 10_000);  // → false (10s later)
 *
 * @example
 * // Default to real clock
 * isExpired(session); // → depends on current time
 */
export function isExpired(session: SsoSession, nowMs?: number): boolean {
  const now = nowMs ?? Date.now();
  return now >= session.expiresAt;
}
