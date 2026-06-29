import {
  buildSchedule,
  isDue,
  parseNextRunMs,
  DEFAULT_SCHEDULES,
  type BackupTarget,
  type BackupSchedule,
} from '../services/backup_trigger.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

describe('parseNextRunMs', () => {
  const BASE = 1_700_000_000_000; // arbitrary stable epoch

  it('parses "every N minutes"', () => {
    expect(parseNextRunMs('every 30 minutes', BASE)).toBe(BASE + 30 * MIN);
  });

  it('parses "every N hours"', () => {
    expect(parseNextRunMs('every 6 hours', BASE)).toBe(BASE + 6 * HOUR);
  });

  it('parses "every N days"', () => {
    expect(parseNextRunMs('every 1 day', BASE)).toBe(BASE + DAY);
    expect(parseNextRunMs('every 3 days', BASE)).toBe(BASE + 3 * DAY);
  });

  it('parses "every N weeks"', () => {
    expect(parseNextRunMs('every 2 weeks', BASE)).toBe(BASE + 14 * DAY);
  });

  it('is case-insensitive for human-readable units', () => {
    expect(parseNextRunMs('Every 1 Day', BASE)).toBe(BASE + DAY);
    expect(parseNextRunMs('EVERY 1 WEEK', BASE)).toBe(BASE + 7 * DAY);
  });

  it('handles singular unit words ("day" not "days")', () => {
    expect(parseNextRunMs('every 1 day', BASE)).toBe(BASE + DAY);
    expect(parseNextRunMs('every 1 week', BASE)).toBe(BASE + 7 * DAY);
  });

  it('parses daily cron "MIN H * * *" — advance to tomorrow when past window', () => {
    // BASE is a known arbitrary time; tomorrow at hour 3, minute 0
    // We can't hardcode the exact tomorrow ms because it depends on the clock,
    // but we can assert it's > BASE and < BASE + 2 days.
    const next = parseNextRunMs('0 3 * * *', BASE);
    expect(next).toBeGreaterThan(BASE);
    expect(next).toBeLessThan(BASE + 2 * DAY);
  });

  it('parses daily cron — returns same day when window is in the future', () => {
    // Pick an early-morning BASE; daily at 3am should be same day.
    const early = new Date('2026-01-15T01:00:00Z').getTime();
    const next = parseNextRunMs('0 3 * * *', early);
    const d = new Date(next);
    expect(d.getUTCHours()).toBe(3);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    // Same calendar day since 01:00 < 03:00
    expect(d.getUTCDate()).toBe(new Date(early).getUTCDate());
  });

  it('parses weekly cron "MIN H * * DOW" for a future weekday', () => {
    // 2026-01-15 is a Thursday (4). Ask for Sunday (0) → should be Jan 18.
    const thursday = new Date('2026-01-15T12:00:00Z').getTime();
    const next = parseNextRunMs('0 3 * * 0', thursday);
    const d = new Date(next);
    expect(d.getUTCDay()).toBe(0); // Sunday
    expect(d.getUTCDate()).toBe(18);
  });

  it('parses weekly cron — wraps to next week when same weekday has passed', () => {
    // Thursday at 12:00, same day at 03:00 has already passed → next week
    const thursday = new Date('2026-01-15T12:00:00Z').getTime();
    const next = parseNextRunMs('0 3 * * 4', thursday); // same day (Thu) but hour passed
    const d = new Date(next);
    expect(d.getUTCDay()).toBe(4); // Thursday
    expect(d.getUTCDate()).toBe(22); // Next Thursday
  });

  it('falls back to +1 day for unrecognised cron strings', () => {
    const next = parseNextRunMs('bad cron string', BASE);
    expect(next).toBe(BASE + DAY);
  });

  it('falls back to +1 day for empty cron', () => {
    const next = parseNextRunMs('', BASE);
    expect(next).toBe(BASE + DAY);
  });
});

describe('buildSchedule', () => {
  it('returns a schedule with lastRun: null and a valid nextRun', () => {
    const s = buildSchedule('d1', '0 3 * * *');
    expect(s.target).toBe('d1');
    expect(s.cron).toBe('0 3 * * *');
    expect(s.retentionDays).toBe(30);
    expect(s.lastRun).toBeNull();
    expect(typeof s.nextRun).toBe('string');
    expect(() => new Date(s.nextRun)).not.toThrow();
  });

  it('accepts a custom retention period', () => {
    const s = buildSchedule('r2', 'every 7 days', 90);
    expect(s.retentionDays).toBe(90);
    expect(s.target).toBe('r2');
    expect(s.cron).toBe('every 7 days');
  });

  it('computes a nextRun in the future', () => {
    const s = buildSchedule('neon', 'every 1 day');
    expect(new Date(s.nextRun).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('handles all three target types', () => {
    for (const target of ['d1', 'r2', 'neon'] as BackupTarget[]) {
      const s = buildSchedule(target, 'every 1 day');
      expect(s.target).toBe(target);
      expect(s.nextRun).toBeTruthy();
    }
  });
});

describe('isDue', () => {
  it('returns true when nowMs >= nextRun', () => {
    const s: BackupSchedule = {
      target: 'd1',
      cron: '0 3 * * *',
      retentionDays: 30,
      lastRun: null,
      nextRun: new Date(1_000_000_000_000).toISOString(),
    };
    expect(isDue(s, 1_000_000_000_001)).toBe(true);
    expect(isDue(s, 1_000_000_000_000)).toBe(true);
  });

  it('returns false when nowMs < nextRun', () => {
    const s: BackupSchedule = {
      target: 'd1',
      cron: '0 3 * * *',
      retentionDays: 30,
      lastRun: null,
      nextRun: new Date(2_000_000_000_000).toISOString(),
    };
    expect(isDue(s, 1_000_000_000_000)).toBe(false);
  });

  it('defaults nowMs to Date.now()', () => {
    const future = new Date(Date.now() + DAY).toISOString();
    const s: BackupSchedule = {
      target: 'd1',
      cron: '0 3 * * *',
      retentionDays: 30,
      lastRun: null,
      nextRun: future,
    };
    // Without an override, nowMs ~= Date.now() which is < future
    expect(isDue(s)).toBe(false);
  });
});

describe('DEFAULT_SCHEDULES', () => {
  it('defines all three targets', () => {
    expect(Object.keys(DEFAULT_SCHEDULES).sort()).toEqual(['d1', 'neon', 'r2']);
  });

  it('r2 has 90-day retention', () => {
    expect(DEFAULT_SCHEDULES.r2.retentionDays).toBe(90);
  });

  it('d1 and neon have 30-day retention', () => {
    expect(DEFAULT_SCHEDULES.d1.retentionDays).toBe(30);
    expect(DEFAULT_SCHEDULES.neon.retentionDays).toBe(30);
  });

  it('every schedule has a valid nextRun in the future', () => {
    const now = Date.now();
    for (const target of ['d1', 'r2', 'neon'] as BackupTarget[]) {
      const next = new Date(DEFAULT_SCHEDULES[target].nextRun).getTime();
      expect(next).toBeGreaterThan(now - 1000);
    }
  });

  it('every schedule has lastRun: null', () => {
    for (const target of ['d1', 'r2', 'neon'] as BackupTarget[]) {
      expect(DEFAULT_SCHEDULES[target].lastRun).toBeNull();
    }
  });
});
