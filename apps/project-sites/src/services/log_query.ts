/**
 * @module services/log_query
 *
 * @description
 * Mini query-DSL parser and executor for Worker tail log search.
 *
 * Supported syntax (case-insensitive operators):
 *   level:error
 *   route:/api/sites/*
 *   duration>2s   (>500ms, >2s, >1m)
 *   status:500
 *   AND (implicit when multiple terms are space-separated)
 *   "quoted phrase"
 *
 * Example:
 *   `level:error AND route:/api/sites/* AND duration>2s`
 *
 * @packageDocumentation
 */

export interface ParsedQuery {
  levels: string[];
  routes: string[];         // glob-style, * becomes SQL LIKE %
  minDurationMs: number | null;
  maxDurationMs: number | null;
  statuses: number[];
  fullText: string | null;
}

export interface LogSearchParams {
  query: string;
  range?: '1h' | '6h' | '24h' | '7d' | '30d';
  limit?: number;
  cursor?: string;  // ISO timestamp for pagination
}

/** Parse the DSL string into structured predicates. */
export function parseLogQuery(raw: string): ParsedQuery {
  const result: ParsedQuery = {
    levels: [],
    routes: [],
    minDurationMs: null,
    maxDurationMs: null,
    statuses: [],
    fullText: null,
  };

  // Normalise: remove AND keyword (implicit), split on whitespace outside quotes
  const tokens = tokenise(raw);

  const freeText: string[] = [];

  for (const token of tokens) {
    // level:error
    const levelMatch = token.match(/^level:(.+)$/i);
    if (levelMatch) {
      result.levels.push(levelMatch[1].toLowerCase());
      continue;
    }

    // route:/api/foo/*
    const routeMatch = token.match(/^route:(.+)$/i);
    if (routeMatch) {
      result.routes.push(routeMatch[1]);
      continue;
    }

    // duration>2s / duration>500ms
    const durationGtMatch = token.match(/^duration>(\d+)(ms|s|m)?$/i);
    if (durationGtMatch) {
      result.minDurationMs = parseDuration(durationGtMatch[1], durationGtMatch[2] ?? 'ms');
      continue;
    }
    const durationLtMatch = token.match(/^duration<(\d+)(ms|s|m)?$/i);
    if (durationLtMatch) {
      result.maxDurationMs = parseDuration(durationLtMatch[1], durationLtMatch[2] ?? 'ms');
      continue;
    }

    // status:500
    const statusMatch = token.match(/^status:(\d{3})$/i);
    if (statusMatch) {
      result.statuses.push(Number(statusMatch[1]));
      continue;
    }

    // Anything else is free-text FTS search
    if (token && token !== 'AND' && token !== 'OR') {
      freeText.push(token.replace(/^"|"$/g, ''));
    }
  }

  result.fullText = freeText.length > 0 ? freeText.join(' ') : null;
  return result;
}

/** Build a D1-compatible SQL WHERE clause + bindings from a parsed query. */
export function buildWhereClause(q: ParsedQuery, range: string = '24h'): { where: string; bindings: (string | number)[] } {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  // Time range
  const rangeMap: Record<string, string> = {
    '1h': '-1 hours', '6h': '-6 hours', '24h': '-24 hours',
    '7d': '-7 days', '30d': '-30 days',
  };
  const rangeExpr = rangeMap[range] ?? '-24 hours';
  conditions.push(`ts >= datetime('now', '${rangeExpr}')`);

  // Levels
  if (q.levels.length > 0) {
    const placeholders = q.levels.map(() => '?').join(', ');
    conditions.push(`level IN (${placeholders})`);
    bindings.push(...q.levels);
  }

  // Routes (glob → LIKE)
  if (q.routes.length > 0) {
    const routeClauses = q.routes.map(() => 'route LIKE ?');
    conditions.push(`(${routeClauses.join(' OR ')})`);
    bindings.push(...q.routes.map((r) => r.replace(/\*/g, '%').replace(/\?/g, '_')));
  }

  // Duration
  if (q.minDurationMs !== null) {
    conditions.push('duration_ms >= ?');
    bindings.push(q.minDurationMs);
  }
  if (q.maxDurationMs !== null) {
    conditions.push('duration_ms <= ?');
    bindings.push(q.maxDurationMs);
  }

  // Status
  if (q.statuses.length > 0) {
    const placeholders = q.statuses.map(() => '?').join(', ');
    conditions.push(`status IN (${placeholders})`);
    bindings.push(...q.statuses);
  }

  // Full-text (FTS5 via sub-select)
  if (q.fullText) {
    conditions.push(`rowid IN (SELECT rowid FROM worker_logs_fts WHERE worker_logs_fts MATCH ?)`);
    bindings.push(q.fullText);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    bindings,
  };
}

/** Parse a duration value to milliseconds. */
function parseDuration(value: string, unit: string): number {
  const n = Number(value);
  switch (unit.toLowerCase()) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    default: return n; // ms
  }
}

/** Tokenise a DSL string respecting quoted phrases. */
function tokenise(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;

  for (const char of raw) {
    if (char === '"') {
      inQuote = !inQuote;
      current += char;
    } else if (char === ' ' && !inQuote) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens.filter((t) => t.length > 0);
}
