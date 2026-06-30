/**
 * @module services/bounce_handler
 *
 * @description
 * Pure classification, action-routing, and summarization for SES bounce and
 * complaint notifications. Complements (and is higher-level than) the raw
 * notification parser in {@link ses_notifications} — this module answers:
 *
 * - "What kind of bounce is this?"  → {@link classifyBounce}
 * - "What should we do about it?"  → {@link bounceAction}
 * - "What happened across N bounces?" → {@link bounceSummary}
 *
 * Pure: no I/O, no D1, never throws (malformed input yields a safe default).
 *
 * @see services/ses_notifications.ts
 * @see services/suppression_sync.ts
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The high-level classification of an SES notification event. */
export type BounceCategory = 'permanent' | 'transient' | 'complaint' | 'undetermined' | 'unknown';

/** SES bounce sub-types that refine the category. */
export type BounceSubType =
  | 'General'
  | 'NoEmail'
  | 'Suppressed'
  | 'MailboxFull'
  | 'MessageTooLarge'
  | 'ContentRejected'
  | 'AttachmentRejected'
  | 'Abuse'
  | 'AuthFailure'
  | 'Fraud'
  | 'NotSpam'
  | 'Other'
  | 'Virus'
  | null;

/** Severity rating derived from category + sub-type. */
export type BounceSeverity = 'hard' | 'soft' | 'info';

/** The action a caller should take in response to a bounce classification. */
export type BounceActionKind = 'suppress_immediate' | 'suppress_after_retry' | 'monitor' | 'ignore';

/** Result of {@link classifyBounce}. */
export interface BounceClassification {
  /** High-level category. */
  readonly category: BounceCategory;
  /** SES sub-type, or null when unavailable. */
  readonly subType: BounceSubType;
  /** Severity rating. */
  readonly severity: BounceSeverity;
  /** Whether this event should lead to suppression (immediate or eventual). */
  readonly actionable: boolean;
}

/** Result of {@link bounceAction}. */
export interface BounceAction {
  /** The recommended action kind. */
  readonly action: BounceActionKind;
  /** Human-readable rationale for the action. */
  readonly reason: string;
  /** Retry delay in seconds, or 0 when no retry is recommended. */
  readonly retryDelaySec: number;
}

