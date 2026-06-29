/**
 * @module services/social_post_scheduler
 *
 * @description
 * Pure zero-I/O social post calendar generator. Given one or more platforms and
 * a preferred weekly cadence, generates research-backed optimal posting slots
 * for the next N weeks. Every function returns a well-defined value for every
 * input — never throws.
 *
 * Best post times per platform (research-backed):
 * - X (formerly Twitter): Tue-Thu 9am/12pm/5pm
 * - LinkedIn: Tue-Thu 8am/12pm/4pm
 * - Facebook: Mon-Fri 9am/1pm/3pm
 * - Instagram: Mon/Thu 11am/7pm
 *
 * @see types — {@link Platform}, {@link PostSlot}, {@link CalendarSpec}, {@link BestTime}
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported social media platforms. */
export type Platform = 'x' | 'linkedin' | 'facebook' | 'instagram';

/** A single scheduled social post slot. */
export interface PostSlot {
  readonly platform: Platform;
  readonly date: string; // YYYY-MM-DD
  readonly time: string; // HH:MM
  readonly contentType: string;
}

/** Specification for generating a posting calendar. */
export interface CalendarSpec {
  readonly platforms: Platform[];
  readonly postsPerWeek: number;
  readonly contentType: string;
  readonly startDate: string; // YYYY-MM-DD
}

