/**
 * @module services/auth_session
 *
 * @description
 * Auth session data model and pure utilities. {@link AuthSession} describes an
 * active authenticated session with expiry; {@link createSession} builds one from
 * caller-supplied context; {@link isExpired} checks staleness; {@link sessionSummary}
 * returns a human-readable snapshot for logging/UIs.
 *
 * Pure + total — no I/O, no clock. The caller injects `nowMs` for deterministic
 * testing.
 *
 * @see services/auth.ts (session creation, D1 persistence)
 * @see middleware/auth.ts (Bearer → session resolution)
 */

/** Default TTL for a session: 7 days in milliseconds. */
export const SESSION_TTL = 7 * 24 * 3600 * 1000;

/**
 * An active authenticated session.
 *
 * @remarks The `expiresAt` field is a Unix-epoch timestamp in milliseconds.
 *   Callers check staleness via {@link isExpired} — never compare `Date.now()`
 *   directly against this value.
 */
export interface AuthSession {
  /** Stable user identifier (Clerk `sub` or D1 `users.id`). */
  readonly userId: string;
  /** Opaque bearer token presented by the client. */
  readonly token: string;
  /** Epoch ms at which this session expires. */
  readonly expiresAt: number;
  /** User-agent / device description collected at session creation. */
  readonly deviceInfo: string;
  /** IP address (v4 or v6) observed at session creation. */
  readonly ipAddress: string;
}

/**
 * Build a new {@link AuthSession} from raw context.
 *
 * @param userId - Stable user identifier.
 * @param deviceInfo - Device description (user-agent). Defaults to `'unknown'`.
 * @param ipAddress - Originating IP address. Defaults to `'0.0.0.0'`.
 * @param ttlMs - Session lifetime in ms. Defaults to {@link SESSION_TTL}.
 * @param nowMs - Current epoch ms (injected for deterministic testing).
 *   Defaults to `Date.now()`.
 * @returns A fully-populated session object.
 * @example createSession('usr_abc', 'Chrome/149', '203.0.113.1')
 * // → { userId:'usr_abc', token:'…', expiresAt:1900000000000,
 * //     deviceInfo:'Chrome/149', ipAddress:'203.0.113.1' }
 */
export function createSession(
  userId: string,
  deviceInfo?: string,
  ipAddress?: string,
  ttlMs?: number,
  nowMs?: number,
): AuthSession {
  const now = nowMs ?? Date.now();
  const token = crypto.randomUUID();
  return {
    deviceInfo: deviceInfo ?? 'unknown',
    expiresAt: now + (ttlMs ?? SESSION_TTL),
    ipAddress: ipAddress ?? '0.0.0.0',
    token,
    userId,
  };
}

/**
 * Check whether a session has expired.
 *
 * @param session - The session to inspect.
 * @param nowMs - Current epoch ms (injected for deterministic testing).
 *   Defaults to `Date.now()`.
 * @returns `true` when the session's `expiresAt` is in the past.
 * @example isExpired(session) // → true | false
 */
export function isExpired(session: AuthSession, nowMs?: number): boolean {
  const now = nowMs ?? Date.now();
  return session.expiresAt <= now;
}

/**
 * Produce a human-consumable summary of a session.
 *
 * @param session - The session to summarise.
 * @returns An object with the caller-supplied userId, the remaining time in
 *   milliseconds, and a best-guess location string derived from the IP address
 *   (currently the raw address — a future GEO-IP hook can replace `'0.0.0.0'`).
 * @example sessionSummary(session)
 * // → { userId:'usr_abc', timeRemaining:345600000, location:'203.0.113.1' }
 */
export function sessionSummary(session: AuthSession): {
  userId: string;
  timeRemaining: number;
  location: string;
} {
  const now = Date.now();
  return {
    location: session.ipAddress,
    timeRemaining: Math.max(0, session.expiresAt - now),
    userId: session.userId,
  };
}
