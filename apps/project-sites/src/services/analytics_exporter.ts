/**
 * @module services/analytics_exporter
 *
 * @description
 * Pure helpers for building analytics export filenames and D1 queries.
 * No I/O — filename generation and query construction from typed specs only.
 *
 * @see services/analytics.ts (event capture — counterpart capture module)
 */

/** Supported export output formats. */
export type ExportFormat = 'csv' | 'json' | 'pdf_summary';

/** A typed export request descriptor. */
export interface ExportSpec {
  readonly format: ExportFormat;
  readonly siteId: string;
  readonly dateRange: { readonly start: string; readonly end: string };
  readonly metrics: readonly string[];
}

/** All accepted export formats, ordered by likelihood. */
export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'json', 'pdf_summary'] as const;

/** Internal map from abstract format to file extension. */
const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  csv: 'csv',
  json: 'json',
  pdf_summary: 'pdf',
} as const;

/**
 * Build a download-friendly filename from an export spec.
 *
 * Sanitises siteId (alphanumerics + hyphens only), joins the requested metrics
 * with underscores, and appends the date-window and format extension.
 *
 * @param spec - The export specification.
 * @returns A filename string, e.g. `my-site_visits-pageviews_2026-01-01_to_2026-06-01.csv`.
 *
 * @example
 * buildExportFilename({
 *   format: 'csv',
 *   siteId: 'my-site_1',
 *   dateRange: { start: '2026-01-01', end: '2026-06-01' },
 *   metrics: ['visits', 'pageviews'],
 * });
 * // → 'my-site-1_visits_pageviews_2026-01-01_to_2026-06-01.csv'
 */
export function buildExportFilename(spec: ExportSpec): string {
  const sitePart = spec.siteId.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'site';
  const metricsPart = spec.metrics.join('_');
  const datePart = `${spec.dateRange.start}_to_${spec.dateRange.end}`;
  const ext = FORMAT_EXTENSIONS[spec.format];
  return `${sitePart}_${metricsPart}_${datePart}.${ext}`;
}

/**
 * Build a D1 query descriptor for an analytics export.
 *
 * Returns the target table, the column projection, a `WHERE` clause with
 * positional `?` placeholders (D1-compatible), and the bound parameter values.
 * The format parameter determines the table selection; csv and json both query
 * `analytics_daily`, while pdf_summary queries a pre-aggregated summary.
 *
 * @param spec - The export specification.
 * @returns A query descriptor shaped for `dbQuery<Row>(db, sql, params)`.
 *
 * @example
 * buildExportQuery({
 *   format: 'csv',
 *   siteId: 'abc123',
 *   dateRange: { start: '2026-01-01', end: '2026-01-31' },
 *   metrics: ['visits', 'pageviews'],
 * });
 * // → {
 * //     table: 'analytics_daily',
 * //     columns: ['date', 'visits', 'pageviews'],
 * //     where: 'site_id = ? AND date BETWEEN ? AND ?',
 * //     params: ['abc123', '2026-01-01', '2026-01-31'],
 * //   }
 */
export function buildExportQuery(spec: ExportSpec): {
  table: string;
  columns: string[];
  where: string;
  params: unknown[];
} {
  const table = 'analytics_daily';
  const columns = ['date', ...spec.metrics];
  const where = 'site_id = ? AND date BETWEEN ? AND ?';
  const params: unknown[] = [spec.siteId, spec.dateRange.start, spec.dateRange.end];
  return { columns, params, table, where };
}
