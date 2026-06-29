/**
 * @module services/site_audit
 *
 * Pure audit-record builder for per-site event history. All exports are
 * deterministic aside from the default timestamp in {@link recordAudit} (which
 * the caller can override). The module owns no I/O, no state, and no clock.
 *
 * @example
 * ```ts
 * const ev = recordAudit('site_001', 'page.published', 'user_abc');
 * // → { id: '…', siteId: 'site_001', action: 'page.published', userId: 'user_abc', timestamp: '…' }
 * ```
 */

// ---------------------------------------------------------------------------
// AuditAction — the closed set of event kinds
// ---------------------------------------------------------------------------

/** Discriminated union of every action kind the audit stream accepts. */
export const AUDIT_ACTIONS = Object.freeze([
  'site.created',
  'site.published',
  'site.archived',
  'site.deleted',
  'page.published',
  'page.unpublished',
  'domain.added',
  'domain.removed',
  'domain.verified',
  'billing.plan_changed',
  'billing.payment_failed',
  'billing.cancelled',
  'team.member_added',
  'team.member_removed',
  'team.role_changed',
  'build.started',
  'build.completed',
  'build.failed',
] as const);

/** Validates a string is a known AuditAction. */
export function isAuditAction(s: string): s is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// AuditEvent — the canonical audit record shape
// ---------------------------------------------------------------------------

/** A single entry in a site's audit history. */
export interface AuditEvent {
  /** Deterministic id — caller provides (UUIDv7 recommended). */
  id: string;
  /** The site this event belongs to. */
  siteId: string;
  /** Event kind. */
  action: AuditAction;
  /** Who performed the action. */
  userId: string;
  /** ISO 8601 UTC timestamp. */
  timestamp: string;
}

export type AuditAction =
  | 'site.created'
  | 'site.published'
  | 'site.archived'
  | 'site.deleted'
  | 'page.published'
  | 'page.unpublished'
  | 'domain.added'
  | 'domain.removed'
  | 'domain.verified'
  | 'billing.plan_changed'
  | 'billing.payment_failed'
  | 'billing.cancelled'
  | 'team.member_added'
  | 'team.member_removed'
  | 'team.role_changed'
  | 'build.started'
  | 'build.completed'
  | 'build.failed';

// ---------------------------------------------------------------------------
// recordAudit — factory
// ---------------------------------------------------------------------------

/**
 * Builds a fully-typed AuditEvent for a given site and action.
 *
 * @param siteId    - The site the event relates to.
 * @param action    - The event kind.
 * @param userId    - The user who performed the action.
 * @param timestamp - ISO 8601 UTC string (defaults to current time ISO).
 * @returns A complete AuditEvent ready for storage.
 *
 * @example
 * ```ts
 * const e = recordAudit('site_001', 'site.published', 'user_abc');
 * expect(e.siteId).toBe('site_001');
 * expect(e.action).toBe('site.published');
 * ```
 */
export function recordAudit(
  siteId: string,
  action: AuditAction,
  userId: string,
  timestamp?: string,
): AuditEvent {
  return {
    action,
    id: crypto.randomUUID(),
    siteId,
    timestamp: timestamp ?? new Date().toISOString(),
    userId,
  };
}

// ---------------------------------------------------------------------------
// auditHistory — filter events by site
// ---------------------------------------------------------------------------

/**
 * Returns a new array containing only events whose `siteId` matches the
 * given `siteId`.
 *
 * The returned array is always a copy — never the original reference.
 *
 * @param events - Audit event list to filter.
 * @param siteId - The site id to match.
 * @returns A filtered copy. Returns an empty array when no events match.
 *
 * @example
 * ```ts
 * const all = [
 *   recordAudit('a', 'site.created', 'u1'),
 *   recordAudit('b', 'site.created', 'u2'),
 * ];
 * expect(auditHistory(all, 'a')).toHaveLength(1);
 * expect(auditHistory([], 'a')).toEqual([]);
 * ```
 */
export function auditHistory(events: readonly AuditEvent[], siteId: string): AuditEvent[] {
  return events.filter((e) => e.siteId === siteId);
}
