/**
 * @module services/log_export
 *
 * Pure log-export formatters.  Every function is deterministic — no clock, no
 * I/O, no random — and operates on in-memory log entries only.  Use these to
 * produce downloadable strings (CSV, JSON, NDJSON) from an array of LogEntry
 * objects for the admin log viewer.
 *
 * @example
 * ```ts
 * const csv = exportLogs(entries, 'csv');
 * // → '"info","Site published","{}","",".+"\n...'
 * ```
 */

import type { LogEntry } from './debug_log.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported log export output formats. */
export type ExportFormat = 'csv' | 'json' | 'ndjson';

/** All accepted export formats, ordered by likelihood. */
export const EXPORT_FORMATS: readonly ExportFormat[] = Object.freeze(['csv', 'json', 'ndjson']);

// ---------------------------------------------------------------------------
// formatLogAsCsv
// ---------------------------------------------------------------------------

/**
 * Format a single {@link LogEntry} as one CSV row.
 *
 * Every field is JSON-escaped and enclosed in double quotes.  The row order
 * is: level, message, context (JSON-stringified), timestamp, traceId.
 *
 * @param entry - The log entry to format.
 * @returns A single CSV row **without** a trailing newline.
 *
 * @example
 * ```ts
 * const entry: LogEntry = {
 *   level: 'info',
 *   message: 'Site published',
 *   context: { slug: 'acme' },
 *   timestamp: '2026-06-01T12:00:00Z',
 *   traceId: 'abc-123',
 * };
 * formatLogAsCsv(entry)
 * // → '"info","Site published","{""slug"":""acme""}","2026-06-01T12:00:00Z","abc-123"'
 * ```
 */
export function formatLogAsCsv(entry: LogEntry): string {
  const fields = [
    entry.level,
    entry.message,
    JSON.stringify(entry.context),
    entry.timestamp,
    entry.traceId,
  ];
  return fields.map((f) => `"${escapeCsvField(f)}"`).join(',');
}

/**
 * Escape a string for use inside a double-quoted CSV field.
 *
 * Doubles every `"` and wraps in quotes. If the value is empty, returns
 * an empty string (caller adds the surrounding quotes).
 */
function escapeCsvField(value: string): string {
  return value.replace(/"/g, '""');
}

// ---------------------------------------------------------------------------
// formatLogAsJson
// ---------------------------------------------------------------------------

/**
 * Format an array of {@link LogEntry} as a single pretty-printed JSON array.
 *
 * @param entries - The log entries to format.
 * @returns A JSON string representing the array of entries.
 *
 * @example
 * ```ts
 * formatLogAsJson([entry])
 * // → '[\n  {\n    "level": "info",\n    "message": "Site published",\n    ...\n  }\n]'
 * ```
 */
export function formatLogAsJson(entries: readonly LogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

// ---------------------------------------------------------------------------
// formatLogAsNdjson
// ---------------------------------------------------------------------------

/**
 * Format an array of {@link LogEntry} as newline-delimited JSON (NDJSON).
 *
 * Each entry is a single compact JSON line.  An empty input returns an
 * empty string (no trailing newline).
 *
 * @param entries - The log entries to format.
 * @returns NDJSON lines joined by newlines.
 *
 * @example
 * ```ts
 * formatLogAsNdjson([entry1, entry2])
 * // → '{"level":"info",...}\n{"level":"warn",...}'
 * ```
 */
export function formatLogAsNdjson(entries: readonly LogEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

// ---------------------------------------------------------------------------
// exportLogs
// ---------------------------------------------------------------------------

/**
 * Export an array of log entries in the requested format.
 *
 * This is the single entry point for log export.  It dispatches to the
 * correct formatter based on the `format` parameter.
 *
 * @param logs    - The log entries to export (read-only, not mutated).
 * @param format  - One of `'csv'`, `'json'`, or `'ndjson'`.
 * @returns The formatted output as a string.
 *
 * @example
 * ```ts
 * const csv  = exportLogs(entries, 'csv');
 * const json = exportLogs(entries, 'json');
 * const nd   = exportLogs(entries, 'ndjson');
 * ```
 */
export function exportLogs(logs: readonly LogEntry[], format: ExportFormat): string {
  switch (format) {
    case 'csv': {
      return logs.map((e) => formatLogAsCsv(e)).join('\n');
    }
    case 'json': {
      return formatLogAsJson(logs);
    }
    case 'ndjson': {
      return formatLogAsNdjson(logs);
    }
  }
}
