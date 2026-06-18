/**
 * @module libs/features/audit_trail_export/service
 * @description Business logic for the audit_trail_export feature.
 * SQL builder for filtering audit_logs rows and a pure CSV serializer.
 * No I/O — fully testable.
 */

import type { AuditExportQuery, AuditLogEntry } from './schemas.js';

/** Feature flag key that gates this feature. */
export const FLAG_KEY = 'audit_trail_export';

/**
 * Builds the parameterized SQL query and params array for the audit export.
 * Always includes `org_id = ?` as the first filter — it is never omitted.
 *
 * @param orgId - The authenticated caller's org ID (D1 UUID).
 * @param query - Validated query params from {@link AuditExportQuerySchema}.
 * @returns `{ sql, params }` ready for `dbQuery(db, sql, params)`.
 *
 * @example
 * const { sql, params } = buildAuditQuery('org-001', { limit: 50, format: 'json' });
 */
export function buildAuditQuery(
  orgId: string,
  query: AuditExportQuery,
): { sql: string; params: (string | number)[] } {
  const conditions: string[] = ['org_id = ?'];
  const params: (string | number)[] = [orgId];

  if (query.action !== undefined) {
    conditions.push('action = ?');
    params.push(query.action);
  }
  if (query.from !== undefined) {
    conditions.push('created_at >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined) {
    conditions.push('created_at <= ?');
    params.push(query.to);
  }

  params.push(query.limit);

  const sql = `
    SELECT id, org_id, actor_id, action, target_type, target_id, request_id, created_at
    FROM audit_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ?
  `.trim();

  return { sql, params };
}

/**
 * Serializes an array of audit log rows to RFC 4180 CSV.
 * Escapes double-quotes, commas, and newlines per the spec.
 *
 * @param rows - Array of audit log record objects.
 * @returns Full CSV string including header row.
 *
 * @example
 * const csv = rowsToCsv([{ id: '1', org_id: 'o', actor_id: null, action: 'site.created',
 *   target_type: 'site', target_id: 's1', request_id: null, created_at: '2026-06-18T00:00:00Z' }]);
 */
export function rowsToCsv(rows: AuditLogEntry[]): string {
  const COLUMNS: (keyof AuditLogEntry)[] = [
    'id',
    'org_id',
    'actor_id',
    'action',
    'target_type',
    'target_id',
    'request_id',
    'created_at',
  ];

  const escapeCell = (value: string | null | undefined): string => {
    const str = value === null || value === undefined ? '' : String(value);
    // RFC 4180: wrap in quotes if contains comma, double-quote, CR, or LF
    if (str.includes('"') || str.includes(',') || str.includes('\r') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = COLUMNS.join(',');
  const lines = rows.map((row) =>
    COLUMNS.map((col) => escapeCell(row[col] as string | null)).join(','),
  );

  return [header, ...lines].join('\r\n');
}
