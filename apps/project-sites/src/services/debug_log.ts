/**
 * @module services/debug_log
 *
 * Pure structured debug-log entry builder + severity filter for the admin log
 * viewer.  All exports are deterministic (no clock, no I/O) — the caller
 * supplies timestamps and trace IDs.
 */

/** Log severity levels, least to most severe. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** A single structured log entry as rendered in the admin viewer. */
export interface LogEntry {
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
  timestamp: string;
  traceId: string;
}

// ---------------------------------------------------------------------------
// Level constants
// ---------------------------------------------------------------------------

/** All log levels in ascending severity order. */
export const LOG_LEVELS: readonly LogLevel[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const;

/** Severity rank: 0 = trace … 5 = fatal. */
export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 1,
  error: 4,
  fatal: 5,
  info: 2,
  trace: 0,
  warn: 3,
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Compare two severity levels.  Returns `true` when {@link level} is at least
 * as severe as {@link threshold}.
 *
 * @param level  The level to test.
 * @param threshold  The minimum severity threshold.
 * @returns `true` if `rank(level) >= rank(threshold)`.
 * @example
 * shouldLog('warn', 'info')  // true  (warn ≥ info)
 * shouldLog('debug', 'info') // false (debug < info)
 */
export function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[threshold];
}

/**
 * Build a {@link LogEntry} from raw parts.  Every field is deterministic from
 * the arguments — no clock, no random.
 *
 * @param level    Severity.
 * @param message  Human-readable description.
 * @param context  Optional structured payload (defaults to `{}`).
 * @param traceId  Optional trace identifier (defaults to `""`).
 * @returns A fully populated `LogEntry`.
 * @example
 * const entry = createLogEntry('info', 'Site published', { slug: 'acme' }, 'abc-123');
 * // { level:'info', message:'Site published', context:{slug:'acme'}, timestamp:'', traceId:'abc-123' }
 */
export function createLogEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  traceId?: string,
): LogEntry {
  return {
    context: context ?? {},
    level,
    message,
    timestamp: '',
    traceId: traceId ?? '',
  };
}

/**
 * Filter an array of log entries by one or more criteria.  All specified
 * criteria must match (AND logic).  Returns a **new** array — never mutates
 * the input.
 *
 * @param entries  The source entries (read-only, not mutated).
 * @param opts     Filter options.  Every field is optional; omit to return a
 *                 shallow copy of the input.
 * @param opts.minLevel  Minimum severity (inclusive).  Entries below this
 *                       rank are dropped.
 * @param opts.traceId   Exact trace ID match.
 * @param opts.since     ISO date string; only entries whose `timestamp` is `>=`
 *                       this value pass.
 * @param opts.search    Substring search against `message` (case-insensitive).
 * @returns A new filtered array.
 * @example
 * const filtered = filterLogs(entries, { minLevel: 'warn', search: 'timeout' });
 */
export function filterLogs(
  entries: readonly LogEntry[],
  opts: {
    minLevel?: LogLevel;
    search?: string;
    since?: string;
    traceId?: string;
  } = {},
): LogEntry[] {
  const { minLevel, search, since, traceId } = opts;

  return entries.filter((e) => {
    if (minLevel !== undefined && !shouldLog(e.level, minLevel)) {
      return false;
    }
    if (traceId !== undefined && e.traceId !== traceId) {
      return false;
    }
    if (since !== undefined && e.timestamp < since) {
      return false;
    }
    if (
      search !== undefined &&
      search.length > 0 &&
      !e.message.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}