/** A research-backed best-posting window. */
export interface BestTime {
  readonly day: number; // 0=Sun..6=Sat
  readonly hour: number; // 0-23
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Research-backed best post times per platform.
 *
 * Sources: HubSpot, Sprout Social, Hootsuite 2024-2025 industry reports.
 *
 * @example BEST_TIMES.x[0] // { day: 2, hour: 9 } — Tuesday 9am
 */
export const BEST_TIMES: Record<Platform, readonly BestTime[]> = {
  facebook: [
    { day: 1, hour: 9 },
    { day: 1, hour: 13 },
    { day: 1, hour: 15 },
    { day: 2, hour: 9 },
    { day: 2, hour: 13 },
    { day: 2, hour: 15 },
    { day: 3, hour: 9 },
    { day: 3, hour: 13 },
    { day: 3, hour: 15 },
    { day: 4, hour: 9 },
    { day: 4, hour: 13 },
    { day: 4, hour: 15 },
    { day: 5, hour: 9 },
    { day: 5, hour: 13 },
    { day: 5, hour: 15 },
  ],
  instagram: [
    { day: 1, hour: 11 },
    { day: 1, hour: 19 },
    { day: 4, hour: 11 },
    { day: 4, hour: 19 },
  ],
  linkedin: [
    { day: 2, hour: 8 },
    { day: 2, hour: 12 },
    { day: 2, hour: 16 },
    { day: 3, hour: 8 },
    { day: 3, hour: 12 },
    { day: 3, hour: 16 },
    { day: 4, hour: 8 },
    { day: 4, hour: 12 },
    { day: 4, hour: 16 },
  ],
  x: [
    { day: 2, hour: 9 },
    { day: 2, hour: 12 },
    { day: 2, hour: 17 },
    { day: 3, hour: 9 },
    { day: 3, hour: 12 },
    { day: 3, hour: 17 },
    { day: 4, hour: 9 },
    { day: 4, hour: 12 },
    { day: 4, hour: 17 },
  ],
} as const;

/** All valid platform strings. */
export const ALL_PLATFORMS: readonly Platform[] = [
  'x',
  'linkedin',
  'facebook',
  'instagram',
] as const;

const DEFAULT_WEEKS = 4;
const DAYS_IN_WEEK = 7;

// ---------------------------------------------------------------------------
// Helpers (pure date math, local-calendar)
// ---------------------------------------------------------------------------

/**
 * Parse YYYY-MM-DD into a Date at local noon (avoids timezone-induced
 * date shifts). Returns an Invalid Date for unparseable input.
 */
function parseDate(iso: string): Date {
  const parts = iso.split('-');
  if (parts.length !== 3) return new Date(NaN);
  const [y, m, d] = parts.map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return new Date(NaN);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * Format a Date as YYYY-MM-DD in the local timezone.
 */
function formatDate(date: Date): string {
  if (isNaN(date.getTime())) return 'Invalid Date';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format hours as HH:00.
 */
function formatTime(hours: number): string {
  const h = String(Math.max(0, Math.min(23, Math.floor(hours)))).padStart(2, '0');
  return `${h}:00`;
}

/**
 * Add N whole days (local calendar).
 */
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Find the next occurrence of targetDay on or after date. When targetDay is
 * out of range (not 0-6), returns a copy of the input date unchanged.
 */
function nextDayOfWeek(date: Date, targetDay: number): Date {
  if (targetDay < 0 || targetDay > 6) return new Date(date);
  const currentDay = date.getDay();
  let diff = targetDay - currentDay;
  if (diff < 0) diff += DAYS_IN_WEEK;
  return addDays(date, diff);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a posting calendar for the next N weeks based on a calendar
 * specification. Each week collects all candidate posting windows across the
 * selected platforms (from {@link BEST_TIMES}), sorts them chronologically,
 * and picks the top `postsPerWeek` slots.
 *
 * Rules:
 * - Dates use local calendar math (no timezone conversion).
 * - Week boundaries are 7-day increments from `startDate`.
 * - Slots on `startDate` itself are always included (day-level comparison).
 * - When fewer candidates exist than `postsPerWeek`, the extra slots are
 *   omitted (the week produces fewer than requested).
 * - `weeks` defaults to 4. Values < 1 are clamped to 1.
 * - Empty platforms array or postsPerWeek < 1 returns an empty array.
 * - Unparseable startDate returns an empty array.
 *
 * @param spec  - The calendar specification.
 * @param weeks - Number of weeks to generate (default 4, minimum 1).
 * @returns An ordered array of post slots, chronologically sorted.
 *
 * @example
 * generateCalendar({
 *   platforms: ['x'],
 *   postsPerWeek: 2,
 *   contentType: 'launch',
 *   startDate: '2026-07-07',
 * }, 1)
 * // → [{ platform:'x', date:'2026-07-07', time:'09:00', contentType:'launch' },
 * //     { platform:'x', date:'2026-07-07', time:'12:00', contentType:'launch' }]
 */
export function generateCalendar(spec: CalendarSpec, weeks: number = DEFAULT_WEEKS): PostSlot[] {
  const safeWeeks = Math.max(1, Math.floor(weeks));
  if (spec.postsPerWeek < 1 || spec.platforms.length === 0) return [];

  const start = parseDate(spec.startDate);
  if (isNaN(start.getTime())) return [];

  const startDayStr = formatDate(start);
  const slots: PostSlot[] = [];

  for (let w = 0; w < safeWeeks; w++) {
    const weekStart = addDays(start, w * DAYS_IN_WEEK);

    // Collect all candidate slots for this week across all platforms
    const candidates: Array<{ platform: Platform; date: Date }> = [];

    for (const platform of spec.platforms) {
      const bestTimes = BEST_TIMES[platform];
      if (!bestTimes) continue;

      for (const bt of bestTimes) {
        const dayDate = nextDayOfWeek(weekStart, bt.day);
        const diffMs = dayDate.getTime() - weekStart.getTime();
        const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

        // Only include if it falls within the current week
        if (diffDays >= 0 && diffDays < DAYS_IN_WEEK) {
          const slotDate = new Date(dayDate);
          slotDate.setHours(bt.hour, 0, 0, 0);

          // Compare at day granularity so best times on startDate itself
          // are included regardless of clock hour
          if (formatDate(slotDate) >= startDayStr) {
            candidates.push({ date: slotDate, platform });
          }
        }
      }
    }

    // Sort chronologically
    candidates.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Fill up to postsPerWeek
    const selected = candidates.slice(0, spec.postsPerWeek);

    for (const c of selected) {
      slots.push({
        contentType: spec.contentType,
        date: formatDate(c.date),
        platform: c.platform,
        time: formatTime(c.date.getHours()),
      });
    }
  }

  return slots;
}
