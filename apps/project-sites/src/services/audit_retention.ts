/**
 * @module services/audit_retention
 * @description Pure zero-I/O audit log retention policy engine. Computes
 * deletion windows and expiry states for audit events using configurable
 * per-action retention rules. Never throws, never touches I/O.
 *
 * @packageDocumentation
 */

/** A recognized audit action type. */
export type AuditAction =
  | 'sign_in'
  | 'sign_out'
  | 'site_create'
  | 'site_delete'
  | 'billing_change'
  | 'domain_add'
  | 'api_call'
  | 'flag_change';

/** One retention policy entry — how long to keep events of this action. */
export interface RetentionRule {
  /** The action this rule applies to, or '*' for the catch-all default. */
  readonly action: AuditAction | '*';
  /** How many days to retain. 0 = delete immediately. */
  readonly retainDays: number;
}

/**
 * Default retention rules.
 *
 * | action | retainDays |
 * |---|---|
 * | sign_in | 90 |
 * | billing_change | 365 |
 * | site_delete | 30 |
 * | api_call | 30 |
 * | * (default) | 180 |
 */
export const DEFAULT_RULES: readonly RetentionRule[] = Object.freeze([
  { action: 'sign_in', retainDays: 90 },
  { action: 'billing_change', retainDays: 365 },
  { action: 'site_delete', retainDays: 30 },
  { action: 'api_call', retainDays: 30 },
  { action: '*', retainDays: 180 },
]);

/** The result of checking retention for one audit event. */
export interface RetentionCheck {
  /** The action name that was checked (matches input). */
  readonly action: string;
  /** ISO 8601 timestamp of when the event was logged. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of when the event should be deleted. */
  readonly expiresAt: string;
  /** Number of days the event is retained (from the matched rule). */
  readonly retainDays: number;
  /** True if the event has passed its retention window. */
  readonly expired: boolean;
}

/**
 * Resolve the matching rule for an action. Tries an exact match first
 * (comparing the full action string against each rule's action), then
 * falls back to the '*' catch-all rule. Returns undefined if neither
 * exists (should not happen when DEFAULT_RULES are in use).
 *
 * @param action - The audit action name to match.
 * @param rules - Retention rules to search (defaults to {@link DEFAULT_RULES}).
 * @returns The matching rule, or undefined if no rule applies.
 */
function resolveRule(action: string, rules: readonly RetentionRule[]): RetentionRule | undefined {
  // Exact match first, then fall back to '*'
  for (const rule of rules) {
    if (rule.action === action) return rule;
  }
  for (const rule of rules) {
    if (rule.action === '*') return rule;
  }
  return undefined;
}

/**
 * Parse an ISO 8601 string as UTC epoch ms. Returns NaN for invalid input.
 * Pure — never throws.
 *
 * @param iso - ISO 8601 date string.
 * @returns Epoch milliseconds, or NaN if unparseable.
 */
function parseIsoMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Format epoch ms to an ISO 8601 string. Pure.
 *
 * @param ms - Epoch milliseconds.
 * @returns ISO 8601 date string (UTC).
 */
function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Compute retention for a single audit event.
 *
 * Matches the action against the provided rules (exact match first, then
 * '*' catch-all). When retainDays is 0, the event is expired immediately
 * (expiresAt equals createdAt). Invalid/unparseable `createdAt` values
 * are treated as "never expires" (expiresAt = '2999-12-31T23:59:59.999Z')
 * and `expired` is always false — preserving the record rather than
 * accidentally deleting it.
 *
 * @param action - The audit action name.
 * @param createdAt - ISO 8601 timestamp of when the event was logged.
 * @param rules - Retention rules (defaults to {@link DEFAULT_RULES}).
 * @param nowMs - Current wall-clock time epoch ms (defaults to Date.now()).
 * @returns The {@link RetentionCheck} assessment.
 *
 * @example
 * checkRetention('sign_in', '2026-06-01T12:00:00.000Z');
 * // → { action: 'sign_in', createdAt: '2026-06-01T12:00:00.000Z',
 * //     expiresAt: '2026-08-30T12:00:00.000Z', retainDays: 90, expired: true }
 */
