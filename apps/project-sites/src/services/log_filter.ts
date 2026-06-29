/**
 * @module services/log_filter
 *
 * Single-purpose log-filtering utilities.  Each function is pure, accepts a
 * readonly array, and returns a **new** array — never mutates the input.
 * Use these for one-at-a-time filtering; combine with `Array.filter` for
 * compound predicates.
 *
 * @example
 * const filtered = filterByTrace(filterByLevel(logs, 'warn'), 'tid-1');
 */

import { shouldLog, type LogEntry, type LogLevel } from './debug_log.js';

// ---------------------------------------------------------------------------
// filterByLevel
// ---------------------------------------------------------------------------

/**
 * Retain only entries whose severity is at least {@link minLevel}.
 *
 * @param entries  Source log entries (read-only, not mutated).
 * @param minLevel  Minimum severity threshold (inclusive).
 * @returns A new array filtered by severity.
 * @example
 * filterByLevel(entries, 'warn')
 * // → entries with level 'warn', 'error', or 'fatal'
 */
export function filterByLevel(entries: readonly LogEntry[], minLevel: LogLevel): LogEntry[] {
  return entries.filter((e) => shouldLog(e.level, minLevel));
}

// ---------------------------------------------------------------------------
// filterByTrace
// ---------------------------------------------------------------------------

/**
 * Retain only entries that match an exact trace ID.
 *
 * @param entries  Source log entries (read-only, not mutated).
 * @param traceId  The trace identifier to match.
 * @returns A new array of entries whose `traceId` matches.
 * @example
 * filterByTrace(entries, 'abc-123')
 * // → entries where traceId === 'abc-123'
 */
export function filterByTrace(entries: readonly LogEntry[], traceId: string): LogEntry[] {
  return entries.filter((e) => e.traceId === traceId);
}

// ---------------------------------------------------------------------------
// searchLogs
// ---------------------------------------------------------------------------

/**
 * Retain only entries whose **message** or any **context value** (stringified)
 * contains the query (case-insensitive).  An empty or blank query returns
 * every entry unfiltered.
 *
 * @param entries  Source log entries (read-only, not mutated).
 * @param query  Substring to search for (case-insensitive).
 * @returns A new array of matching entries.
 * @example
 * searchLogs(entries, 'timeout')
 * // → entries where message or a context value contains "timeout"
 */
export function searchLogs(entries: readonly LogEntry[], query: string): LogEntry[] {
  if (!query.trim()) return [...entries];

  const lowered = query.toLowerCase();
  return entries.filter((e) => {
    if (e.message.toLowerCase().includes(lowered)) return true;
    for (const value of Object.values(e.context)) {
      if (typeof value === 'string' && value.toLowerCase().includes(lowered)) {
        return true;
      }
    }
    return false;
  });
}
