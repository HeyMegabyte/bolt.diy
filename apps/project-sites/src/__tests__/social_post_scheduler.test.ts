/**
 * @module __tests__/social_post_scheduler.test
 *
 * @description
 * Pure zero-I/O tests for the social post calendar generator. Covers every
 * platform combination, edge case, and boundary condition documented in
 * {@link services/social_post_scheduler}.
 */

import {
  type CalendarSpec,
  type Platform,
  BEST_TIMES,
  ALL_PLATFORMS,
  generateCalendar,
} from '../services/social_post_scheduler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal spec with sensible defaults. */
function spec(overrides: Partial<CalendarSpec> & { platforms: Platform[] }): CalendarSpec {
  return {
    platforms: overrides.platforms,
    postsPerWeek: overrides.postsPerWeek ?? 5,
    contentType: overrides.contentType ?? 'promo',
    startDate: overrides.startDate ?? '2026-07-06',
  };
}

// ---------------------------------------------------------------------------
// BEST_TIMES
// ---------------------------------------------------------------------------

describe('BEST_TIMES', () => {
  it('covers all four platforms', () => {
    expect(Object.keys(BEST_TIMES).sort()).toEqual(
      ['x', 'linkedin', 'facebook', 'instagram'].sort(),
    );
  });

  it('X has 9 best-time windows (Tue-Thu × 3 daily)', () => {
    expect(BEST_TIMES.x).toHaveLength(9);
  });

  it('LinkedIn has 9 best-time windows (Tue-Thu × 3 daily)', () => {
    expect(BEST_TIMES.linkedin).toHaveLength(9);
  });

  it('Facebook has 15 best-time windows (Mon-Fri × 3 daily)', () => {
    expect(BEST_TIMES.facebook).toHaveLength(15);
  });

  it('Instagram has 4 best-time windows (Mon/Thu × 2 daily)', () => {
    expect(BEST_TIMES.instagram).toHaveLength(4);
  });

  it('every X time entry has day (2-4) and hour (6-18)', () => {
    for (const t of BEST_TIMES.x) {
      expect(t.day).toBeGreaterThanOrEqual(2);
      expect(t.day).toBeLessThanOrEqual(4);
      expect(t.hour).toBeGreaterThanOrEqual(6);
      expect(t.hour).toBeLessThanOrEqual(18);
    }
  });

  it('every LinkedIn time entry has day (2-4) and hour (6-18)', () => {
    for (const t of BEST_TIMES.linkedin) {
      expect(t.day).toBeGreaterThanOrEqual(2);
      expect(t.day).toBeLessThanOrEqual(4);
      expect(t.hour).toBeGreaterThanOrEqual(6);
      expect(t.hour).toBeLessThanOrEqual(18);
    }
  });

  it('every Facebook time entry has day (1-5) and hour (6-18)', () => {
    for (const t of BEST_TIMES.facebook) {
      expect(t.day).toBeGreaterThanOrEqual(1);
      expect(t.day).toBeLessThanOrEqual(5);
      expect(t.hour).toBeGreaterThanOrEqual(6);
      expect(t.hour).toBeLessThanOrEqual(18);
    }
  });

  it('every Instagram time entry has day (1,4) and hour (9-21)', () => {
    for (const t of BEST_TIMES.instagram) {
      expect([1, 4]).toContain(t.day);
      expect(t.hour).toBeGreaterThanOrEqual(9);
      expect(t.hour).toBeLessThanOrEqual(21);
    }
  });

  it('ALL_PLATFORMS contains all four platforms', () => {
    expect(ALL_PLATFORMS).toEqual(['x', 'linkedin', 'facebook', 'instagram']);
  });

  it('BEST_TIMES keys match ALL_PLATFORMS', () => {
    expect(Object.keys(BEST_TIMES).sort()).toEqual([...ALL_PLATFORMS].sort());
  });
});

