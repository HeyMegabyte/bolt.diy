import {
  acquire,
  isLocked,
  release,
  LOCK_TIMEOUT_MS,
  type ContentLock,
} from '../services/content_lock.js';

const SITE = 'site_abc';
const PAGE = '/about';
const USER_A = 'user_a';
const USER_B = 'user_b';

// Fixed "now" timestamps for deterministic testing
const T0 = 1_000_000_000_000; // some fixed epoch ms
const T_MID = T0 + LOCK_TIMEOUT_MS / 2; // halfway into lock
const T_EXPIRED = T0 + LOCK_TIMEOUT_MS + 1; // just past expiry

describe('content_lock', () => {
  describe('acquire', () => {
    it('creates a fresh lock with the given params', () => {
      const lock = acquire(SITE, PAGE, USER_A, T0);
      expect(lock.siteId).toBe(SITE);
      expect(lock.page).toBe(PAGE);
      expect(lock.userId).toBe(USER_A);
      expect(lock.acquiredAt).toBe(T0);
      expect(lock.expiresAt).toBe(T0 + LOCK_TIMEOUT_MS);
    });

    it('uses Date.now() when nowMs is omitted', () => {
      const before = Date.now();
      const lock = acquire(SITE, PAGE, USER_A);
      const after = Date.now();
      expect(lock.acquiredAt).toBeGreaterThanOrEqual(before);
      expect(lock.acquiredAt).toBeLessThanOrEqual(after);
      expect(lock.expiresAt - lock.acquiredAt).toBe(LOCK_TIMEOUT_MS);
    });

    it('coerces missing siteId/page/userId to empty strings', () => {
      const lock = acquire(
        undefined as unknown as string,
        undefined as unknown as string,
        undefined as unknown as string,
        T0,
      );
      expect(lock.siteId).toBe('');
      expect(lock.page).toBe('');
      expect(lock.userId).toBe('');
    });
  });

  describe('isLocked', () => {
    it('reports unlocked when lock is null', () => {
      const s = isLocked(null, T0);
      expect(s.locked).toBe(false);
      expect(s.byCurrentUser).toBe(false);
      expect(s.currentUserId).toBeNull();
    });

    it('reports unlocked when lock is undefined', () => {
      const s = isLocked(undefined as unknown as ContentLock | null, T0);
      expect(s.locked).toBe(false);
      expect(s.currentUserId).toBeNull();
    });

    it('reports locked when inside the timeout window', () => {
      const lock = acquire(SITE, PAGE, USER_A, T0);
      const s = isLocked(lock, T_MID);
      expect(s.locked).toBe(true);
      expect(s.byCurrentUser).toBe(true);
      expect(s.currentUserId).toBe(USER_A);
    });

    it('reports expired when past the timeout', () => {
      const lock = acquire(SITE, PAGE, USER_A, T0);
      const s = isLocked(lock, T_EXPIRED);
      expect(s.locked).toBe(false);
      expect(s.byCurrentUser).toBe(false);
      expect(s.currentUserId).toBe(USER_A);
    });

    it('uses Date.now() when nowMs is omitted', () => {
      const lock = acquire(SITE, PAGE, USER_A, T0);
      const s = isLocked(lock);
      // By the time this runs, T0 is well-past expired
      expect(s.locked).toBe(false);
    });
  });

  describe('release', () => {
    it('returns null always', () => {
      const lock = acquire(SITE, PAGE, USER_A, T0);
      expect(release(lock, USER_A)).toBeNull();
      expect(release(null, USER_A)).toBeNull();
      expect(release(lock, USER_B)).toBeNull();
    });
  });

  describe('LOCK_TIMEOUT_MS', () => {
    it('is 2 minutes (120_000 ms)', () => {
      expect(LOCK_TIMEOUT_MS).toBe(120_000);
    });
  });
});