/** A single bounce or complaint record as consumed by {@link bounceSummary}. */
export interface BounceRecord {
  /** Lowercased recipient email. */
  readonly email: string;
  /** Bounce/complaint category. */
  readonly category: BounceCategory;
  /** Optional SES sub-type. */
  readonly subType?: string | null;
  /** ISO timestamp of the event. */
  readonly timestamp?: string | null;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

/** SES notificationType values that represent bounce-like events. */
const NOTIFICATION_TYPES = new Set(['Bounce', 'Complaint', 'Undetermined']);

const PERMANENT_SUB_TYPES = new Set([
  'NoEmail',
  'Suppressed',
  'OnAccountSuppressionList',
  'UserUnknown',
]);

const TRANSIENT_SUB_TYPES = new Set([
  'MailboxFull',
  'MessageTooLarge',
  'ContentRejected',
  'AttachmentRejected',
]);

/** Normalise an unknown value to a plain record, or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Extract a string property from a record, or return fallback. */
function strProp(
  rec: Record<string, unknown>,
  key: string,
  fallback: string | null,
): string | null {
  const v = rec[key];
  return typeof v === 'string' ? v : fallback;
}

/**
 * Determine the sub-type of a bounce event from the SES notification.
 *
 * @param type - The SES `notificationType` ('Bounce', 'Complaint', etc.).
 * @param bounce - The SES `bounce` sub-object, when type is 'Bounce'.
 * @param complaint - The SES `complaint` sub-object, when type is 'Complaint'.
 * @returns The sub-type string or null.
 */
function resolveSubType(
  type: string,
  bounce: Record<string, unknown> | null,
  complaint: Record<string, unknown> | null,
): BounceSubType {
  if (type === 'Bounce' && bounce) {
    const st = strProp(bounce, 'bounceSubType', null);
    // Validate against known sub-types; return null for unrecognised values.
    const known: BounceSubType[] = [
      'General',
      'NoEmail',
      'Suppressed',
      'MailboxFull',
      'MessageTooLarge',
      'ContentRejected',
      'AttachmentRejected',
    ];
    return known.includes(st as unknown as BounceSubType) ? (st as unknown as BounceSubType) : null;
  }
  if (type === 'Complaint' && complaint) {
    const ft = strProp(complaint, 'complaintFeedbackType', null);
    const knownComplaint: BounceSubType[] = [
      'Abuse',
      'AuthFailure',
      'Fraud',
      'NotSpam',
      'Other',
      'Virus',
    ];
    return knownComplaint.includes(ft as unknown as BounceSubType)
      ? (ft as unknown as BounceSubType)
      : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// classifyBounce
// ---------------------------------------------------------------------------

/**
 * Classify a raw SES notification into a {@link BounceClassification}.
 *
 * Accepts the full SNS body (which may be wrapped in `{ Type: 'Notification',
 * Message: '<json>' }`) or the bare SES notification JSON. Malformed input
 * returns `{ category: 'unknown', ..., actionable: false }`.
 *
 * @param input - Raw SES notification or SNS-wrapped envelope.
 * @returns A structured classification (never throws).
 *
 * @example
 * classifyBounce({
 *   notificationType: 'Bounce',
 *   bounce: { bounceType: 'Permanent', bounceSubType: 'NoEmail' },
 * }); // → { category: 'permanent', subType: 'NoEmail', severity: 'hard', actionable: true }
 *
 * @example
 * classifyBounce({ notificationType: 'Bounce' });
 * // → { category: 'transient', subType: null, severity: 'soft', actionable: false }
 *
 * @example
 * classifyBounce(null);
 * // → { category: 'unknown', subType: null, severity: 'info', actionable: false }
 */
export function classifyBounce(input: unknown): BounceClassification {
  const top = asRecord(input);

  // Unwrap SNS envelope when present.
  let n = top;
  if (top && top['Type'] === 'Notification' && typeof top['Message'] === 'string') {
    try {
      n = asRecord(JSON.parse(top['Message'] as string));
    } catch {
      return {
        actionable: false,
        category: 'unknown',
        severity: 'info',
        subType: null,
      };
    }
  }

  if (!n) {
    return { actionable: false, category: 'unknown', severity: 'info', subType: null };
  }

  const type = strProp(n, 'notificationType', strProp(n, 'eventType', null));
  if (!type || !NOTIFICATION_TYPES.has(type)) {
    return { actionable: false, category: 'unknown', severity: 'info', subType: null };
  }

  const bounce = asRecord(n['bounce']);
  const complaint = asRecord(n['complaint']);
  const subType = resolveSubType(type, bounce, complaint);

  if (type === 'Complaint') {
    return { actionable: true, category: 'complaint', severity: 'hard', subType };
  }

  // Bounce — determine permanent vs transient.
  if (type === 'Bounce') {
    const bounceType = strProp(bounce ?? {}, 'bounceType', null);

    // Sub-type may override for known permanent causes.
    if (subType && PERMANENT_SUB_TYPES.has(subType)) {
      return { actionable: true, category: 'permanent', severity: 'hard', subType };
    }
    if (subType && TRANSIENT_SUB_TYPES.has(subType)) {
      return { actionable: false, category: 'transient', severity: 'soft', subType };
    }

    if (bounceType === 'Permanent' || bounceType === 'Undetermined') {
      return { actionable: true, category: 'permanent', severity: 'hard', subType };
    }
    if (bounceType === 'Transient') {
      return { actionable: false, category: 'transient', severity: 'soft', subType };
    }

    // bounceType absent but bounce object present → treat as transient.
    if (bounce) {
      return { actionable: false, category: 'transient', severity: 'soft', subType };
    }
  }

  if (type === 'Undetermined') {
    return { actionable: true, category: 'undetermined', severity: 'hard', subType };
  }

  return { actionable: false, category: 'unknown', severity: 'info', subType: null };
}

// ---------------------------------------------------------------------------
// bounceAction
// ---------------------------------------------------------------------------

/** Retry delays in seconds for each action kind. */
const RETRY_DELAYS: Record<BounceActionKind, number> = Object.freeze({
  ignore: 0,
  monitor: 300, // 5min
  suppress_after_retry: 86_400, // 24h
  suppress_immediate: 0,
});

/**
 * Determine the recommended action for a given bounce classification.
 *
 * - **permanent** → suppress immediately (mailbox does not exist).
 * - **complaint** → suppress immediately (recipient marked as spam).
 * - **undetermined** → suppress immediately (SES could not classify; safest to
 *   suppress).
 * - **transient** with `MailboxFull`/`MessageTooLarge` sub-type → retry after
 *   24h before suppressing.
 * - **transient** → ignore (greylist, throttled — likely to recover).
 * - **unknown** → ignore (cannot act on data we don't understand).
 *
 * @param classification - Result from {@link classifyBounce}.
 * @returns The recommended action with rationale.
 *
 * @example
 * bounceAction({ category: 'permanent', subType: 'NoEmail', severity: 'hard', actionable: true });
 * // → { action: 'suppress_immediate', reason: 'Permanent bounce (NoEmail) — mailbox does not exist', retryDelaySec: 0 }
 *
 * @example
 * bounceAction({ category: 'transient', subType: 'MailboxFull', severity: 'soft', actionable: false });
 * // → { action: 'suppress_after_retry', reason: 'Soft bounce (MailboxFull) — retry in 24h', retryDelaySec: 86400 }
 */
export function bounceAction(classification: BounceClassification): BounceAction {
  const { actionable, category, subType } = classification;

  // Do-nothing cases first.
  if (!actionable) {
    // Sub-type may still warrant a delayed action.
    if (category === 'transient' && (subType === 'MailboxFull' || subType === 'MessageTooLarge')) {
      return {
        action: 'suppress_after_retry',
        reason: `Soft bounce (${subType}) — retry in 24h`,
        retryDelaySec: RETRY_DELAYS.suppress_after_retry,
      };
    }
    return {
      action: 'ignore',
      reason: `${categoryLabel(category)} (${subTypeLabel(subType)}) — no action needed`,
      retryDelaySec: 0,
    };
  }

  // Actionable cases.
  if (category === 'complaint') {
    return {
      action: 'suppress_immediate',
      reason: subType
        ? `Complaint (${subType}) — recipient marked as spam`
        : 'Complaint — recipient marked as spam',
      retryDelaySec: 0,
    };
  }

  if (category === 'permanent' || category === 'undetermined') {
    const label = category === 'undetermined' ? 'Undetermined' : 'Permanent';
    return {
      action: 'suppress_immediate',
      reason: subType
        ? `${label} bounce (${subType}) — mailbox does not exist`
        : `${label} bounce — mailbox does not exist`,
      retryDelaySec: 0,
    };
  }

  return {
    action: 'ignore',
    reason: `${categoryLabel(category)} (${subTypeLabel(subType)}) — no action needed`,
    retryDelaySec: 0,
  };
}

/** Human-readable category label. */
function categoryLabel(category: BounceCategory): string {
  switch (category) {
    case 'permanent':
      return 'Permanent';
    case 'transient':
      return 'Transient';
    case 'complaint':
      return 'Complaint';
    case 'undetermined':
      return 'Undetermined';
    default:
      return 'Unknown';
  }
}

/** Human-readable sub-type label. */
function subTypeLabel(subType: BounceSubType): string {
  return subType ?? 'no sub-type';
}

// ---------------------------------------------------------------------------
// bounceSummary
// ---------------------------------------------------------------------------

/**
 * Produce a human-readable summary string from a list of bounce/complaint
 * records. Returns an empty string when the list is empty.
 *
 * @param records - Bounce/complaint records to summarise.
 * @returns A summary like "3 permanent, 1 complaint" or empty string.
 *
 * @example
 * bounceSummary([
 *   { email: 'a@b.com', category: 'permanent' },
 *   { email: 'b@c.com', category: 'permanent' },
 *   { email: 'd@e.com', category: 'complaint' },
 * ]); // → '3 events: 2 permanent, 1 complaint'
 *
 * @example
 * bounceSummary([]); // → ''
 */
export function bounceSummary(records: readonly BounceRecord[]): string {
  if (records.length === 0) return '';

  const counts = new Map<BounceCategory, number>();
  for (const r of records) {
    counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  }

  const parts: string[] = [];
  const order: BounceCategory[] = [
    'permanent',
    'transient',
    'complaint',
    'undetermined',
    'unknown',
  ];
  for (const cat of order) {
    const n = counts.get(cat);
    if (n && n > 0) {
      parts.push(`${n} ${cat}`);
    }
  }

  if (parts.length === 0) return '0 events';
  const total = records.length;
  return `${total} event${total === 1 ? '' : 's'}: ${parts.join(', ')}`;
}
