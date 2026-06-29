/**
 * @module session_store
 * @description Pure session data utilities for in-memory session manipulation.
 *
 * Provides factory, expiry check, role lookup, and summary helpers for a
 * {@link SessionData} structure.  All functions are deterministic — no I/O,
 * no imports from the Worker runtime.
 *
 * @example
 * ```ts
 * import { createSession, isExpired, hasRole, sessionSummary, SESSION_TTL } from '../services/session_store.js';
 *
 * const s = createSession('u1', 'org1', ['admin', 'billing_admin']);
 * console.log(isExpired(s));  // false (fresh)
 * console.log(hasRole(s, 'admin'));  // true
 * ```
 *
 * @packageDocumentation
 */

/** Default session time-to-live: 24 hours in milliseconds. */
export const SESSION_TTL = 24 * 3600 * 1000;

/**
 * Core session data carried in memory (not persisted in D1).
 *
 * @public
 */
export interface SessionData {
  /** Authenticated user's unique ID. */
  userId: string;
  /** Organisation the session is scoped to. */
  orgId: string;
  /** Role identifiers (e.g. `['owner']`, `['admin', 'billing_admin']`). */
  roles: string[];
  /** Expiration epoch in milliseconds (`Date.now()` + TTL). */
  expiresAt: number;
  /** Arbitrary caller-defined metadata (device info, IP, flags, …). */
  metadata: Record<string, unknown>;
}

/**
 * Create a new {@link SessionData} value.
 *
 * @param userId   - Authenticated user ID.
 * @param orgId    - Organisation ID the session belongs to.
 * @param roles    - Optional role list (defaults to `[]`).
 * @param ttlMs    - Time-to-live in milliseconds (defaults to {@link SESSION_TTL}).
 * @param nowMs    - Optional "now" timestamp for deterministic tests (defaults to `Date.now()`).
 * @returns A populated {@link SessionData} with `expiresAt` computed from `nowMs + ttlMs`.
 *
 * @example
 * ```ts
 * const s = createSession('u1', 'org1', ['admin']);
 * expect(s.userId).toBe('u1');
 * expect(s.roles).toEqual(['admin']);
 * expect(s.expiresAt).toBeGreaterThan(Date.now());
 * ```
 */
export function createSession(
  userId: string,
  orgId: string,
  roles?: string[],
  ttlMs?: number,
  nowMs?: number,
): SessionData {
  const now = nowMs ?? Date.now();
  return {
    expiresAt: now + (ttlMs ?? SESSION_TTL),
    metadata: {},
    orgId,
    roles: roles ?? [],
    userId,
  };
}

/**
 * Check whether a session has expired.
 *
 * @param session - The session to inspect.
 * @param nowMs   - Optional "now" timestamp (defaults to `Date.now()`).
 * @returns `true` when `nowMs ≥ session.expiresAt`.
 *
 * @example
 * ```ts
 * const s = createSession('u1', 'org1', [], 10_000, 0);
 * expect(isExpired(s, 5_000)).toBe(false);
 * expect(isExpired(s, 10_000)).toBe(true);
 * ```
 */
export function isExpired(session: SessionData, nowMs?: number): boolean {
  return (nowMs ?? Date.now()) >= session.expiresAt;
}

/**
 * Test whether the session carries a specific role.
 *
 * @param session - The session to inspect.
 * @param role    - Role identifier to search for (case-sensitive).
 * @returns `true` when `session.roles` contains `role`.
 *
 * @example
 * ```ts
 * const s = createSession('u1', 'org1', ['owner', 'billing_admin']);
 * expect(hasRole(s, 'owner')).toBe(true);
 * expect(hasRole(s, 'nonexistent')).toBe(false);
 * ```
 */
export function hasRole(session: SessionData, role: string): boolean {
  return session.roles.includes(role);
}

/**
 * Derive a human-oriented summary of a session.
 *
 * @param session - The session to summarise.
 * @returns An object with `userId`, `orgId`, `roleCount`, and `timeRemaining` (ms until
 *          `expiresAt`, or `0` when already expired).
 *
 * @example
 * ```ts
 * const s = createSession('u1', 'org1', ['admin'], 3600_000, 0);
 * const sum = sessionSummary(s);
 * expect(sum.userId).toBe('u1');
 * expect(sum.roleCount).toBe(1);
 * expect(sum.timeRemaining).toBe(3600_000);
 * ```
 */
export function sessionSummary(session: SessionData): {
  userId: string;
  orgId: string;
  roleCount: number;
  timeRemaining: number;
} {
  const now = Date.now();
  return {
    orgId: session.orgId,
    roleCount: session.roles.length,
    timeRemaining: Math.max(0, session.expiresAt - now),
    userId: session.userId,
  };
}