// ---------------------------------------------------------------------------
// generateCalendar — edge cases
// ---------------------------------------------------------------------------

describe('generateCalendar — edge cases', () => {
  it('returns empty for empty platforms', () => {
    expect(generateCalendar(spec({ platforms: [] }))).toHaveLength(0);
  });

  it('returns empty for postsPerWeek < 1', () => {
    expect(generateCalendar(spec({ platforms: ['x'], postsPerWeek: 0 }))).toHaveLength(0);
    expect(generateCalendar(spec({ platforms: ['x'], postsPerWeek: -1 }))).toHaveLength(0);
  });

  it('returns empty for unparseable startDate', () => {
    expect(generateCalendar(spec({ platforms: ['x'], startDate: 'not-a-date' }))).toHaveLength(0);
  });

  it('clamps weeks < 1 to 1', () => {
    const result = generateCalendar(
      spec({ platforms: ['x'], postsPerWeek: 1, startDate: '2026-07-06' }),
      0,
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('handles unknown platform gracefully (no crash)', () => {
    // @ts-expect-error — testing runtime resilience
    const result = generateCalendar(spec({ platforms: ['unknown'] }));
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateCalendar — single platform, 1 week
// ---------------------------------------------------------------------------

describe('generateCalendar — single platform, 1 week', () => {
  it('generates X posts on Tue-Thu best times', () => {
    // Jul 7 is Tuesday. X has 9 times (3 days × 3 slots).
    // All fall within week Jul 7-13.
    const result = generateCalendar(
      spec({
        platforms: ['x'],
        postsPerWeek: 9,
        contentType: 'promo',
        startDate: '2026-07-07',
      }),
      1,
    );
    expect(result).toHaveLength(9);
    expect(result.every((s) => s.platform === 'x')).toBe(true);
    expect(result.every((s) => s.contentType === 'promo')).toBe(true);

    // First slot: Tue 7th 9am
    expect(result[0].date).toBe('2026-07-07');
    expect(result[0].time).toBe('09:00');

    // Last slot: Thu 9th 5pm
    expect(result[8].date).toBe('2026-07-09');
    expect(result[8].time).toBe('17:00');
  });

  it('limits posts when fewer windows than postsPerWeek', () => {
    // X has 9 windows/week, request 20 → get 9
    const result = generateCalendar(
      spec({ platforms: ['x'], postsPerWeek: 20, startDate: '2026-07-06' }),
      1,
    );
    expect(result).toHaveLength(9);
  });

  it('generates LinkedIn posts sorted chronologically', () => {
    // Jul 7 is Tuesday. LinkedIn: Tue 8am, 12pm, 4pm.
    const result = generateCalendar(
      spec({
        platforms: ['linkedin'],
        postsPerWeek: 3,
        contentType: 'thought-leadership',
        startDate: '2026-07-07',
      }),
      1,
    );
    expect(result).toHaveLength(3);
    expect(result.every((s) => s.platform === 'linkedin')).toBe(true);

    expect(result[0].time).toBe('08:00');
    expect(result[1].time).toBe('12:00');
    expect(result[2].time).toBe('16:00');
  });

  it('generates Facebook posts Mon-Fri', () => {
    // Jul 6 is Monday. Facebook has 15 windows (5 × 3)
    const result = generateCalendar(
      spec({
        platforms: ['facebook'],
        postsPerWeek: 15,
        startDate: '2026-07-06',
      }),
      1,
    );
    expect(result).toHaveLength(15);
    expect(result.every((s) => s.platform === 'facebook')).toBe(true);

    // First: Mon 6th 9am
    expect(result[0].date).toBe('2026-07-06');
    expect(result[0].time).toBe('09:00');

    // Last: Fri 10th 3pm
    expect(result[14].date).toBe('2026-07-10');
    expect(result[14].time).toBe('15:00');
  });

  it('generates Instagram posts Mon and Thu', () => {
    // Jul 6 is Monday. IG: Mon 11am, Mon 7pm, Thu 11am, Thu 7pm
    const result = generateCalendar(
      spec({
        platforms: ['instagram'],
        postsPerWeek: 4,
        startDate: '2026-07-06',
      }),
      1,
    );
    expect(result).toHaveLength(4);
    expect(result.every((s) => s.platform === 'instagram')).toBe(true);

    expect(result[0].date).toBe('2026-07-06');
    expect(result[0].time).toBe('11:00');
    expect(result[1].date).toBe('2026-07-06');
    expect(result[1].time).toBe('19:00');
    expect(result[2].date).toBe('2026-07-09');
    expect(result[2].time).toBe('11:00');
    expect(result[3].date).toBe('2026-07-09');
    expect(result[3].time).toBe('19:00');
  });
});

// ---------------------------------------------------------------------------
// generateCalendar — multi-platform
// ---------------------------------------------------------------------------

describe('generateCalendar — multiple platforms', () => {
  it('spreads across two platforms sorted chronologically', () => {
    // x + linkedin starting Tue Jul 7
    // Candidates sorted: linkedin Tue 8am, x Tue 9am, x Tue 12pm, linkedin Tue 12pm, ...
    const result = generateCalendar(
      spec({
        platforms: ['x', 'linkedin'],
        postsPerWeek: 5,
        startDate: '2026-07-07',
      }),
      1,
    );
    expect(result).toHaveLength(5);

    // First: LinkedIn Tue 8am
    expect(result[0].platform).toBe('linkedin');
    expect(result[0].time).toBe('08:00');

    // Second: X Tue 9am
    expect(result[1].platform).toBe('x');
    expect(result[1].time).toBe('09:00');
  });

  it('returns slots in chronological order across all platforms', () => {
    const result = generateCalendar(
      spec({
        platforms: ['x', 'linkedin', 'facebook', 'instagram'],
        postsPerWeek: 10,
        startDate: '2026-07-06',
      }),
      1,
    );
    expect(result).toHaveLength(10);

    for (let i = 1; i < result.length; i++) {
      const curr = new Date(`${result[i].date}T${result[i].time}:00`);
      const prev = new Date(`${result[i - 1].date}T${result[i - 1].time}:00`);
      expect(curr.getTime()).toBeGreaterThanOrEqual(prev.getTime());
    }
  });

  it('uses only specified platforms', () => {
    const result = generateCalendar(
      spec({
        platforms: ['instagram'],
        postsPerWeek: 4,
        startDate: '2026-07-06',
      }),
      1,
    );
    expect(result.every((s) => s.platform === 'instagram')).toBe(true);
    expect(result).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// generateCalendar — multiple weeks
// ---------------------------------------------------------------------------

describe('generateCalendar — multiple weeks', () => {
  it('generates N weeks of posts', () => {
    const result = generateCalendar(
      spec({
        platforms: ['instagram'],
        postsPerWeek: 4,
        startDate: '2026-07-06',
      }),
      3,
    );
    expect(result).toHaveLength(12);
  });

  it('slots are chronologically sequential across weeks', () => {
    const result = generateCalendar(
      spec({
        platforms: ['x'],
        postsPerWeek: 3,
        startDate: '2026-07-06',
      }),
      3,
    );
    expect(result).toHaveLength(9);

    const week1End = result[2].date;
    const week2Start = result[3].date;
    expect(week2Start > week1End).toBe(true);
  });

  it('defaults to 4 weeks', () => {
    const result = generateCalendar(
      spec({
        platforms: ['x'],
        postsPerWeek: 2,
        startDate: '2026-07-06',
      }),
    );
    expect(result).toHaveLength(8);
  });

  it('is idempotent — same input produces same output', () => {
    const r1 = generateCalendar(
      spec({ platforms: ['x'], postsPerWeek: 2, startDate: '2026-07-06' }),
      2,
    );
    const r2 = generateCalendar(
      spec({ platforms: ['x'], postsPerWeek: 2, startDate: '2026-07-06' }),
      2,
    );
    expect(r1).toEqual(r2);
  });
});

// ---------------------------------------------------------------------------
// generateCalendar — start date mid-week
// ---------------------------------------------------------------------------

describe('generateCalendar — start date mid-week', () => {
  it('includes best times on the start date itself regardless of hour', () => {
    // Jul 7 is Tuesday. X Tue 9am is before the parsed noon of startDate.
    // With day-granularity comparison it should be included.
    const result = generateCalendar(
      spec({
        platforms: ['x'],
        postsPerWeek: 3,
        startDate: '2026-07-07',
      }),
      1,
    );
    // Tue 7th: 9am, 12pm, 5pm → all 3 included
    expect(result).toHaveLength(3);
    expect(result[0].time).toBe('09:00');
    expect(result[1].time).toBe('12:00');
    expect(result[2].time).toBe('17:00');
  });

  it('generates slots for full week when starting mid-week', () => {
    // Jul 8 is Wednesday. Week = Jul 8-14.
    // Instagram: Thu Jul 9 (11am, 7pm) + Mon Jul 13 (11am, 7pm) = 4 slots
    const result = generateCalendar(
      spec({
        platforms: ['instagram'],
        postsPerWeek: 4,
        startDate: '2026-07-08',
      }),
      1,
    );
    expect(result).toHaveLength(4);
    expect(result[0].date).toBe('2026-07-09');
    expect(result[2].date).toBe('2026-07-13');
  });
});

// ---------------------------------------------------------------------------
// Slot integrity
// ---------------------------------------------------------------------------

describe('slot integrity', () => {
  it('every slot has a valid YYYY-MM-DD date', () => {
    const result = generateCalendar(
      spec({
        platforms: ['x', 'linkedin', 'facebook', 'instagram'],
        postsPerWeek: 10,
        startDate: '2026-07-06',
      }),
      3,
    );
    for (const s of result) {
      expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every slot has a valid HH:MM time', () => {
    const result = generateCalendar(
      spec({
        platforms: ['x', 'linkedin', 'facebook', 'instagram'],
        postsPerWeek: 8,
        startDate: '2026-07-06',
      }),
      2,
    );
    for (const s of result) {
      expect(s.time).toMatch(/^\d{2}:\d{2}$/);
      const [h] = s.time.split(':').map(Number);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(23);
    }
  });

  it('every slot has a valid platform and non-empty contentType', () => {
    const result = generateCalendar(
      spec({
        platforms: ['x', 'instagram'],
        postsPerWeek: 6,
        startDate: '2026-07-06',
      }),
      2,
    );
    for (const s of result) {
      expect(ALL_PLATFORMS).toContain(s.platform);
      expect(s.contentType.length).toBeGreaterThan(0);
    }
  });

  it('every slot date parses to a real Date', () => {
    const result = generateCalendar(
      spec({
        platforms: ['facebook'],
        postsPerWeek: 3,
        startDate: '2026-07-06',
      }),
      2,
    );
    for (const s of result) {
      const d = new Date(`${s.date}T${s.time}:00`);
      expect(isNaN(d.getTime())).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Content type propagation
// ---------------------------------------------------------------------------

describe('content type propagation', () => {
  it('all slots carry the spec contentType', () => {
    const result = generateCalendar(
      spec({
        platforms: ['x', 'linkedin'],
        postsPerWeek: 4,
        contentType: 'case-study',
        startDate: '2026-07-06',
      }),
      2,
    );
    expect(result.every((s) => s.contentType === 'case-study')).toBe(true);
  });

  it('accepts empty string contentType', () => {
    const result = generateCalendar(
      spec({
        platforms: ['x'],
        postsPerWeek: 1,
        contentType: '',
        startDate: '2026-07-06',
      }),
      1,
    );
    expect(result.every((s) => s.contentType === '')).toBe(true);
  });
});
