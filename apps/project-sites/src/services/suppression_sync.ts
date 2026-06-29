/**
 * @module services/suppression_sync
 * @description LM15 — SES bounce/complaint notification → typed suppression event
 * mapper. Pure classification + event mapping. The caller feeds raw SES
 * notifications; gets back typed {@link SuppressionEvent} objects that the
 * Twenty CRM + Listmonk sync jobs consume.
 *
 * Zero-I/O, never throws. All branches return a value for any input shape.
 *
 * @packageDocumentation
 */

/** Canonical suppression reasons. */
export type SuppressionReason = 'bounce_permanent' | 'bounce_transient' | 'complaint' | 'manual';

/** The raw shape of an SES bounce notification (from SNS → SQS → Worker). */
export interface SesBounceNotification {
  readonly notificationType: 'Bounce' | 'Complaint' | string;
  readonly bounce?: {
    readonly bounceType: 'Permanent' | 'Transient' | string;
    readonly bouncedRecipients: ReadonlyArray<{
      readonly emailAddress: string;
      readonly diagnosticCode?: string;
    }>;
  };
  readonly complaint?: {
    readonly complainedRecipients: ReadonlyArray<{
      readonly emailAddress: string;
    }>;
    readonly complaintFeedbackType?: string;
  };
}

/** A typed suppression event consumed by downstream sync jobs. */
export interface SuppressionEvent {
  readonly email: string;
  readonly reason: SuppressionReason;
  readonly detail: string;
  readonly source: string;
  readonly occurredAt: string;
}

/**
 * Classify an SES bounceType string into a {@link SuppressionReason}.
 * 'Permanent' → `bounce_permanent`, 'Undetermined' → `bounce_permanent`,
 * everything else → `bounce_transient`.
 *
 * @param bounceType - The raw SES bounceType value.
 * @returns The classified reason.
 *
 * @example
 * classifyBounce('Permanent');   // → 'bounce_permanent'
 * classifyBounce('Transient');   // → 'bounce_transient'
 * classifyBounce('Undetermined');// → 'bounce_permanent'
 * classifyBounce('');            // → 'bounce_transient'
 */
export function classifyBounce(bounceType: string): 'bounce_permanent' | 'bounce_transient' {
  if (bounceType === 'Permanent' || bounceType === 'Undetermined') {
    return 'bounce_permanent';
  }
  return 'bounce_transient';
}

/**
 * Map an SES bounce or complaint notification to typed {@link SuppressionEvent}
 * objects. One event per recipient. Unknown notificationType returns `[]`.
 * Empty emails are silently skipped. `nowMs` defaults to `Date.now()` for
 * convenience but can be passed for determinism in tests.
 *
 * @param notification - The raw SES notification (may be null/undefined/empty).
 * @param nowMs - Epoch ms for `occurredAt` (default `Date.now()`).
 * @returns An array of suppression events (never throws, `[]` on no-op).
 *
 * @example
 * mapSesToSuppressions({
 *   notificationType: 'Bounce',
 *   bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'a@b.com' }] },
 * }, 1_000_000_000);
 * // → [{ email: 'a@b.com', reason: 'bounce_permanent', detail: 'Permanent bounce', source: 'ses', occurredAt: '1970-01-12T13:46:40.000Z' }]
 *
 * @example
 * mapSesToSuppressions({ notificationType: 'Unknown' }, 1_000_000_000);
 * // → []
 */
export function mapSesToSuppressions(
  notification: SesBounceNotification | null | undefined,
  nowMs?: number,
): SuppressionEvent[] {
  const ts = nowMs ?? Date.now();
  const occurredAt = new Date(ts).toISOString();

  if (!notification) return [];
  if (typeof notification.notificationType !== 'string') return [];

  const events: SuppressionEvent[] = [];

  if (notification.notificationType === 'Bounce' && notification.bounce) {
    const { bouncedRecipients, bounceType } = notification.bounce;
    const reason = classifyBounce(bounceType);
    for (const r of bouncedRecipients ?? []) {
      const email = (r.emailAddress ?? '').trim();
      if (!email) continue;

      const diag = r.diagnosticCode ?? '';
      const detail = diag ? `${bounceType} bounce: ${diag.slice(0, 200)}` : `${bounceType} bounce`;

      events.push({ detail, email, occurredAt, reason, source: 'ses' });
    }
  }

  if (notification.notificationType === 'Complaint' && notification.complaint) {
    const { complainedRecipients, complaintFeedbackType } = notification.complaint;
    for (const r of complainedRecipients ?? []) {
      const email = (r.emailAddress ?? '').trim();
      if (!email) continue;

      const detail = complaintFeedbackType ? `Complaint: ${complaintFeedbackType}` : 'Complaint';

      events.push({ detail, email, occurredAt, reason: 'complaint', source: 'ses' });
    }
  }

  return events;
}
