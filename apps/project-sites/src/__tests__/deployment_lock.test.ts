import {
  acquireLock,
  isLocked,
  releaseLock,
  lockExpiry,
  LOCK_TIMEOUT_MS,
} from '../services/deployment_lock.js';

const NOW = 1_000_000_000;
const SITE_A = 'site-abc';
const USER_X = 'user-42';

describe('acquireLock', () => {
  it('creates a lock with the correct site and user', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(l.siteId).toBe(SITE_A);
    expect(l.lockedBy).toBe(USER_X);
  });

  it('sets lockedAt to the given nowMs', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(l.lockedAt).toBe(NOW);
  });

  it('computes expiresAt as lockedAt + LOCK_TIMEOUT_MS', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(l.expiresAt).toBe(NOW + LOCK_TIMEOUT_MS);
  });

  it('defaults nowMs to Date.now() when omitted', () => {
    const before = Date.now();
    const l = acquireLock(SITE_A, USER_X);
    const after = Date.now();
    expect(l.lockedAt).toBeGreaterThanOrEqual(before);
    expect(l.lockedAt).toBeLessThanOrEqual(after);
  });

  it('falls back to Date.now() when nowMs is non-finite', () => {
    const before = Date.now();
    const l = acquireLock(SITE_A, USER_X, NaN);
    const after = Date.now();
    expect(l.lockedAt).toBeGreaterThanOrEqual(before);
    expect(l.lockedAt).toBeLessThanOrEqual(after);
  });
});

describe('isLocked', () => {
  it('returns true while the lock is still active', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(isLocked(l, NOW)).toBe(true);
  });

  it('returns true mid-window', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(isLocked(l, NOW + 60_000)).toBe(true);
  });

  it('returns false just past expiry', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(isLocked(l, NOW + LOCK_TIMEOUT_MS + 1)).toBe(false);
  });

  it('returns false exactly at the expiry instant (strict >)', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(isLocked(l, NOW + LOCK_TIMEOUT_MS)).toBe(false);
  });

  it('returns false for a null/undefined lock', () => {
    expect(isLocked(null, NOW)).toBe(false);
    expect(isLocked(undefined, NOW)).toBe(false);
  });

  it('defaults nowMs to Date.now() when omitted', () => {
    const l = acquireLock(SITE_A, USER_X, Date.now());
    expect(isLocked(l)).toBe(true);
  });

  it('handles non-finite nowMs by falling back to Date.now()', () => {
    const l = acquireLock(SITE_A, USER_X, Date.now());
    expect(isLocked(l, NaN)).toBe(true); // falls back to Date.now() which is ≤ lockedAt + 5min
  });
});

describe('releaseLock', () => {
  it('always returns null', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(releaseLock(l)).toBeNull();
  });

  it('is idempotent on null/undefined', () => {
    expect(releaseLock(null)).toBeNull();
    expect(releaseLock(undefined)).toBeNull();
  });

  it('works as an assignment-return for lock = releaseLock(lock)', () => {
    let lock: ReturnType<typeof acquireLock> | null = acquireLock(SITE_A, USER_X, NOW);
    expect(isLocked(lock, NOW)).toBe(true);
    lock = releaseLock(lock);
    expect(lock).toBeNull();
    expect(isLocked(lock, NOW)).toBe(false);
  });
});

describe('lockExpiry', () => {
  it('returns the full timeout right after acquire', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(lockExpiry(l, NOW)).toBe(LOCK_TIMEOUT_MS);
  });

  it('returns remaining ms mid-window', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    const elapsed = 120_000;
    expect(lockExpiry(l, NOW + elapsed)).toBe(LOCK_TIMEOUT_MS - elapsed);
  });

  it('returns 0 when expired', () => {
    const l = acquireLock(SITE_A, USER_X, NOW);
    expect(lockExpiry(l, NOW + LOCK_TIMEOUT_MS + 1)).toBe(0);
  });

  it('returns 0 for null/undefined lock', () => {
    expect(lockExpiry(null, NOW)).toBe(0);
    expect(lockExpiry(undefined, NOW)).toBe(0);
  });

  it('defaults nowMs gracefully', () => {
    const l = acquireLock(SITE_A, USER_X, Date.now() - 10_000);
    const remaining = lockExpiry(l);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(LOCK_TIMEOUT_MS);
  });

  it('handles non-finite nowMs by falling back to Date.now()', () => {
    const l = acquireLock(SITE_A, USER_X, Date.now());
    expect(lockExpiry(l, NaN)).toBeGreaterThan(0); // falls back to Date.now() which is ≤ lockedAt + 5min
  });
});
