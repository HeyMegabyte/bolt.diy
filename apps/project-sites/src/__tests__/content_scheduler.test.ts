/**
 * @module __tests__/content_scheduler.test
 *
 * Pure zero-I/O tests for the content scheduling engine. Covers every
 * recurrence type, edge case, and boundary condition documented in
 * {@link services/content_scheduler}.
 *
 * Red-Green-Refactor: written as failing expectations first.
 */

import {
  type ContentType,
  type Recurrence,
  type ScheduleConfig,
  generateSlots,
  nextDayOfWeek,
  isWithinWindow,
  AUTO_SCHEDULABLE,
} from '../services/content_scheduler.js';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

/** Build a minimal config with sensible defaults. */
function cfg(
  overrides: Partial<ScheduleConfig> & { recurrence: Recurrence; contentType: ContentType },
): ScheduleConfig {
  return {
    contentType: overrides.contentType,
    recurrence: overrides.recurrence,
    startDate: overrides.startDate,
    preferredDayOfWeek: overrides.preferredDayOfWeek,
    preferredDayOfMonth: overrides.preferredDayOfMonth,
    preferredHour: overrides.preferredHour,
    endDate: overrides.endDate,
    timezone: overrides.timezone,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('AUTO_SCHEDULABLE', () => {
  it('includes social and email but not blog or page', () => {
    expect(AUTO_SCHEDULABLE).toEqual(['social', 'email']);
  });

  it('is readonly at the type level — compile-time protection', () => {
    // `as const` gives TypeScript-level readonly (compile-time).
    // Runtime is a plain array, but TS blocks `.push()` or index assignment.
    expect(AUTO_SCHEDULABLE).toEqual(['social', 'email']);
  });
});

// ---------------------------------------------------------------------------
// nextDayOfWeek
// ---------------------------------------------------------------------------

describe('nextDayOfWeek', () => {
  it('returns the same day when today is the target day', () => {
    // 2026-06-29 is Monday (1)
    const result = nextDayOfWeek(new Date(2026, 5, 29), 1);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(5);
    expect(result.getDate()).toBe(29);
  });

  it('finds the next Monday from a Wednesday', () => {
    // 2026-07-01 is Wednesday (3), next Monday is July 6
    const result = nextDayOfWeek(new Date(2026, 6, 1), 1);
    expect(result.getDate()).toBe(6);
    expect(result.getDay()).toBe(1);
  });

  it('finds the next Saturday from a Friday', () => {
    // 2026-07-03 is Friday (5), next Saturday is July 4
    const result = nextDayOfWeek(new Date(2026, 6, 3), 6);
    expect(result.getDate()).toBe(4);
    expect(result.getDay()).toBe(6);
  });

  it('wraps around the weekend: Friday to Monday', () => {
    // 2026-07-03 is Friday (5), next Monday is July 6
    const result = nextDayOfWeek(new Date(2026, 6, 3), 1);
    expect(result.getDate()).toBe(6);
    expect(result.getDay()).toBe(1);
  });

  it('wraps around the week boundary: Sunday to Monday', () => {
    // 2026-06-28 is Sunday (0), next Monday is June 29
    const result = nextDayOfWeek(new Date(2026, 5, 28), 1);
    expect(result.getDate()).toBe(29);
    expect(result.getDay()).toBe(1);
  });

  it('handles year-end transition', () => {
    // 2026-12-31 is Thursday (4), next Monday is 2027-01-04
    const result = nextDayOfWeek(new Date(2026, 11, 31), 1);
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(4);
  });

  it('returns same-date copy when target matches current day', () => {
    const d = new Date(2026, 5, 29); // Monday
    const result = nextDayOfWeek(d, 1);
    expect(result.getTime()).toBe(d.getTime());
    expect(result).not.toBe(d); // different reference
  });

  it('returns a copy of the input date when targetDay is out of range (negative)', () => {
    const d = new Date(2026, 5, 29);
    const result = nextDayOfWeek(d, -1);
    expect(result.getTime()).toBe(d.getTime());
  });

  it('returns a copy of the input date when targetDay is out of range (>6)', () => {
    const d = new Date(2026, 5, 29);
    const result = nextDayOfWeek(d, 7);
    expect(result.getTime()).toBe(d.getTime());
  });
});

// ---------------------------------------------------------------------------
// isWithinWindow
// ---------------------------------------------------------------------------

describe('isWithinWindow', () => {
  const config: ScheduleConfig = {
    contentType: 'blog',
    recurrence: 'daily',
    startDate: '2026-07-01',
    endDate: '2026-07-15',
  };

  it('returns true for a date on the start boundary', () => {
    expect(isWithinWindow(new Date(2026, 6, 1), config)).toBe(true);
  });

  it('returns true for a date on the end boundary', () => {
    expect(isWithinWindow(new Date(2026, 6, 15), config)).toBe(true);
  });

  it('returns true for a date in the middle of the window', () => {
    expect(isWithinWindow(new Date(2026, 6, 7), config)).toBe(true);
  });

  it('returns false for a date before the window', () => {
    expect(isWithinWindow(new Date(2026, 5, 30), config)).toBe(false);
  });

  it('returns false for a date after the window', () => {
    expect(isWithinWindow(new Date(2026, 6, 16), config)).toBe(false);
  });

  it('treats null endDate as indefinite (always within after start)', () => {
    const noEnd: ScheduleConfig = {
      contentType: 'blog',
      recurrence: 'daily',
      startDate: '2026-06-01',
    };
    expect(isWithinWindow(new Date(2026, 11, 31), noEnd)).toBe(true);
  });

  it('returns false for dates before startDate with no endDate', () => {
    const noEnd: ScheduleConfig = {
      contentType: 'blog',
      recurrence: 'daily',
      startDate: '2026-07-01',
    };
    expect(isWithinWindow(new Date(2026, 5, 30), noEnd)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateSlots — once
// ---------------------------------------------------------------------------

describe('generateSlots (once)', () => {
  it('returns a single slot on the start date', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'once', startDate: '2026-07-04' }),
      5,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].date).toBe('2026-07-04');
    expect(slots[0].contentType).toBe('blog');
  });

  it('returns an empty array when the start date is after endDate', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'page',
        recurrence: 'once',
        startDate: '2026-07-20',
        endDate: '2026-07-15',
      }),
      1,
    );
    expect(slots).toHaveLength(0);
  });

  it('ignores count and always returns at most 1 slot', () => {
    const slots = generateSlots(
      cfg({ contentType: 'email', recurrence: 'once', startDate: '2026-07-01' }),
      100,
    );
    expect(slots).toHaveLength(1);
  });

  it('uses default hour 10 when preferredHour is not set', () => {
    const slots = generateSlots(
      cfg({ contentType: 'social', recurrence: 'once', startDate: '2026-07-04' }),
      1,
    );
    expect(slots[0].iso).toContain('T10:00:00.000Z');
  });

  it('uses the specified preferredHour', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'once', startDate: '2026-07-04', preferredHour: 14 }),
      1,
    );
    expect(slots[0].iso).toContain('T14:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// generateSlots — daily
// ---------------------------------------------------------------------------

describe('generateSlots (daily)', () => {
  it('generates N consecutive daily slots from startDate', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'daily', startDate: '2026-07-01' }),
      3,
    );
    expect(slots).toHaveLength(3);
    expect(slots[0].date).toBe('2026-07-01');
    expect(slots[1].date).toBe('2026-07-02');
    expect(slots[2].date).toBe('2026-07-03');
  });

  it('stops when it hits endDate', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'email',
        recurrence: 'daily',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
      }),
      10,
    );
    expect(slots).toHaveLength(3);
    expect(slots[0].date).toBe('2026-07-01');
    expect(slots[2].date).toBe('2026-07-03');
  });

  it('correctly sets content type on every slot', () => {
    const slots = generateSlots(
      cfg({ contentType: 'page', recurrence: 'daily', startDate: '2026-07-01' }),
      2,
    );
    expect(slots.every((s) => s.contentType === 'page')).toBe(true);
  });

  it('sets dayOfWeek correctly', () => {
    // 2026-07-01 is Wednesday (3)
    const slots = generateSlots(
      cfg({ contentType: 'social', recurrence: 'daily', startDate: '2026-07-01' }),
      7,
    );
    expect(slots[0].dayOfWeek).toBe(3); // Wed
    expect(slots[3].dayOfWeek).toBe(6); // Sat
    expect(slots[6].dayOfWeek).toBe(2); // Tue
  });

  it('handles month boundary', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'daily', startDate: '2026-07-30' }),
      4,
    );
    expect(slots).toHaveLength(4);
    expect(slots[0].date).toBe('2026-07-30');
    expect(slots[1].date).toBe('2026-07-31');
    expect(slots[2].date).toBe('2026-08-01');
    expect(slots[3].date).toBe('2026-08-02');
  });

  it('handles year boundary', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'daily', startDate: '2026-12-30' }),
      3,
    );
    expect(slots).toHaveLength(3);
    expect(slots[0].date).toBe('2026-12-30');
    expect(slots[1].date).toBe('2026-12-31');
    expect(slots[2].date).toBe('2027-01-01');
  });

  it('returns empty for count < 1', () => {
    expect(
      generateSlots(cfg({ contentType: 'blog', recurrence: 'daily', startDate: '2026-07-01' }), 0),
    ).toHaveLength(0);
    expect(
      generateSlots(cfg({ contentType: 'blog', recurrence: 'daily', startDate: '2026-07-01' }), -1),
    ).toHaveLength(0);
  });

  it('returns empty for count that is NaN after flooring', () => {
    // Passing NaN-like number gets floored to 0
    expect(
      generateSlots(
        cfg({ contentType: 'blog', recurrence: 'daily', startDate: '2026-07-01' }),
        0.4,
      ),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateSlots — weekly
// ---------------------------------------------------------------------------

describe('generateSlots (weekly)', () => {
  it('starts on the next preferred day-of-week from startDate', () => {
    // 2026-07-01 is Wednesday (3), preferred Monday (1) → July 6
    const slots = generateSlots(
      cfg({
        contentType: 'blog',
        recurrence: 'weekly',
        startDate: '2026-07-01',
        preferredDayOfWeek: 1,
      }),
      1,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].date).toBe('2026-07-06');
    expect(slots[0].dayOfWeek).toBe(1);
  });

  it('generates weekly slots at +7d intervals', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'social',
        recurrence: 'weekly',
        startDate: '2026-07-01',
        preferredDayOfWeek: 1,
      }),
      3,
    );
    expect(slots).toHaveLength(3);
    expect(slots[0].date).toBe('2026-07-06');
    expect(slots[1].date).toBe('2026-07-13');
    expect(slots[2].date).toBe('2026-07-20');
  });

  it('uses startDate day-of-week when preferredDayOfWeek is not set', () => {
    // 2026-07-01 is Wednesday (3) → first slot on July 1, then +7
    const slots = generateSlots(
      cfg({ contentType: 'email', recurrence: 'weekly', startDate: '2026-07-01' }),
      2,
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].dayOfWeek).toBe(3); // Wed
    expect(slots[1].dayOfWeek).toBe(3);
  });

  it('stops at endDate', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'blog',
        recurrence: 'weekly',
        startDate: '2026-07-01',
        preferredDayOfWeek: 1,
        endDate: '2026-07-15',
      }),
      5,
    );
    // July 6, 13 both within window; July 20 is after
    expect(slots).toHaveLength(2);
  });

  it('handles year-end weekly wrap', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'blog',
        recurrence: 'weekly',
        startDate: '2026-12-28',
        preferredDayOfWeek: 1,
      }),
      2,
    );
    // Dec 28 (Mon), Jan 4 (Mon)
    expect(slots[0].date).toBe('2026-12-28');
    expect(slots[0].dayOfWeek).toBe(1);
    expect(slots[1].date).toBe('2027-01-04');
    expect(slots[1].dayOfWeek).toBe(1);
  });

  it('returns empty when startDate is after endDate', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'blog',
        recurrence: 'weekly',
        startDate: '2026-08-01',
        preferredDayOfWeek: 1,
        endDate: '2026-07-15',
      }),
      3,
    );
    expect(slots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateSlots — monthly
// ---------------------------------------------------------------------------

describe('generateSlots (monthly)', () => {
  it('uses preferredDayOfMonth when set within 1-28', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'blog',
        recurrence: 'monthly',
        startDate: '2026-07-01',
        preferredDayOfMonth: 15,
      }),
      1,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].date).toBe('2026-07-15');
  });

  it('caps preferredDayOfMonth at 28 for safety', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'page',
        recurrence: 'monthly',
        startDate: '2026-07-01',
        preferredDayOfMonth: 31,
      }),
      3,
    );
    // 28th of July, August, September
    expect(slots).toHaveLength(3);
    expect(slots[0].date).toBe('2026-07-28');
    expect(slots[1].date).toBe('2026-08-28');
    expect(slots[2].date).toBe('2026-09-28');
  });

  it('falls back to startDate day when preferredDayOfMonth is not set', () => {
    const slots = generateSlots(
      cfg({ contentType: 'email', recurrence: 'monthly', startDate: '2026-07-15' }),
      2,
    );
    expect(slots[0].date).toBe('2026-07-15');
    expect(slots[1].date).toBe('2026-08-15');
  });

  it('generates monthly slots on the correct day each month', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'monthly', startDate: '2026-01-15' }),
      12,
    );
    expect(slots).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      expect(slots[i].date).toMatch(/^\d{4}-\d{2}-15$/);
    }
  });

  it('handles year-end transition across December to January', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'blog',
        recurrence: 'monthly',
        startDate: '2026-12-01',
        preferredDayOfMonth: 10,
      }),
      2,
    );
    expect(slots[0].date).toBe('2026-12-10');
    expect(slots[1].date).toBe('2027-01-10');
  });

  it('stops at endDate', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'social',
        recurrence: 'monthly',
        startDate: '2026-07-01',
        preferredDayOfMonth: 10,
        endDate: '2026-08-15',
      }),
      12,
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].date).toBe('2026-07-10');
    expect(slots[1].date).toBe('2026-08-10');
  });

  it('returns empty when startDate is after endDate', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'blog',
        recurrence: 'monthly',
        startDate: '2026-09-01',
        endDate: '2026-07-15',
      }),
      3,
    );
    expect(slots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateSlots — edge cases (cross-cutting)
// ---------------------------------------------------------------------------

describe('generateSlots — edge cases', () => {
  it('returns empty array for count=0 regardless of recurrence', () => {
    for (const rec of ['once', 'daily', 'weekly', 'monthly'] as const) {
      expect(
        generateSlots(cfg({ contentType: 'blog', recurrence: rec, startDate: '2026-07-01' }), 0),
      ).toHaveLength(0);
    }
  });

  it('returns empty array for negative count', () => {
    expect(
      generateSlots(cfg({ contentType: 'blog', recurrence: 'daily', startDate: '2026-07-01' }), -5),
    ).toHaveLength(0);
  });

  it('handles preferredHour=0 correctly (midnight)', () => {
    const slot = generateSlots(
      cfg({ contentType: 'social', recurrence: 'once', startDate: '2026-07-04', preferredHour: 0 }),
      1,
    );
    expect(slot[0].iso).toContain('T00:00:00.000Z');
  });

  it('handles preferredHour=23 correctly (11pm)', () => {
    const slot = generateSlots(
      cfg({
        contentType: 'social',
        recurrence: 'once',
        startDate: '2026-07-04',
        preferredHour: 23,
      }),
      1,
    );
    expect(slot[0].iso).toContain('T23:00:00.000Z');
  });

  it('accepts all four content types', () => {
    for (const ct of ['blog', 'social', 'email', 'page'] as const) {
      const slots = generateSlots(
        cfg({ contentType: ct, recurrence: 'once', startDate: '2026-07-04' }),
        1,
      );
      expect(slots[0].contentType).toBe(ct);
    }
  });

  it('generates correct ISO timestamp with preferredHour', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'once', startDate: '2026-07-04', preferredHour: 9 }),
      1,
    );
    expect(slots[0].iso).toBe('2026-07-04T09:00:00.000Z');
  });

  it('daily slots have monotonically increasing dates', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'daily', startDate: '2026-07-01' }),
      30,
    );
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].date > slots[i - 1].date).toBe(true);
    }
  });

  it('weekly slots are 7 days apart', () => {
    const slots = generateSlots(
      cfg({
        contentType: 'blog',
        recurrence: 'weekly',
        startDate: '2026-07-01',
        preferredDayOfWeek: 1,
      }),
      4,
    );
    for (let i = 1; i < slots.length; i++) {
      const prev = new Date(slots[i - 1].iso);
      const curr = new Date(slots[i].iso);
      const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      expect(diff).toBe(7);
    }
  });

  it('monthly slots are approximately 1 month apart', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'monthly', startDate: '2026-01-15' }),
      6,
    );
    for (let i = 1; i < slots.length; i++) {
      const prev = new Date(slots[i - 1].iso);
      const curr = new Date(slots[i].iso);
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      // Should be 28-31 days (roughly one month)
      expect(diffDays).toBeGreaterThanOrEqual(28);
      expect(diffDays).toBeLessThanOrEqual(31);
    }
  });

  it('clamps hourly value inside 0-23 range', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'once', startDate: '2026-07-04', preferredHour: 25 }),
      1,
    );
    expect(slots[0].iso).toContain('T23:00:00.000Z'); // clamps to 23
  });

  it('clamps negative hour to 0', () => {
    const slots = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'once', startDate: '2026-07-04', preferredHour: -5 }),
      1,
    );
    expect(slots[0].iso).toContain('T00:00:00.000Z'); // clamps to 0
  });

  it('timezone field is accepted but does not affect local calendar math', () => {
    const slotsUtc = generateSlots(
      cfg({ contentType: 'blog', recurrence: 'daily', startDate: '2026-07-01' }),
      2,
    );
    const slotsNy = generateSlots(
      cfg({
        contentType: 'blog',
        recurrence: 'daily',
        startDate: '2026-07-01',
        timezone: 'America/New_York',
      }),
      2,
    );
    expect(slotsUtc).toEqual(slotsNy);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: every slot can be re-parsed
// ---------------------------------------------------------------------------

describe('slot integrity', () => {
  it('every generated slot can be re-parsed as a valid Date', () => {
    const configs: ScheduleConfig[] = [
      { contentType: 'blog', recurrence: 'once', startDate: '2026-07-01' },
      { contentType: 'social', recurrence: 'daily', startDate: '2026-07-01', preferredHour: 14 },
      {
        contentType: 'email',
        recurrence: 'weekly',
        startDate: '2026-07-01',
        preferredDayOfWeek: 5,
        preferredHour: 9,
      },
      {
        contentType: 'page',
        recurrence: 'monthly',
        startDate: '2026-07-01',
        preferredDayOfMonth: 1,
      },
    ];
    for (const c of configs) {
      const slots = generateSlots(c, 10);
      for (const s of slots) {
        const parsed = new Date(s.iso);
        expect(parsed.toISOString()).toBe(s.iso);
        expect(isNaN(parsed.getTime())).toBe(false);
        expect(s.dayOfWeek).toBeGreaterThanOrEqual(0);
        expect(s.dayOfWeek).toBeLessThanOrEqual(6);
        expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('every slot has a non-empty date string in YYYY-MM-DD format', () => {
    const slots = generateSlots(
      cfg({ contentType: 'email', recurrence: 'daily', startDate: '2026-07-01' }),
      5,
    );
    for (const s of slots) {
      expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
