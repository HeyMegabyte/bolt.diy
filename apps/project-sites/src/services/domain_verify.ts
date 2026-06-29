/**
 * @module services/domain_verify
 * @description Pure functions for DNS verification and propagation checking.
 * Provides a simple interface for comparing expected DNS values against actual
 * values, aggregating propagation checks, and formatting human-readable status
 * reports. No I/O, no clock, never throws.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The result of verifying a single DNS record against an expected value. */
export interface DnsVerificationResult {
  readonly domain: string;
  readonly type: string;
  readonly expected: string;
  readonly actual: string | null;
  /** True when actual matches expected exactly (or is an acceptable substring for TXT). */
  readonly matched: boolean;
}

/** A single propagation check — whether a DNS record has propagated. */
export interface PropagationCheck {
  readonly domain: string;
  readonly type: string;
  readonly name: string;
  readonly expectedValue: string;
  readonly actualValue: string | null;
  readonly propagated: boolean;
}

/** Aggregate summary of a set of propagation checks. */
export interface PropagationSummary {
  readonly total: number;
  readonly propagated: number;
  readonly pending: number;
  readonly allPropagated: boolean;
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether an actual DNS value matches an expected value, accounting
 * for DNS value normalization. Pure; never throws.
 *
 * Matching rules:
 * - **A / AAAA** — exact IP match.
 * - **CNAME** — case-insensitive hostname match (trailing dot stripped).
 * - **MX** — exchange hostname match (ignore priority prefix).
 * - **TXT** — `expectedValue` is a substring of actual (SPF/DKIM/DMARC values
 *   often have additional attributes appended).
 *
 * @param type - DNS record type (e.g. 'A', 'CNAME', 'MX', 'TXT').
 * @param expected - The value the record SHOULD have.
 * @param actual - The value returned by DNS, or null if absent.
 * @returns `true` when the values match per the type-specific rules.
 *
 * @example
 * valuesMatch('A', '104.16.0.1', '104.16.0.1');
 * // → true
 *
 * @example
 * valuesMatch('TXT', 'v=spf1', 'v=spf1 include:amazonses.com ~all');
 * // → true
 *
 * @example
 * valuesMatch('CNAME', 'example.com', 'Example.Com.');
 * // → true
 */
export function valuesMatch(type: string, expected: string, actual: string): boolean {
  switch (type.toUpperCase()) {
    case 'A':
    case 'AAAA': {
      // Exact IP match
      return actual === expected;
    }

    case 'CNAME': {
      // Case-insensitive hostname, ignore trailing dot
      const a = actual.replace(/\.+$/, '').toLowerCase();
      const e = expected.replace(/\.+$/, '').toLowerCase();
      return a === e;
    }

    case 'MX': {
      // Compare exchange hostname (last space-separated token), ignore priority
      const mxValue = actual.split(/\s+/).pop() ?? '';
      const a = mxValue.replace(/\.+$/, '').toLowerCase();
      const e = expected.replace(/\.+$/, '').toLowerCase();
      return a === e;
    }

    case 'TXT': {
      // Substring presence — SPF / DKIM / DMARC values often have extra attributes
      return actual.includes(expected);
    }

    default: {
      // Fallback: exact match
      return actual === expected;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify a single DNS record against an expected value. Returns a
 * {@link DnsVerificationResult} with `matched` set based on type-aware
 * comparison. Pure; never throws.
 *
 * @param domain - The fully-qualified domain name (e.g. 'example.com').
 * @param type - DNS record type (e.g. 'A', 'CNAME', 'MX', 'TXT').
 * @param expected - The value the record SHOULD have.
 * @param actual - The value returned by a DNS lookup, or `null` if the
 *   record was not found.
 * @returns A verification result with `matched` set per type-aware rules.
 *
 * @example
 * verifyDnsRecord('example.com', 'A', '104.16.0.1', '104.16.0.1');
 * // → { domain: 'example.com', type: 'A', expected: '104.16.0.1',
 * //     actual: '104.16.0.1', matched: true }
 *
 * @example
 * verifyDnsRecord('example.com', 'A', '104.16.0.1', null);
 * // → { domain: 'example.com', type: 'A', expected: '104.16.0.1',
 * //     actual: null, matched: false }
 *
 * @example
 * verifyDnsRecord('example.com', 'TXT', 'v=spf1', 'v=spf1 include:amazonses.com ~all');
 * // → { domain: 'example.com', type: 'TXT', expected: 'v=spf1',
 * //     actual: 'v=spf1 include:amazonses.com ~all', matched: true }
 */
export function verifyDnsRecord(
  domain: string,
  type: string,
  expected: string,
  actual: string | null,
): DnsVerificationResult {
  if (actual === null) {
    return { actual: null, domain, expected, matched: false, type };
  }
  const matched = valuesMatch(type, expected, actual);
  return { actual, domain, expected, matched, type };
}

/**
 * Check a list of DNS propagation checks and return an aggregate summary.
 * Pure; never throws. An empty input returns a summary with zero counts and
 * `allPropagated: true`.
 *
 * @param checks - The list of propagation checks.
 * @returns A {@link PropagationSummary} with counts and an `allPropagated`
 *   flag that is `true` only when every check is propagated.
 *
 * @example
 * checkPropagation([
 *   { domain: 'example.com', type: 'A', name: 'example.com',
 *     expectedValue: '104.16.0.1', actualValue: '104.16.0.1', propagated: true },
 *   { domain: 'example.com', type: 'MX', name: 'example.com',
 *     expectedValue: 'mail.example.com', actualValue: null, propagated: false },
 * ]);
 * // → { total: 2, propagated: 1, pending: 1, allPropagated: false }
 */
export function checkPropagation(checks: readonly PropagationCheck[]): PropagationSummary {
  const total = checks.length;
  const propagated = checks.filter((c) => c.propagated).length;
  const pending = total - propagated;
  return { allPropagated: pending === 0, pending, propagated, total };
}

/**
 * Format a list of propagation checks into a human-readable status string.
 * Pure; never throws.
 *
 * The output has one line per check plus a summary line:
 * ```
 * ✓ A    example.com        → propagated
 * ✗ MX   example.com        → pending (expected: mail.example.com)
 * ✓ TXT  _dmarc.example.com → propagated
 * Propagation: 2 propagated, 1 pending — 3 total
 * ```
 *
 * @param checks - The list of propagation checks.
 * @returns A formatted multi-line string.
 *
 * @example
 * propagationStatus([
 *   { domain: 'example.com', type: 'A', name: 'example.com',
 *     expectedValue: '104.16.0.1', actualValue: '104.16.0.1', propagated: true },
 * ]);
 * // → "✓ A    example.com        → propagated\nPropagation: 1 propagated, 0 pending — 1 total"
 */
export function propagationStatus(checks: readonly PropagationCheck[]): string {
  if (checks.length === 0) {
    return 'Propagation: 0 propagated, 0 pending — 0 total';
  }

  const lines: string[] = [];

  for (const check of checks) {
    const symbol = check.propagated ? '✓' : '✗';
    const status = check.propagated
      ? '→ propagated'
      : check.actualValue === null
        ? '→ pending (not found in DNS)'
        : `→ pending (expected: ${check.expectedValue})`;

    const type = check.type.padEnd(6);
    const name = check.name.padEnd(24).slice(0, 24);
    lines.push(`${symbol} ${type}${name} ${status}`);
  }

  const { pending, propagated, total } = checkPropagation(checks);
  lines.push(`Propagation: ${propagated} propagated, ${pending} pending — ${total} total`);

  return lines.join('\n');
}
