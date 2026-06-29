import {
  buildPolicy,
  isExpired,
  DEFAULT_RETENTION,
  type LogType,
  type RetentionPolicy,
} from '../services/log_retention.js';

describe('log_retention', () => {
  // ---------------------------------------------------------------------------
  // DEFAULT_RETENTION
  // ---------------------------------------------------------------------------
  describe('DEFAULT_RETENTION', () => {
    it('covers all five log types', () => {
      const types: LogType[] = ['audit', 'analytics', 'webhook', 'error', 'access'];
      for (const t of types) {
        expect(DEFAULT_RETENTION[t]).toBeDefined();
        expect(DEFAULT_RETENTION[t].logType).toBe(t);
      }
    });

    it('every policy has retainDays ≥ 1', () => {
      for (const p of Object.values(DEFAULT_RETENTION)) {
        expect(p.retainDays).toBeGreaterThanOrEqual(1);
      }
    });

    it('audit retains the longest', () => {
      const days = Object.values(DEFAULT_RETENTION).map((p) => p.retainDays);
      const auditIdx = days.indexOf(365);
      expect(auditIdx).not.toBe(-1);
      expect(Math.max(...days)).toBe(365);
    });

    it('webhook and access retain the shortest (30d)', () => {
      expect(DEFAULT_RETENTION.webhook.retainDays).toBe(30);
      expect(DEFAULT_RETENTION.access.retainDays).toBe(30);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(DEFAULT_RETENTION)).toBe(true);
    });

    it('every child policy is also frozen', () => {
      for (const p of Object.values(DEFAULT_RETENTION)) {
        expect(Object.isFrozen(p)).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // buildPolicy
  // ---------------------------------------------------------------------------
  describe('buildPolicy', () => {
    it('creates a policy with the given log type and retainDays', () => {
      const p = buildPolicy('error', 90);
      expect(p.logType).toBe('error');
      expect(p.retainDays).toBe(90);
      expect(p.archiveAfterDays).toBeNull();
    });

    it('accepts archiveAfterDays as the third argument', () => {
      const p = buildPolicy('audit', 365, 730);
      expect(p.archiveAfterDays).toBe(730);
    });

    it('accepts null archiveAfterDays explicitly', () => {
      const p = buildPolicy('access', 30, null);
      expect(p.archiveAfterDays).toBeNull();
    });

    it('returns a frozen object', () => {
      const p = buildPolicy('webhook', 14);
      expect(Object.isFrozen(p)).toBe(true);
    });

    it('throws RangeError when retainDays < 1', () => {
      expect(() => buildPolicy('audit', 0)).toThrow(RangeError);
      expect(() => buildPolicy('audit', -5)).toThrow(RangeError);
    });

    it('throws RangeError when retainDays is not an integer', () => {
      expect(() => buildPolicy('audit', 1.5)).toThrow(RangeError);
    });

    it('throws RangeError when archiveAfterDays < retainDays', () => {
      expect(() => buildPolicy('audit', 365, 100)).toThrow(RangeError);
    });

    it('throws RangeError when archiveAfterDays equals retainDays (must be >)', () => {
      expect(() => buildPolicy('audit', 30, 30)).toThrow(RangeError);
    });

    it('accepts archiveAfterDays > retainDays', () => {
      const p = buildPolicy('analytics', 90, 180);
      expect(p.archiveAfterDays).toBe(180);
    });
  });

  // ---------------------------------------------------------------------------
  // isExpired
  // ---------------------------------------------------------------------------
  describe('isExpired', () => {
    const now = new Date('2026-06-29T12:00:00Z').getTime();
    const day30: RetentionPolicy = buildPolicy('access', 30, null);

    it('returns true when log is older than retainDays', () => {
      expect(isExpired(day30, '2026-05-01', now)).toBe(true);
    });

    it('returns false when log is within the retention window', () => {
      expect(isExpired(day30, '2026-06-15', now)).toBe(false);
    });

    it('returns false for today', () => {
      expect(isExpired(day30, '2026-06-29', now)).toBe(false);
    });

    it('uses Date.now() when nowMs is omitted', () => {
      const recent = new Date().toISOString().slice(0, 10);
      const p = buildPolicy('webhook', 3650); // 10 year default
      expect(isExpired(p, recent)).toBe(false);
    });

    it('treats an unparseable date as expired', () => {
      expect(isExpired(day30, 'not-a-date', now)).toBe(true);
    });

    it('returns true on boundary (±1ms past the window)', () => {
      // 30 days * 86400000 = 2_592_000_000 ms
      // Date '2026-05-30' exactly 30 days before now:
      // now - dateMs = 2_592_000_000 → NOT > retainDays*MS_PER_DAY → false
      // So 1ms more → expired
      const boundaryMs = now - 30 * 86_400_000 - 1;
      const boundaryDate = new Date(boundaryMs).toISOString();
      expect(isExpired(day30, boundaryDate, now)).toBe(true);
    });

    it('returns false on exact retention boundary', () => {
      // Exactly 30 days ago: elapsed === 30*MS_PER_DAY → not > → false
      const boundaryMs = now - 30 * 86_400_000;
      const boundaryDate = new Date(boundaryMs).toISOString();
      expect(isExpired(day30, boundaryDate, now)).toBe(false);
    });

    it('works with DEFAULT_RETENTION values', () => {
      // Access log from 60 days ago, 30-day default policy
      expect(isExpired(DEFAULT_RETENTION.access, '2026-04-29', now)).toBe(true);
      // Audit log from 60 days ago, 365-day policy
      expect(isExpired(DEFAULT_RETENTION.audit, '2026-04-29', now)).toBe(false);
    });
  });
});
