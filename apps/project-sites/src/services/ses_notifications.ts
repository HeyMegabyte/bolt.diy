/**
 * @module services/ses_notifications
 *
 * @description
 * Pure parser for Amazon SES bounce/complaint notifications (§42/ADR-0019
 * deliverability). SES publishes these to SNS; the SNS body is either the raw
 * SES notification JSON or an SNS envelope `{ Type: 'Notification', Message:
 * '<stringified SES JSON>' }`. This module normalizes EITHER shape into a list
 * of {@link SesSuppression} records the webhook handler persists into
 * `email_suppressions`, so we never re-send to an address that hard-bounced or
 * complained.
 *
 * Deliverability semantics (the reason this isn't a one-liner):
 *  - **Permanent bounces** suppress — the mailbox does not exist / is closed.
 *  - **Transient bounces** do NOT suppress — mailbox-full / throttled / greylist
 *    can recover; suppressing them would silently drop a reachable customer.
 *  - **Complaints** suppress — the recipient marked us as spam; never re-send.
 *  - Delivery / Send / Open / Click / unknown → no suppression.
 *
 * Pure: no network, no D1, never throws (malformed input → `[]`). The webhook
 * handler (a follow-on slice) verifies the SNS signature, calls this, and writes
 * the result to `email_suppressions` keyed on the lowercased email.
 *
 * @see services/ses_email_provider.ts
 * @see docs/adr/0019-amazon-ses-plus-listmonk-email.md
 */
import { z } from 'zod';

/** Why an address is suppressed. */
export type SesSuppressionReason = 'bounce' | 'complaint';

/** A single address to add to the suppression list. */
export const SesSuppressionSchema = z
  .object({
    /** Lowercased recipient address. */
    email: z.string().min(3).max(254),
    reason: z.enum(['bounce', 'complaint']),
    /** SES sub-type: `Permanent`/`Transient` (bounce) or the complaint feedback type. */
    subType: z.string().max(120).nullable(),
    /** ISO timestamp from the notification, or null when SES omitted it. */
    timestamp: z.string().max(40).nullable(),
    /** The originating SES `mail.messageId`, for correlation; null when absent. */
    sourceMessageId: z.string().max(200).nullable(),
  })
  .strict();

export type SesSuppression = z.infer<typeof SesSuppressionSchema>;

/** Narrow an unknown value to a plain record without throwing. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Lowercase + trim a candidate email; null when it isn't a plausible address. */
function normEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const e = value.trim().toLowerCase();
  return /.+@.+\..+/.test(e) && e.length <= 254 ? e : null;
}

/** Pull `{emailAddress}[]` from a recipients array into normalized addresses. */
function recipientEmails(recipients: unknown): string[] {
  if (!Array.isArray(recipients)) return [];
  const out: string[] = [];
  for (const r of recipients) {
    const email = normEmail(asRecord(r)?.['emailAddress']);
    if (email) out.push(email);
  }
  return out;
}

/**
 * Unwrap an SNS envelope to the inner SES notification object. Accepts the raw
 * SES notification directly, or `{ Type: 'Notification', Message: '<json>' }`.
 *
 * @returns The SES notification record, or null when the shape is unusable.
 */
function unwrap(input: unknown): Record<string, unknown> | null {
  const top = asRecord(input);
  if (!top) return null;
  if (top['Type'] === 'Notification' && typeof top['Message'] === 'string') {
    try {
      return asRecord(JSON.parse(top['Message']));
    } catch {
      return null;
    }
  }
  return top;
}

/**
 * Parse an SES bounce/complaint notification into suppression records.
 *
 * @param input - Raw SES notification JSON or an SNS-wrapped envelope.
 * @returns Zero or more {@link SesSuppression} records (empty for transient
 *   bounces, deliveries, or unparseable input). Deduplicated by email.
 * @throws Never — malformed input yields `[]`.
 *
 * @example
 * parseSesNotification({
 *   notificationType: 'Bounce',
 *   bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'x@y.com' }] },
 *   mail: { messageId: 'm1' },
 * }); // → [{ email: 'x@y.com', reason: 'bounce', subType: 'Permanent', ... }]
 */
export function parseSesNotification(input: unknown): SesSuppression[] {
  const n = unwrap(input);
  if (!n) return [];
  const mail = asRecord(n['mail']);
  const sourceMessageId =
    typeof mail?.['messageId'] === 'string' ? mail['messageId'].slice(0, 200) : null;
  const type = n['notificationType'] ?? n['eventType'];

  const records: SesSuppression[] = [];

  if (type === 'Bounce') {
    const bounce = asRecord(n['bounce']);
    // Only PERMANENT bounces suppress — transient bounces can recover.
    if (bounce?.['bounceType'] === 'Permanent') {
      const ts = typeof bounce['timestamp'] === 'string' ? bounce['timestamp'].slice(0, 40) : null;
      for (const email of recipientEmails(bounce['bouncedRecipients'])) {
        records.push({ email, reason: 'bounce', subType: 'Permanent', timestamp: ts, sourceMessageId });
      }
    }
  } else if (type === 'Complaint') {
    const complaint = asRecord(n['complaint']);
    const subType =
      typeof complaint?.['complaintFeedbackType'] === 'string'
        ? complaint['complaintFeedbackType'].slice(0, 120)
        : null;
    const ts =
      typeof complaint?.['timestamp'] === 'string' ? complaint['timestamp'].slice(0, 40) : null;
    for (const email of recipientEmails(complaint?.['complainedRecipients'])) {
      records.push({ email, reason: 'complaint', subType, timestamp: ts, sourceMessageId });
    }
  }

  // Dedup by email (SES can list the same recipient twice); validate each.
  const seen = new Set<string>();
  return records.filter((r) => {
    if (seen.has(r.email)) return false;
    seen.add(r.email);
    return SesSuppressionSchema.safeParse(r).success;
  });
}
