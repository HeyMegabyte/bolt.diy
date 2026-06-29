/**
 * @module job_scheduler.test
 * @description Pure-function tests for parseCron, nextFire, describeCron, COMMON_SCHEDULES.
 */
import { parseCron, nextFire, describeCron, COMMON_SCHEDULES } from '../services/job_scheduler.js';

describe('job scheduler', () => {
  // ─── parseCron ──────────────────────────────────────────────────────

  describe('parseCron', () => {
    it('parses every-15-minutes wildcard expression', () => {
      const s = parseCron('*/15 * * * *');
      expect(s).not.toBeNull();
      expect(s!.minute).toEqual([0, 15, 30, 45]);
      expect(s!.hour).toHaveLength(24);
      expect(s!.dayOfMonth.length).toBeGreaterThanOrEqual(31);
      expect(s!.month).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(s!.dayOfWeek.length).toBeGreaterThanOrEqual(7);
    });

    it('parses 9am weekdays', () => {
      const s = parseCron('0 9 * * 1-5');
      expect(s).not.toBeNull();
      expect(s!.minute).toEqual([0]);
      expect(s!.hour).toEqual([9]);
      expect(s!.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    it('parses first-of-month midnight', () => {
      const s = parseCron('0 0 1 * *');
      expect(s).not.toBeNull();
      expect(s!.minute).toEqual([0]);
      expect(s!.hour).toEqual([0]);
      expect(s!.dayOfMonth).toEqual([1]);
    });

    it('parses @hourly alias', () => {
      const s = parseCron('@hourly');
      expect(s).not.toBeNull();
      expect(s!.minute).toEqual([0]);
      expect(s!.hour).toHaveLength(24);
    });

    it('parses @daily alias as midnight', () => {
      const s = parseCron('@daily');
      expect(s).not.toBeNull();
      expect(s!.minute).toEqual([0]);
      expect(s!.hour).toEqual([0]);
    });

    it('parses @weekly alias', () => {
      const s = parseCron('@weekly');
      expect(s).not.toBeNull();
      expect(s!.minute).toEqual([0]);
      expect(s!.hour).toEqual([0]);
      expect(s!.dayOfWeek).toEqual([0]);
    });

    it('parses comma-separated values', () => {
      const s = parseCron('5,10,15 0,12 * * *');
      expect(s).not.toBeNull();
      expect(s!.minute).toEqual([5, 10, 15]);
      expect(s!.hour).toEqual([0, 12]);
    });

    it('parses range with step', () => {
      const s = parseCron('0-30/10 * * * *');
      expect(s).not.toBeNull();
      expect(s!.minute).toEqual([0, 10, 20, 30]);
    });

    it('returns null for empty string', () => {
      expect(parseCron('')).toBeNull();
    });

    it('returns null for wrong field count', () => {
      expect(parseCron('* * * *')).toBeNull();
      expect(parseCron('* * * * * *')).toBeNull();
    });

    it('returns null for non-string input', () => {
      expect(parseCron(null as unknown as string)).toBeNull();
      expect(parseCron(undefined as unknown as string)).toBeNull();
    });

    it('returns null for structurally invalid segment', () => {
      // invalid range (should return null, not throw)
      expect(parseCron('* * * * abc')).toBeNull();
    });
  });

  // ─── nextFire ───────────────────────────────────────────────────────

  describe('nextFire', () => {
    it('finds next hourly fire from current time', () => {
      const s = parseCron('0 * * * *')!;
      const now = Date.now();
      const next = nextFire(s);
      expect(next).toBeGreaterThan(now);
      // Should align to the next hour boundary
      const d = new Date(next);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
    });

    it('finds next 9am weekday from Saturday', () => {
      // 2026-07-04 is a Saturday
      const saturday = Date.parse('2026-07-04T12:00:00Z');
      const next = nextFire(parseCron('0 9 * * 1-5')!, saturday);
      const d = new Date(next);
      // Next weekday is Monday 2026-07-06
      expect(d.toISOString()).toMatch(/^2026-07-06T09:00:00/);
    });

    it('finds next 9:30 weekday', () => {
      const saturday = Date.parse('2026-07-04T12:00:00Z');
      const next = nextFire(parseCron('30 9 * * 1-5')!, saturday);
      const d = new Date(next);
      expect(d.toISOString()).toMatch(/^2026-07-06T09:30:00/);
    });

    it('returns immediate next minute for every-minute schedule', () => {
      const s = parseCron('* * * * *')!;
      const from = Date.parse('2026-07-01T12:00:30Z');
      const next = nextFire(s, from);
      const d = new Date(next);
      // Should be the next minute: 12:01:00
      expect(d.getUTCMinutes()).toBe(1);
      expect(d.getSeconds()).toBe(0);
    });

    it('returns Infinity when schedule has no match in 4-year window', () => {
      // Feb 30 would never fire
      const s = parseCron('0 0 30 2 *')!;
      const result = nextFire(s, Date.parse('2026-01-01T00:00:00Z'));
      expect(result).toBe(Infinity);
    });

    it('uses Date.now() when fromMs is omitted', () => {
      const s = parseCron('* * * * *')!;
      const next = nextFire(s);
      expect(next).toBeGreaterThan(0);
    });
  });

  // ─── describeCron ───────────────────────────────────────────────────

  describe('describeCron', () => {
    it('describes every 15 minutes', () => {
      expect(describeCron('*/15 * * * *')).toMatch(/every.*15.*min/i);
    });

    it('describes 9am weekdays', () => {
      expect(describeCron('0 9 * * 1-5')).toMatch(/weekdays/i);
    });

    it('describes midnight first-of-month', () => {
      const desc = describeCron('0 0 1 * *');
      expect(desc).toMatch(/midnight|:00/i);
      expect(desc).toMatch(/day 1/);
    });

    it('describes @hourly', () => {
      expect(describeCron('@hourly')).toMatch(/hour/i);
    });

    it('describes @daily', () => {
      const desc = describeCron('@daily');
      expect(desc).toMatch(/midnight|:00/i);
      expect(desc).toMatch(/every day/);
    });

    it('returns error string for invalid expression', () => {
      expect(describeCron('invalid')).toBe('Invalid cron expression');
    });
  });

  // ─── COMMON_SCHEDULES ───────────────────────────────────────────────

  describe('COMMON_SCHEDULES', () => {
    it('has @hourly as 0 * * * *', () => {
      expect(COMMON_SCHEDULES['@hourly']).toBe('0 * * * *');
    });

    it('has @daily as 0 0 * * *', () => {
      expect(COMMON_SCHEDULES['@daily']).toBe('0 0 * * *');
    });

    it('has @weekly as 0 0 * * 0', () => {
      expect(COMMON_SCHEDULES['@weekly']).toBe('0 0 * * 0');
    });

    it('has @weekdays as 0 9 * * 1-5', () => {
      expect(COMMON_SCHEDULES['@weekdays']).toBe('0 9 * * 1-5');
    });

    it('all presets parse correctly', () => {
      for (const [key, expr] of Object.entries(COMMON_SCHEDULES)) {
        expect(parseCron(expr)).not.toBeNull();
      }
    });
  });
});
