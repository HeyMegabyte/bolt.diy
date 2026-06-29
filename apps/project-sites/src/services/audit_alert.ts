/**
 * @module services/audit_alert
 * @description Pure in-memory alerting layer over the audit log. Compact, no DB
 * dependency — callers hold the alert array and use these helpers to create,
 * acknowledge, and filter alerts based on action-pattern severity thresholds.
 *
 * ## Severity levels
 * - `info` — operational (e.g. feature flag toggled)
 * - `warning` — needs attention soon (e.g. domain expiry)
 * - `critical` — immediate action (e.g. site deleted, billing failure)
 *
 * @example
 * ```ts
 * import { createAlert, acknowledge, filterAlerts, ALERT_THRESHOLDS } from './audit_alert.js';
 *
 * const alert = createAlert('critical', 'site.delete', 'Site "acme" was deleted', 'user_abc');
 * const acked = acknowledge(alert);
 * const criticals = filterAlerts([alert, acked], { minSeverity: 'critical' });
 * // criticals.length === 1 (the acknowledged one)
 * ```
 *
 * @packageDocumentation
 */

/** Severity levels for audit alerts. Ordered: info < warning < critical. */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/** A single alert generated from an audit event. */
export interface AuditAlert {
  /** Unique alert identifier (UUIDv7). */
  id: string;
  /** Severity level. */
  severity: AlertSeverity;
  /** Dot-namespace action that triggered the alert (e.g. `site.delete`). */
  action: string;
  /** Human-readable description of what happened. */
  message: string;
  /** ID of the user or system that performed the action. */
  actorId: string;
  /** ISO-8601 timestamp of when the alert was created. */
  timestamp: string;
  /** Whether the alert has been acknowledged by an operator. */
  acknowledged: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 2,
  info: 0,
  warning: 1,
};

/**
 * Generate a UUIDv7-style string (time-ordered) using native crypto.
 * First 48 bits = Unix ms (big-endian), next 12 bits = random sub-ms,
 * remainder = random.  Produces a valid UUIDv7 string per RFC 9562.
 *
 * @returns A UUIDv7 string.
 */
function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Timestamp (ms since epoch) — first 48 bits, big-endian
  const ts = Date.now();
  bytes[0] = (ts / 0x10000000000) & 0xff;
  bytes[1] = (ts / 0x100000000) & 0xff;
  bytes[2] = (ts / 0x1000000) & 0xff;
  bytes[3] = (ts / 0x10000) & 0xff;
  bytes[4] = (ts / 0x100) & 0xff;
  bytes[5] = ts & 0xff;

  // Version nibble = 7
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  // Variant nibble = 10xx
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/**
 * Create a new unacknowledged alert with a UUIDv7 id and the current timestamp.
 *
 * @param severity - Severity of the alert.
 * @param action - Dot-namespace action string.
 * @param message - Human-readable description.
 * @param actorId - ID of the user or system that triggered it.
 * @returns A new AuditAlert with `acknowledged: false`.
 *
 * @example
 * ```ts
 * const alert = createAlert('warning', 'domain.expiry', 'Domain acme.com expires in 7 days', 'sys');
 * // alert.id is UUIDv7, alert.timestamp is ISO-8601
 * ```
 */
export function createAlert(
  severity: AlertSeverity,
  action: string,
  message: string,
  actorId: string,
): AuditAlert {
  return {
    acknowledged: false,
    action,
    actorId,
    id: uuidv7(),
    message,
    severity,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Return a copy of `alert` with `acknowledged` set to `true`.
 * The original object is not mutated.
 *
 * @param alert - The alert to acknowledge.
 * @returns A new AuditAlert with acknowledged = true.
 *
 * @example
 * ```ts
 * const acked = acknowledge(alert);
 * ```
 */
export function acknowledge(alert: AuditAlert): AuditAlert {
  return { ...alert, acknowledged: true };
}

/**
 * Filter an array of alerts by minimum severity and/or acknowledged status.
 * All filters are optional; omit a field to leave that dimension un-filtered.
 *
 * Severity order: info (0) < warning (1) < critical (2).
 * Passing `minSeverity: 'warning'` includes warning and critical alerts only.
 *
 * @param alerts - Source array of alerts (not mutated).
 * @param opts - Filter options.
 * @param opts.minSeverity - Minimum severity to include (inclusive).
 * @param opts.acknowledged - If true, only acknowledged; if false, only unacknowledged; omit for both.
 * @returns Filtered array (new reference).
 *
 * @example
 * ```ts
 * const unacked = filterAlerts(allAlerts, { acknowledged: false });
 * const criticalUnacked = filterAlerts(allAlerts, { minSeverity: 'critical', acknowledged: false });
 * ```
 */
export function filterAlerts(
  alerts: readonly AuditAlert[],
  opts: { minSeverity?: AlertSeverity; acknowledged?: boolean },
): AuditAlert[] {
  return alerts.filter((a) => {
    if (
      opts.minSeverity !== undefined &&
      SEVERITY_RANK[a.severity] < SEVERITY_RANK[opts.minSeverity]
    ) {
      return false;
    }
    if (opts.acknowledged !== undefined && a.acknowledged !== opts.acknowledged) {
      return false;
    }
    return true;
  });
}

/**
 * Default alert thresholds mapping action patterns to severities.
 *
 * - `billing.*` — critical: payment failures affect service continuity
 * - `site.delete` — critical: irreversible data loss
 * - `domain.*` — warning: DNS / expiry issues degrade but don't break
 * - `flag.*` — info: feature-flag toggles are operational, not urgent
 *
 * Callers may extend or override per-installation.
 */
export const ALERT_THRESHOLDS: Record<string, AlertSeverity> = {
  'billing.*': 'critical',
  'domain.*': 'warning',
  'flag.*': 'info',
  'site.delete': 'critical',
};
