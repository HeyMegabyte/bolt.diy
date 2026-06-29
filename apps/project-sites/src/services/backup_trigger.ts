/**
 * @module services/backup_trigger
 * @description Pure schedule helpers for D1 / R2 / Neon backup triggers.
 *
 * Computes next-run windows from cron-like expressions and checks whether a
 * schedule is due. Zero external deps — feeds the cron-tick handler that
 * fans out to the per-target backup services.
 */

/** Backup target identifier. */
export type BackupTarget = 'd1' | 'r2' | 'neon';

/** A single backup schedule with its cron, retention policy, and state. */
export interface BackupSchedule {
  /** Which store this schedule backs up. */
  target: BackupTarget;
  /** Cron expression (5-field POSIX or "every N {unit}" human form). */
  cron: string;
  /** Number of days to retain completed backups. */
  retentionDays: number;
  /** ISO-8601 string of the last successful run, or null if never run. */
  lastRun: string | null;
  /** ISO-8601 string of the next scheduled run. */
  nextRun: string;
}

// ---------------------------------------------------------------------------
// Cron parsing (pure, no deps)
// ---------------------------------------------------------------------------

/**
 * Normalise a "every N {unit}" string to ms.
 * Returns 0 when the expression doesn't match the human-readable form.
 */
function humanIntervalMs(cron: string): number {
  const m = cron.match(/^every\s+(\d+)\s+(minute|hour|day|week)s?\s*$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case 'minute':
      return n * 60_000;
    case 'hour':
      return n * 3_600_000;
    case 'day':
      return n * 86_400_000;
    case 'week':
      return n * 604_800_000;
    default:
      return 0;
  }
}

/** Fields of a standard 5-field cron: minute, hour, dom, month, dow. */
type CronFields = [number, number, number, number, number];

const ALL = 99; // wildcard sentinel

/**
 * Parse a 5-field POSIX cron into structured fields.
 *
 * Supports:
 * - wildcard (asterisk / step prefix like star/N)
 * - numeric literals
 *
 * Unsupported field values (comma-lists, ranges, named months) return null so
 * the caller can fall back to a safe default.
 */
function parseCron(cron: string): CronFields | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const fields: CronFields = [ALL, ALL, ALL, ALL, ALL];
  for (let i = 0; i < 5; i++) {
    const raw = parts[i]?.trim();
    if (!raw || raw === '*' || raw.startsWith('*/')) continue; // wildcard
    const n = parseInt(raw, 10);
    if (isNaN(n)) return null; // unsupported (comma-list, named, etc.)
    fields[i] = n;
  }
  return fields;
}

// Days since epoch helpers — pure arithmetic, no Date set* mutation needed.

function daysSinceEpoch(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

function msFromDays(days: number): number {
  return days * 86_400_000;
}

/**
 * Compute the next run timestamp (ms since epoch) for a daily-like cron.
 *
 * Handles:
 * - "every N unit"  (minute/hour/day/week)  — simple interval from afterMs
 * - "MIN H * * *"     — daily at a fixed minute + hour (e.g. 0 3 * * *)
 * - "MIN H * * DOW"   — weekly at a fixed weekday + hour
 *
 * Returns afterMs + 24h as a safe fallback when the expression can't be
 * fully parsed (never returns 0 / never blocks permanently).
 */
export function parseNextRunMs(cron: string, afterMs: number = Date.now()): number {
  // 1 — Human-readable interval
  const interval = humanIntervalMs(cron);
  if (interval > 0) return afterMs + interval;

  // 2 — POSIX 5-field cron
  const fields = parseCron(cron);
  if (fields === null) return afterMs + 86_400_000; // fallback: +1 day

  const [minute, hour, , , dow] = fields;

  // 3 — Daily at fixed hour+minute (dow is wildcard)
  if (dow === ALL) {
    const candidate = new Date(afterMs);
    candidate.setUTCHours(hour === ALL ? 0 : hour, minute === ALL ? 0 : minute, 0, 0);
    if (candidate.getTime() > afterMs) return candidate.getTime();
    // Already past today's window — advance to tomorrow
    return (
      msFromDays(daysSinceEpoch(afterMs) + 1) +
      (hour === ALL ? 0 : hour * 3_600_000) +
      (minute === ALL ? 0 : minute * 60_000)
    );
  }

  // 4 — Weekly at fixed weekday + hour+minute
  const targetDow = dow;
  const afterDow = new Date(afterMs).getUTCDay();
  let daysAhead = targetDow - afterDow;
  if (
    daysAhead < 0 ||
    (daysAhead === 0 &&
      afterMs >=
        msFromDays(daysSinceEpoch(afterMs)) +
          (hour === ALL ? 0 : hour * 3_600_000) +
          (minute === ALL ? 0 : minute * 60_000))
  ) {
    daysAhead += 7;
  }
  return (
    msFromDays(daysSinceEpoch(afterMs) + daysAhead) +
    (hour === ALL ? 0 : hour * 3_600_000) +
    (minute === ALL ? 0 : minute * 60_000)
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a backup schedule with the given target, cron expression, and optional
 * retention period.
 *
 * @param target      Which store to back up.
 * @param cron        Interval in "every N {unit}" or POSIX 5-field form.
 * @param retentionDays  How many days to keep backups (default 30).
 * @returns A fully-populated BackupSchedule with `lastRun: null`.
 *
 * @example
 * buildSchedule('d1', '0 3 * * *', 30)
 * // → { target: 'd1', cron: '0 3 * * *', retentionDays: 30, lastRun: null, nextRun: '…' }
 *
 * @example
 * buildSchedule('r2', 'every 7 days', 90)
 * // → { target: 'r2', cron: 'every 7 days', retentionDays: 90, lastRun: null, nextRun: '…' }
 */
export function buildSchedule(
  target: BackupTarget,
  cron: string,
  retentionDays: number = 30,
): BackupSchedule {
  const now = Date.now();
  return {
    cron,
    lastRun: null,
    nextRun: new Date(parseNextRunMs(cron, now)).toISOString(),
    retentionDays,
    target,
  };
}

/**
 * Returns `true` when the current time has reached or passed the schedule's
 * next run window.
 *
 * @param schedule  The schedule to evaluate.
 * @param nowMs     Optional override for the current epoch ms (defaults to
 *                  `Date.now()`). Useful for deterministic tests.
 *
 * @example
 * isDue(schedule)                                   // checks against wall clock
 * isDue(schedule, 1_700_000_000_000)                // deterministic for tests
 */
export function isDue(schedule: BackupSchedule, nowMs: number = Date.now()): boolean {
  return nowMs >= new Date(schedule.nextRun).getTime();
}

// ---------------------------------------------------------------------------
// Default schedules
// ---------------------------------------------------------------------------

/** Sane defaults for each backup target. */
export const DEFAULT_SCHEDULES: Record<BackupTarget, BackupSchedule> = {
  /** D1: daily at 03:00 UTC, 30-day retention. */
  d1: buildSchedule('d1', '0 3 * * *'),

  /** Neon: daily at 04:00 UTC, 30-day retention. */
  neon: buildSchedule('neon', '0 4 * * *'),

  /** R2: weekly on Sunday at 03:00 UTC, 90-day retention. */
  r2: buildSchedule('r2', '0 3 * * 0', 90),
};
