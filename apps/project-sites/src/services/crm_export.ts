/**
 * @module services/crm_export
 *
 * @description
 * Pure helpers for building CRM export metadata and filenames for GDPR
 * data portability. No I/O — only typed construction from given parameters.
 *
 * @see services/analytics_exporter.ts (sibling — same shape for different domain)
 */

/** Available CRM data scopes for export. */
export type ExportScope = 'contact' | 'company' | 'deals' | 'full';

/** A complete CRM export descriptor returned by {@link buildExport}. */
export interface CrmExport {
  readonly userId: string;
  readonly scope: ExportScope;
  readonly format: 'json' | 'csv';
  readonly fileCount: number;
  readonly totalSizeBytes: number;
}

/** All valid export formats, ordered by likelihood. */
export const EXPORT_FORMATS: readonly ('json' | 'csv')[] = ['json', 'csv'] as const;

/** Internal map: scope → estimated file count. */
const SCOPE_FILE_COUNTS: Record<ExportScope, number> = {
  company: 1,
  contact: 1,
  deals: 2,
  full: 5,
} as const;

/** Internal map: scope → estimated total payload in bytes. */
const SCOPE_SIZE_BYTES: Record<ExportScope, number> = {
  company: 2_048,
  contact: 5_120,
  deals: 10_240,
  full: 51_200,
} as const;

/** Internal map: abstract format to file extension. */
const FORMAT_EXTENSIONS: Record<string, string> = {
  csv: 'csv',
  json: 'json',
} as const;

/**
 * Build a CRM export descriptor from the given parameters.
 *
 * Returns an opaque metadata envelope with realistic file counts and size
 * estimates for the requested scope. The caller can present this to the user
 * before performing the actual export I/O.
 *
 * @param userId - The identifier of the user requesting the export.
 * @param scope  - Which data scope to export.
 * @param format - Output format; defaults to `'json'` when omitted.
 * @returns A {@link CrmExport} envelope.
 *
 * @example
 * buildExport('user_abc', 'contact', 'csv');
 * // → { userId: 'user_abc', scope: 'contact', format: 'csv', fileCount: 1, totalSizeBytes: 5120 }
 *
 * @example
 * buildExport('user_abc', 'full');
 * // → { userId: 'user_abc', scope: 'full', format: 'json', fileCount: 5, totalSizeBytes: 51200 }
 */
export function buildExport(
  userId: string,
  scope: ExportScope,
  format: 'json' | 'csv' = 'json',
): CrmExport {
  return {
    fileCount: SCOPE_FILE_COUNTS[scope],
    format,
    scope,
    totalSizeBytes: SCOPE_SIZE_BYTES[scope],
    userId,
  };
}

/**
 * Build a download-friendly filename for a CRM export.
 *
 * Sanitises userId (alphanumerics + hyphens only), uses the scope as the
 * content descriptor, appends today's date in ISO format, and the correct
 * extension for the given format.
 *
 * @param userId - The user identifier (sanitised in the output).
 * @param scope  - The export scope.
 * @param format - Output format string (`'json'` or `'csv'`).
 * @returns A filename string, e.g. `user-abc_contact_2026-06-29.json`.
 *
 * @example
 * exportFilename('user_abc', 'contact', 'json');
 * // → 'user-abc_contact_2026-06-29.json'
 *
 * @example
 * exportFilename('user_abc', 'full', 'csv');
 * // → 'user-abc_full_2026-06-29.csv'
 */
export function exportFilename(userId: string, scope: ExportScope, format: string): string {
  const safeUser = userId.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'user';
  const ext = FORMAT_EXTENSIONS[format] ?? 'json';
  const datePart = new Date().toISOString().slice(0, 10);
  return `${safeUser}_${scope}_${datePart}.${ext}`;
}
