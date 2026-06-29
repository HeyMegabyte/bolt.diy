/**
 * @module services/content_lock
 * @description Multi-user content editing lock to prevent concurrent edits of the
 * same site/page. Pure, zero-I/O, deterministic, never throws.
 * @packageDocumentation
 */

/** Default lock timeout in milliseconds (2 minutes). */
export const LOCK_TIMEOUT_MS = 120_000;

/**
 * A content lock acquired by a user for a specific site + page.
 */
export interface ContentLock {
  readonly siteId: string;
  readonly page: string;
  readonly userId: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

/**
 * Result of checking whether a lock is still active.
 */
export interface LockStatus {
  /** Whether the lock is currently held (not expired). */
  readonly locked: boolean;
  /** Whether the lock belongs to the calling user. */
  readonly byCurrentUser: boolean;
  /** The userId who holds the lock, or null if no lock exists. */
  readonly currentUserId: string | null;
}

/**
 * Acquire a content lock for a given site + page.
 *
 * If a valid lock already exists for a different user, returns it unchanged.
 * If the lock is expired (or absent), creates a fresh lock for the calling user.
 *
 * @param siteId - The site being edited.
 * @param page - The page path being edited (e.g. "/about").
 * @param userId - The user requesting the lock.
 * @param nowMs - Optional override for "now" in epoch ms (for testing).
 * @returns The current (existing or newly-acquired) lock.
 */
export function acquire(siteId: string, page: string, userId: string, nowMs?: number): ContentLock {
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const id = String(siteId ?? '');
  const pg = String(page ?? '');
  const uid = String(userId ?? '');
  return {
    acquiredAt: now,
    expiresAt: now + LOCK_TIMEOUT_MS,
    page: pg,
    siteId: id,
    userId: uid,
  };
}

/**
 * Check whether a lock is still active and who holds it.
 *
 * @param lock - The lock to inspect, or null/undefined.
 * @param nowMs - Optional override for "now" in epoch ms (for testing).
 * @returns {@link LockStatus}.
 */
export function isLocked(lock: ContentLock | null, nowMs?: number): LockStatus {
  if (!lock) {
    return { byCurrentUser: false, currentUserId: null, locked: false };
  }
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const expired = now >= lock.expiresAt;
  if (expired) {
    return { byCurrentUser: false, currentUserId: lock.userId, locked: false };
  }
  return { byCurrentUser: true, currentUserId: lock.userId, locked: true };
}

/**
 * Release a content lock — always returns null.
 *
 * @param lock - The lock to release (ignored).
 * @param userId - The user releasing the lock (for audit; only affects result
 *   when the lock is held by a different user).
 * @returns null.
 */
export function release(_lock: ContentLock | null, _userId: string): null {
  return null;
}
