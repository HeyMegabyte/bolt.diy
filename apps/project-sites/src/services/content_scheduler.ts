/**
 * @module services/content_scheduler
 *
 * @description
 * Pure zero-I/O content scheduling engine. Computes the next N publishable
 * slots from a {@link ScheduleConfig}, performing local-calendar date math
 * without touching any I/O, clock, or storage. Never throws — every function
 * returns a well-defined value for every input.
 *
 *   once    → just the start date
 *   daily   → start + 1, start + 2, …
 *   weekly  → next `preferredDayOfWeek` from start, then +7d
 *   monthly → next `preferredDayOfMonth` from start (capped at 28)
 *
 * @see types — {@link ContentType}, {@link Recurrence}, {@link ScheduleConfig}, {@link ScheduledSlot}
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The kind of content a slot is reserved for. */
export type ContentType = 'blog' | 'social' | 'email' | 'page';

/** How often the schedule repeats. */
export type Recurrence = 'once' | 'daily' | 'weekly' | 'monthly';

/** Configuration that drives slot generation. */
export interface ScheduleConfig {
  readonly contentType: ContentType;
  readonly recurrence: Recurrence;
  readonly preferredDayOfWeek?: number; // 0=Sun..6=Sat (for weekly)
  readonly preferredDayOfMonth?: number; // 1-28 (for monthly)
  readonly preferredHour?: number; // 0-23, default 10
  readonly startDate: string; // ISO date YYYY-MM-DD
  readonly endDate?: string; // ISO date, null=indefinite
  readonly timezone?: string; // 'America/New_York' etc, default 'UTC'
}

/** A single scheduled publish slot. */
export interface ScheduledSlot {
  readonly contentType: ContentType;
  readonly date: string; // YYYY-MM-DD
  readonly dayOfWeek: number; // 0-6
  readonly iso: string; // ISO 8601 datetime
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Content types that can be auto-scheduled without human approval. */
export const AUTO_SCHEDULABLE: readonly ContentType[] = ['social', 'email'] as const;

const DEFAULT_HOUR = 10;
const DAYS_IN_WEEK = 7;
const SAFE_MAX_DAY_OF_MONTH = 28;

// ---------------------------------------------------------------------------
// Helpers (pure date math, local-calendar)
// ---------------------------------------------------------------------------

/**
 * Parse an ISO date string into a Date object at local noon (avoids
 * timezone-induced date shifts).
 *
 * @param iso - Date string in YYYY-MM-DD format.
 * @returns A Date object representing local noon on that day.
 */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * Format a Date object to YYYY-MM-DD in the local timezone.
 *
 * @param date - The date to format.
 * @returns A zero-padded ISO date string.
 */
function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Add N whole days to a date (local-calendar).
 *
 * @param date - Starting date.
 * @param days - Number of days to add (may be negative).
 * @returns A new Date offset by the given days.
 */
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the next occurrence of a given day-of-week on or after the provided
 * date, in local calendar math.
 *
 * @param date - The reference date.
 * @param targetDay - Day of week to find (0=Sun .. 6=Sat).
 * @returns A new Date representing the next (or same) occurrence of
 *   `targetDay`. If `targetDay` is out of range (not 0-6), returns a copy of
 *   the input date unchanged.
 *
 * @example nextDayOfWeek(new Date('2026-06-29'), 0) // → Mon Jun 29 → next Sun = 2026-07-05
 */
export function nextDayOfWeek(date: Date, targetDay: number): Date {
  if (targetDay < 0 || targetDay > 6) return new Date(date);
  const currentDay = date.getDay();
  let diff = targetDay - currentDay;
  if (diff < 0) diff += DAYS_IN_WEEK;
  if (diff === 0) return new Date(date);
  return addDays(date, diff);
}

/**
 * Check whether a date falls within the schedule's active window (on or after
 * `startDate`, before or on `endDate` if one is set).
 *
 * @param date - The date to check.
 * @param config - The schedule configuration.
 * @returns `true` when the date is within the window.
 *
 * @example isWithinWindow(new Date('2026-07-01'), { contentType:'blog', recurrence:'daily', startDate:'2026-06-15', endDate:'2026-07-15' })
 * // → true
 */
export function isWithinWindow(date: Date, config: ScheduleConfig): boolean {
  const start = parseLocalDate(config.startDate);
  const end = config.endDate ? parseLocalDate(config.endDate) : null;

  // Normalize both to midnight-local for comparison
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const startNorm = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  if (normalized.getTime() < startNorm.getTime()) return false;
  if (end !== null) {
    const endNorm = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (normalized.getTime() > endNorm.getTime()) return false;
  }

  return true;
}

/**
 * Generate the next N scheduled slots from a schedule configuration. Each
 * slot has a local-calendar date, day-of-week, ISO 8601 datetime, and content
 * type.
 *
 * Rules:
 * - `once` — returns a single slot on `startDate`.
 * - `daily` — slots are startDate, startDate+1, startDate+2, …
 * - `weekly` — first slot is the next `preferredDayOfWeek` at or after
 *   `startDate`; subsequent slots are +7 days each.
 * - `monthly` — first slot is the next `preferredDayOfMonth` at or after
 *   `startDate`; subsequent slots are +1 month each.
 * - All dates use local calendar math (no timezone conversion).
 * - `preferredHour` defaults to 10 (10:00:00.000Z).
 * - When `endDate` is set, slots that land after it are excluded (return
 *   early with what fits).
 * - Slots never exceed `count` — if the window closes before N slots are
 *   produced, the returned array is shorter than `count`.
 *
 * @param config - The schedule configuration.
 * @param count  - Number of slots to generate (must be ≥ 0; values < 1
 *   return an empty array).
 * @returns An ordered array of schedule slots.
 *
 * @example
 * generateSlots({ contentType:'blog', recurrence:'daily', startDate:'2026-07-01', preferredHour:9 }, 3)
 * // →
 * // [
 * //   { date:'2026-07-01', dayOfWeek:3, iso:'2026-07-01T09:00:00.000Z', contentType:'blog' },
 * //   { date:'2026-07-02', dayOfWeek:4, iso:'2026-07-02T09:00:00.000Z', contentType:'blog' },
 * //   { date:'2026-07-03', dayOfWeek:5, iso:'2026-07-03T09:00:00.000Z', contentType:'blog' },
 * // ]
 */
export function generateSlots(config: ScheduleConfig, count: number): ScheduledSlot[] {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount < 1) return [];

