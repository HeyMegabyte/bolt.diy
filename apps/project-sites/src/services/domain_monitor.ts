/**
 * @module services/domain_monitor
 * @description Domain health checker — pure functions for expiry, SSL, and DNS
 * propagation assessment. No network calls; accepts pre-fetched data via options.
 *
 * Used as the functional gate before domain-renewal workflows and SSL-expiry
 * alerting. The orchestrator is responsible for actually fetching WHOIS expiry,
 * SSL certificate dates, and DNS records; this module scores them.
 *
 * @packageDocumentation
 */

/** Full health assessment for one domain. */
export interface DomainHealth {
  /** The domain being checked (lowercase, normalized). */
  domain: string;
  /** ISO 8601 timestamp of the domain/SSL expiry, or null if unknown. */
  expiresAt: string | null;
  /** Whole days until expiry (negative = already expired), or null if unknown. */
  daysUntilExpiry: number | null;
  /** True when the SSL certificate (if provided) is still valid. */
  sslValid: boolean;
  /** True when at least one DNS record was found. */
  dnsOk: boolean;
  /** Human-readable issues; empty when the domain is fully healthy. */
  issues: string[];
}

/** Renewal window thresholds in days before expiry. */
export const RENEWAL_WINDOWS = { critical: 7, warning: 30 } as const;

/** Expiry warning severity level. */
export type WarningLevel = 'ok' | 'warning' | 'critical';

/** Warning message for a given days-until-expiry value. */
export interface ExpiryWarning {
  level: WarningLevel;
  message: string;
}

/**
 * Evaluate the warning level and message for a domain's time-until-expiry.
 * Pure; never throws.
 *
 * - `>30 days` → ok
 * - `7–30 days` → warning
 * - `<7 days` → critical
 * - `null` → ok (unknown expiry)
 *
 * @param daysUntil - Whole days until expiry (negative = already expired), or null.
 * @returns The severity level and human-readable message.
 *
 * @example
 * expiryWarning(45);
 * // → { level: 'ok', message: 'Domain expires in 45 days' }
 *
 * @example
 * expiryWarning(14);
 * // → { level: 'warning', message: 'Domain expires in 14 days — renew soon' }
 *
 * @example
 * expiryWarning(3);
 * // → { level: 'critical', message: 'Domain expires in 3 days — renew immediately' }
 *
 * @example
 * expiryWarning(-5);
 * // → { level: 'critical', message: 'Domain expired 5 days ago' }
 */
export function expiryWarning(daysUntil: number | null): ExpiryWarning {
  if (daysUntil === null) {
    return { level: 'ok', message: 'Expiry date unknown' };
  }

  if (daysUntil < 0) {
    const absDays = Math.abs(daysUntil);
    return {
      level: 'critical',
      message: `Domain expired ${absDays} day${absDays === 1 ? '' : 's'} ago`,
    };
  }

  if (daysUntil < RENEWAL_WINDOWS.critical) {
    return {
      level: 'critical',
      message: `Domain expires in ${daysUntil} day${daysUntil === 1 ? '' : 's'} — renew immediately`,
    };
  }

  if (daysUntil <= RENEWAL_WINDOWS.warning) {
    return {
      level: 'warning',
      message: `Domain expires in ${daysUntil} day${daysUntil === 1 ? '' : 's'} — renew soon`,
    };
  }

  return {
    level: 'ok',
    message: `Domain expires in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
  };
}

/**
 * Normalize a date-like value to an ISO 8601 string, or null.
 *
 * @param raw - A date string or Date, or null/undefined.
 * @returns ISO 8601 string, or null.
 */
function toIsoString(raw: string | Date | null | undefined): string | null {
  if (!raw) return null;
  const d = typeof raw === 'string' ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Compute whole days between now and a target date. Negative = past.
 *
 * @param raw - A date string or Date.
 * @returns Whole days (rounded down), or null if the date is unparseable.
 */
function daysUntil(raw: string | Date | null | undefined): number | null {
  if (!raw) return null;
  const d = typeof raw === 'string' ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.floor(ms / 86_400_000);
}

/**
 * Assess a domain's health from pre-fetched expiry and DNS data. Pure +
 * deterministic; never throws.
 *
 * @param domain - The domain name (e.g. `example.com`).
 * @param opts - Optional data from external sources.
 * @param opts.sslExpiry - SSL certificate expiry date string (ISO 8601 or any `new Date()`-parseable format).
 * @param opts.dnsRecords - DNS record strings (e.g. `['A 93.184.216.34']`). Non-empty = DNS ok.
 * @param opts.whoisExpiry - Domain registration expiry date string.
 * @returns The {@link DomainHealth} assessment.
 *
 * @example
 * checkDomainHealth('example.com', {
 *   sslExpiry: '2026-08-15T00:00:00Z',
 *   dnsRecords: ['A 93.184.216.34'],
 *   whoisExpiry: '2027-06-29T00:00:00Z',
 * });
 * // → { domain: 'example.com', expiresAt: '...', daysUntilExpiry: ..., sslValid: true, dnsOk: true, issues: [] }
 */
export function checkDomainHealth(
  domain: string,
  opts: {
    sslExpiry?: string | Date | null;
    dnsRecords?: string[] | null;
    whoisExpiry?: string | Date | null;
  } = {},
): DomainHealth {
  const normalizedDomain = domain.trim().toLowerCase();

  // Use the earlier of whoisExpiry and sslExpiry for the overall expiry signal.
  const whoisIso = toIsoString(opts.whoisExpiry ?? null);
  const sslIso = toIsoString(opts.sslExpiry ?? null);
  const whoisDays = daysUntil(opts.whoisExpiry ?? null);
  const sslDays = daysUntil(opts.sslExpiry ?? null);

  // The "expires at" is the EARLIER of the two expiry dates (whichever hits first).
  const expiresAt =
    sslIso && whoisIso ? (sslIso < whoisIso ? sslIso : whoisIso) : (sslIso ?? whoisIso ?? null);

  // daysUntilExpiry is the smaller (more urgent) of the two.
  const daysUntilExpiry =
    sslDays !== null && whoisDays !== null
      ? Math.min(sslDays, whoisDays)
      : (sslDays ?? whoisDays ?? null);

  // SSL is valid only when the cert expiry is in the future (if provided).
  const sslValid = sslDays === null || sslDays > 0;

  // DNS is ok when at least one record was found.
  const dnsRecords = opts.dnsRecords ?? [];
  const dnsOk = dnsRecords.length > 0;

  const issues: string[] = [];

  if (!normalizedDomain) {
    return {
      daysUntilExpiry: null,
      dnsOk: false,
      domain: normalizedDomain,
      expiresAt: null,
      issues: ['domain name is empty'],
      sslValid: false,
    };
  }

  if (whoisDays !== null && whoisDays <= 0) {
    issues.push('domain registration has expired');
  }

  if (sslDays !== null && sslDays <= 0) {
    issues.push('SSL certificate has expired');
  } else if (sslDays !== null && sslDays <= RENEWAL_WINDOWS.critical) {
    issues.push('SSL certificate expires within 7 days');
  } else if (sslDays !== null && sslDays <= RENEWAL_WINDOWS.warning) {
    issues.push('SSL certificate expires within 30 days');
  }

  if (!dnsOk) {
    issues.push('no DNS records found');
  }

  return {
    daysUntilExpiry,
    dnsOk,
    domain: normalizedDomain,
    expiresAt,
    issues,
    sslValid,
  };
}
