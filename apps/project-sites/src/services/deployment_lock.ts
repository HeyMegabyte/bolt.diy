/**
 * @module services/deployment_lock
 * @description Pure lock state machine for preventing concurrent deploys of the
 * same site. acquire/release/check — no I/O. The caller stores the lock object
 * in whatever persistent layer (D1, KV, DO memory). Never throws.
 *
 * @packageDocumentation
 */

/** Default lock timeout — 5 minutes, long enough for a build, not permanent. */
export const LOCK_TIMEOUT_MS = 300_000;

/**
 * A deployment lock for one site.
 *
 * Properties are read-only at the type level; use {@link acquireLock} to create
 * and {@link releaseLock} to expire.
 */
export interface DeploymentLock {
  /** Unix-ms when the lock auto-expires. */
  readonly expiresAt: number;
  /** Unix-ms when the lock was acquired. */
  readonly lockedAt: number;
  /** Who (user-id or agent-id) holds the lock. */
  readonly lockedBy: string;
  /** The site being locked. */
  readonly siteId: string;
}

/**
 * Create a fresh deployment lock for a site.
 *
 * @param siteId - The site to lock.
 * @param userId - The identity claiming the lock.
 * @param nowMs - Current time in ms (pass in for testability; defaults to `Date.now()`).
 * @returns A new lock with a 5-minute expiry window.
 *
 * @example
 * acquireLock('site-abc', 'user-42', 1_000_000)
 * // → { siteId: 'site-abc', lockedBy: 'user-42', lockedAt: 1_000_000, expiresAt: 1_301_000 }
 */
export function acquireLock(
  siteId: string,
  userId: string,
  nowMs: number = Date.now(),
): DeploymentLock {
  const t = Number.isFinite(nowMs) ? nowMs : Date.now();
  return {
    expiresAt: t + LOCK_TIMEOUT_MS,
    lockedAt: t,
    lockedBy: userId,
    siteId,
  };
}

/**
 * Check whether a lock is still active (not expired).
 *
 * @param lock - The lock to check.
 * @param nowMs - Current time in ms (pass in for testability; defaults to `Date.now()`).
 * @returns `true` while the lock has not expired; `false` if it has expired or is nullish.
 *
 * @example
 * const lock = acquireLock('x', 'u', 1000);
 * isLocked(lock, 1000)              // true
 * isLocked(lock, 1000 + LOCK_TIMEOUT_MS + 1) // false
 * isLocked(null)                     // false
 */
export function isLocked(
  lock: DeploymentLock | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lock) return false;
  const t = Number.isFinite(nowMs) ? nowMs : Date.now();
  return lock.expiresAt > t;
}

/**
 * Release a lock — returns `null` so callers can write `lock = releaseLock(lock)`.
 *
 * @param _lock - The lock to release (accepted but unused — the function is
 * a pure identity-to-null for API symmetry).
 * @returns Always `null`.
 *
 * @example
 * let lock = acquireLock('x', 'u');
 * lock = releaseLock(lock); // null
 */
export function releaseLock(_lock: DeploymentLock | null | undefined): null {
  void _lock;
  return null;
}

/**
 * Milliseconds remaining until the lock expires (0 if already expired or nullish).
 *
 * @param lock - The lock to measure.
 * @param nowMs - Current time in ms (pass in for testability; defaults to `Date.now()`).
 * @returns `> 0` while active, `0` once expired or when lock is nullish.
 *
 * @example
 * const lock = acquireLock('x', 'u', 1000);
 * lockExpiry(lock, 1000)                  // 300_000
 * lockExpiry(lock, 1000 + 120_000)        // 180_000
 * lockExpiry(lock, 1000 + LOCK_TIMEOUT_MS + 1) // 0
 * lockExpiry(null)                         // 0
 */
export function lockExpiry(
  lock: DeploymentLock | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!lock) return 0;
  const t = Number.isFinite(nowMs) ? nowMs : Date.now();
  return Math.max(0, lock.expiresAt - t);
}
