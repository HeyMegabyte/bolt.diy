/**
 * @module services/dns_health_check
 * @description Pure functions for checking individual DNS records against
 * expected values, aggregating multiple checks into a summary, and formatting
 * a human-readable report. No I/O, no clock, never throws.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The result of comparing one expected DNS record against its actual value. */
export interface DnsRecordCheck {
  readonly type: string;
  readonly name: string;
  readonly expectedValue: string;
  readonly actualValue: string | null;
  readonly status: 'ok' | 'mismatch' | 'missing' | 'error';
}

/** Aggregate statistics over a set of checks. */
export interface AggregatedChecks {
  readonly pass: number;
  readonly fail: number;
  readonly total: number;
  readonly allOk: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare one expected DNS record against the value returned by a live DNS
 * query. Pure + deterministic; never throws.
 *
 * Status rules:
 * - `null` actual → **missing** (record not found in DNS).
 * - `expectedValue === actual` → **ok** (exact match).
 * - `expectedValue !== actual` → **mismatch** (value differs).
 * - Any other unexpected state → **error** (reserved for later expansion).
 *
 * @param type - DNS record type (e.g. 'A', 'AAAA', 'CNAME', 'MX', 'TXT').
 * @param name - Fully-qualified name of the record (e.g. 'www.example.com').
 * @param expected - The value the record SHOULD have.
 * @param actual - The value returned by DNS, or `null` if not found.
 * @returns A single {@link DnsRecordCheck} describing the outcome.
 *
 * @example
 * checkRecord('A', 'example.com', '104.16.0.1', '104.16.0.1');
 * // → { type: 'A', name: 'example.com', expectedValue: '104.16.0.1',
 * //     actualValue: '104.16.0.1', status: 'ok' }
 *
 * @example
 * checkRecord('A', 'example.com', '104.16.0.1', null);
 * // → { type: 'A', name: 'example.com', expectedValue: '104.16.0.1',
 * //     actualValue: null, status: 'missing' }
 *
 * @example
 * checkRecord('TXT', 'example.com', 'v=spf1 ~all', 'v=spf1 include:amazonses.com ~all');
 * // → { type: 'TXT', name: 'example.com', expectedValue: 'v=spf1 ~all',
 * //     actualValue: 'v=spf1 include:amazonses.com ~all', status: 'mismatch' }
 */
export function checkRecord(
  type: string,
  name: string,
  expected: string,
  actual: string | null,
): DnsRecordCheck {
  if (actual === null) {
    return { actualValue: null, expectedValue: expected, name, status: 'missing', type };
  }
  const status = expected === actual ? 'ok' : 'mismatch';
  return { actualValue: actual, expectedValue: expected, name, status, type };
}

/**
 * Aggregate a set of DNS record checks into a summary. Pure; never throws.
 *
 * @param checks - The list of check results to aggregate.
 * @returns An {@link AggregatedChecks} with pass/fail counts and an `allOk`
 *   flag that is `true` only when every check has status `'ok'`.
 *
 * @example
 * aggregateChecks([
 *   { type: 'A', name: 'example.com', expectedValue: '1.2.3.4',
 *     actualValue: '1.2.3.4', status: 'ok' },
 *   { type: 'MX', name: 'example.com', expectedValue: 'mail.example.com',
 *     actualValue: 'mail.other.com', status: 'mismatch' },
 * ]);
 * // → { pass: 1, fail: 1, total: 2, allOk: false }
 */
export function aggregateChecks(checks: readonly DnsRecordCheck[]): AggregatedChecks {
  const pass = checks.filter((c) => c.status === 'ok').length;
  const fail = checks.filter((c) => c.status !== 'ok').length;
  return { allOk: fail === 0, fail, pass, total: checks.length };
}

/**
 * Format a set of DNS record checks into a human-readable, one-line-per-record
 * report. Pure; never throws. Empty input returns a single-line summary.
 *
 * Each line has the shape:
 * ```
 * ✓ A    example.com        = 104.16.0.1
 * ✗ MX   example.com        ≠ inbound-smtp.other.com  (expected: inbound-smtp.amazonaws.com)
 * - CNAME  www.example.com  = (missing)
 * ```
 *
 * @param checks - The list of check results to format.
 * @returns A string containing the full report, with one summary line at the
 *   end: `Pass: N  Fail: N  Total: N`.
 *
 * @example
 * formatCheckReport([
 *   { type: 'A', name: 'example.com', expectedValue: '1.2.3.4',
 *     actualValue: '1.2.3.4', status: 'ok' },
 * ]);
 * // → "✓ A    example.com        = 1.2.3.4\nPass: 1  Fail: 0  Total: 1"
 */
export function formatCheckReport(checks: readonly DnsRecordCheck[]): string {
  if (checks.length === 0) {
    return 'Pass: 0  Fail: 0  Total: 0';
  }

  const lines: string[] = [];

  for (const check of checks) {
    const symbol = check.status === 'ok' ? '✓' : check.status === 'missing' ? '-' : '✗';
    const value =
      check.actualValue === null
        ? '(missing)'
        : check.status === 'ok'
          ? `= ${check.actualValue}`
          : `≠ ${check.actualValue}  (expected: ${check.expectedValue})`;

    // Pad type/name columns for aligned output
    const type = check.type.padEnd(6);
    const name = check.name.padEnd(20).slice(0, 20);
    lines.push(`${symbol} ${type}${name} ${value}`);
  }

  const { fail, pass, total } = aggregateChecks(checks);
  lines.push(`Pass: ${pass}  Fail: ${fail}  Total: ${total}`);

  return lines.join('\n');
}