export function checkRetention(
  action: string,
  createdAt: string,
  rules?: readonly RetentionRule[],
  nowMs?: number,
): RetentionCheck {
  const ruleSet = rules ?? DEFAULT_RULES;
  const now = nowMs ?? Date.now();
  const createdMs = parseIsoMs(createdAt);

  // Unparseable date — never expire (safety: preserve the record).
  if (!Number.isFinite(createdMs)) {
    return {
      action,
      createdAt,
      expired: false,
      expiresAt: '2999-12-31T23:59:59.999Z',
      retainDays: Number.MAX_SAFE_INTEGER,
    };
  }

  const rule = resolveRule(action, ruleSet);
  const retainDays = rule?.retainDays ?? 180;

  if (retainDays === 0) {
    // Delete immediately — expiresAt equals createdAt.
    return {
      action,
      createdAt,
      expired: true,
      expiresAt: createdAt,
      retainDays: 0,
    };
  }

  const expiresMs = createdMs + retainDays * 86_400_000;
  const expired = now > expiresMs;

  return {
    action,
    createdAt,
    expired,
    expiresAt: formatIso(expiresMs),
    retainDays,
  };
}

/**
 * Filter a list of audit events to those that should be deleted (expired).
 * Returns array indexes (position within the input array) of every expired
 * event. When an event has an unparseable `createdAt`, it is never returned
 * as expired (safety: preserve the record rather than accidentally deleting).
 *
 * @param events - Array of audit events (each with action + ISO createdAt).
 * @param rules - Retention rules (defaults to {@link DEFAULT_RULES}).
 * @param nowMs - Current wall-clock time epoch ms (defaults to Date.now()).
 * @returns Array of indexes into the input that are expired and should be deleted.
 *
 * @example
 * expiredEvents([
 *   { action: 'sign_in', createdAt: '2026-06-01T12:00:00.000Z' },
 *   { action: 'billing_change', createdAt: '2026-06-28T12:00:00.000Z' },
 * ]);
 * // → [0]  (sign_in expired after 90d, billing_change still within 365d)
 */
export function expiredEvents(
  events: readonly { action: string; createdAt: string }[],
  rules?: readonly RetentionRule[],
  nowMs?: number,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const check = checkRetention(events[i]!.action, events[i]!.createdAt, rules, nowMs);
    if (check.expired) {
      result.push(i);
    }
  }
  return result;
}

/**
 * Format the retention policy as a human-readable summary string. Lists
 * each rule (action → N days) with the catch-all '*' listed last. When no
 * rules are provided, uses {@link DEFAULT_RULES}.
 *
 * @param rules - Retention rules to summarise (defaults to {@link DEFAULT_RULES}).
 * @returns A human-readable summary string.
 *
 * @example
 * policySummary();
 * // → "sign_in: 90 days | billing_change: 365 days | site_delete: 30 days | api_call: 30 days | default: 180 days"
 */
export function policySummary(rules?: readonly RetentionRule[]): string {
  const ruleSet = rules ?? DEFAULT_RULES;
  const parts: string[] = [];

  // Non-catch-all rules first, then catch-all.
  const specific = ruleSet.filter((r) => r.action !== '*');
  const fallback = ruleSet.filter((r) => r.action === '*');

  for (const rule of [...specific, ...fallback]) {
    const label = rule.action === '*' ? 'default' : rule.action;
    if (rule.retainDays === 0) {
      parts.push(`${label}: delete immediately`);
    } else if (rule.retainDays === 1) {
      parts.push(`${label}: 1 day`);
    } else {
      parts.push(`${label}: ${rule.retainDays} days`);
    }
  }

  return parts.join(' | ');
}