  const hour = config.preferredHour ?? DEFAULT_HOUR;
  const slots: ScheduledSlot[] = [];
  let cursor: Date;

  // Determine the first cursor
  switch (config.recurrence) {
    case 'once': {
      const d = parseLocalDate(config.startDate);
      if (isWithinWindow(d, config)) {
        slots.push(makeSlot(d, hour, config.contentType));
      }
      return slots; // once always returns exactly 0 or 1 slot
    }

    case 'daily':
      cursor = parseLocalDate(config.startDate);
      break;

    case 'weekly': {
      const from = parseLocalDate(config.startDate);
      const dow = config.preferredDayOfWeek ?? from.getDay();
      cursor = nextDayOfWeek(from, dow);
      break;
    }

    case 'monthly': {
      const from = parseLocalDate(config.startDate);
      const dom = config.preferredDayOfMonth ?? Math.min(from.getDate(), SAFE_MAX_DAY_OF_MONTH);
      const clamped = Math.max(1, Math.min(dom, SAFE_MAX_DAY_OF_MONTH));
      cursor = new Date(from.getFullYear(), from.getMonth(), clamped, 12, 0, 0, 0);
      // If the computed date is before startDate, advance to the next month
      if (cursor.getTime() < from.getTime()) {
        cursor = nextMonthDay(from.getFullYear(), from.getMonth(), clamped);
      }
      break;
    }
  }

  // Generate slots sequentially
  for (let i = 0; i < safeCount; i++) {
    if (!isWithinWindow(cursor, config)) break;

    slots.push(makeSlot(cursor, hour, config.contentType));

    // Advance cursor for the next iteration
    switch (config.recurrence) {
      case 'daily':
        cursor = addDays(cursor, 1);
        break;
      case 'weekly':
        cursor = addDays(cursor, DAYS_IN_WEEK);
        break;
      case 'monthly': {
        const nextMonth = cursor.getMonth() + 1;
        const year = cursor.getFullYear() + (nextMonth > 11 ? 1 : 0);
        const month = nextMonth > 11 ? 0 : nextMonth;
        const day = Math.min(cursor.getDate(), SAFE_MAX_DAY_OF_MONTH);
        cursor = new Date(year, month, day, 12, 0, 0, 0);
        break;
      }
    }
  }

  return slots;
}

/**
 * Build a single {@link ScheduledSlot} from a date, hour, and content type.
 *
 * @param date  - The target date.
 * @param hour  - The hour of day (0-23).
 * @param type  - The content type.
 * @returns A fully populated scheduled slot.
 */
function makeSlot(date: Date, hour: number, type: ContentType): ScheduledSlot {
  const clampedHour = Math.max(0, Math.min(23, Math.floor(hour)));
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(clampedHour).padStart(2, '0');
  return {
    contentType: type,
    date: formatLocalDate(date),
    dayOfWeek: date.getDay(),
    iso: `${y}-${m}-${d}T${h}:00:00.000Z`,
  };
}

/**
 * Get the Nth day-of-month in the next month after the given year/month,
 * falling back to the last valid day when the month is shorter.
 *
 * @param year  - Current year.
 * @param month - Current month (0-11).
 * @param day   - Target day-of-month (1-28).
 * @returns A Date in the following month on the target day.
 */
function nextMonthDay(year: number, month: number, day: number): Date {
  const nextMonth = month + 1;
  const y = year + (nextMonth > 11 ? 1 : 0);
  const m = nextMonth > 11 ? 0 : nextMonth;
  return new Date(y, m, Math.min(day, SAFE_MAX_DAY_OF_MONTH), 12, 0, 0, 0);
}
