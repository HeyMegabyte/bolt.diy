/**
 * @module libs/features/data_export/service
 * @description CSV export of an org's contacts (data portability). Reads
 * `contacts` (written by contacts_core) — 4th read-consumer of the foundation.
 *
 * CSV correctness is the point here:
 * - RFC4180 quoting (fields with `" , \n \r` are double-quoted + inner quotes doubled).
 * - **CSV formula-injection neutralization** (OWASP): a cell whose first char is
 *   `= + - @ \t \r` is prefixed with `'` so spreadsheet apps don't execute it.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery } from '../../../src/services/db.js';
import { CONTACT_EXPORT_COLUMNS } from './schemas.js';

/** Flag key gating this feature. */
export const FLAG_KEY = 'data_export';

/** Hard cap so a huge org can't stream an unbounded export through the Worker. */
const MAX_ROWS = 50_000;

interface ExportRow {
  email: string | null;
  name: string | null;
  phone: string | null;
  source: string;
  tags: string;
  consent_email: number;
  consent_sms: number;
  created_at: string;
  last_seen_at: string;
}

/**
 * Encode a single CSV cell: neutralize formula-injection, then RFC4180-quote.
 *
 * @remarks The injection guard runs FIRST so the leading `'` is inside the
 * quoted field; order matters for both safety and round-trippability.
 * @param value - Any cell value; nullish becomes empty string.
 * @returns A spreadsheet-safe, RFC4180-quoted cell.
 * @example
 * ```ts
 * csvCell('=1+1');      // "'=1+1"  (neutralized)
 * csvCell('a,b');       // '"a,b"'  (quoted)
 * csvCell('she "said"');// '"she ""said"""'
 * ```
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // OWASP CSV-injection guard
  if (/["\n\r,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`; // RFC4180 quoting
  return s;
}

/** Build a CSV string from a header + rows of already-stringifiable cells. */
function toCsv(header: readonly string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}

/**
 * Export an org's contacts as an RFC4180 CSV string.
 *
 * @param env    - Worker env (uses `env.DB`).
 * @param orgId  - Caller's org (export is org-scoped; cross-org is impossible).
 * @param siteId - Optional site filter.
 * @returns CSV text (header + ≤{@link MAX_ROWS} rows), `\r\n`-delimited.
 * @throws never — a query error yields a header-only CSV rather than throwing.
 */
export async function exportContactsCsv(env: Env, orgId: string, siteId?: string): Promise<string> {
  const where = ['org_id = ?', 'deleted_at IS NULL'];
  const params: unknown[] = [orgId];
  if (siteId) {
    where.push('site_id = ?');
    params.push(siteId);
  }
  const { data, error } = await dbQuery<ExportRow>(
    env.DB,
    `SELECT email, name, phone, source, tags, consent_email, consent_sms, created_at, last_seen_at
       FROM contacts WHERE ${where.join(' AND ')} ORDER BY last_seen_at DESC LIMIT ${MAX_ROWS}`,
    params,
  );
  const rows = (error ? [] : data).map((r) => {
    let tags = '';
    try {
      const arr = JSON.parse(r.tags) as unknown;
      if (Array.isArray(arr)) tags = arr.join(';');
    } catch {
      /* leave tags empty on a malformed JSON column */
    }
    return [
      r.email ?? '',
      r.name ?? '',
      r.phone ?? '',
      r.source,
      tags,
      r.consent_email === 1 ? 'true' : 'false',
      r.consent_sms === 1 ? 'true' : 'false',
      r.created_at,
      r.last_seen_at,
    ];
  });
  return toCsv(CONTACT_EXPORT_COLUMNS, rows);
}
