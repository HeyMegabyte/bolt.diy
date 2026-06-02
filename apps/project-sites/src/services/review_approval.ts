/**
 * @module services/review_approval
 * @description Core approval state machine for Review/Approval Links (build-first
 * module #4, P1) — shareable preview links a stakeholder approves before publish.
 *
 * IMPORTANT (dedup): this EXTENDS the existing `approval_workflow` flag +
 * `review_tokens` table (the demo `createReviewLink` stub in
 * services/features.ts) — it is NOT a new parallel module. `review_tokens`
 * currently stores only `expires_at` with no approval state; this is the
 * missing state machine. Slice 2 adds a `status` column to `review_tokens` and
 * real approve/reject/comment routes that adopt these guards.
 *
 * Pure + deterministic — the clock (`nowIso`) is injected — so the
 * approve-only-pending and expiry rules are fully unit-testable.
 *
 * @packageDocumentation
 */

/** Stored status never includes 'expired' — that is derived from the clock. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
export type ApprovalAction = 'approve' | 'reject' | 'revoke';

export interface ApprovalLinkState {
  /** The persisted status (never 'expired' — see {@link effectiveApprovalStatus}). */
  status: ApprovalStatus;
  /** ISO-8601 **UTC** ('…Z') expiry, or null for no expiry. */
  expiresAt: string | null;
}

/**
 * Effective status given the clock: a stored 'pending' link past its `expiresAt`
 * reads as 'expired'. Terminal statuses (approved/rejected/revoked) are returned
 * unchanged. Both timestamps MUST be ISO-8601 UTC for the lexicographic compare.
 *
 * @example
 * ```ts
 * effectiveApprovalStatus({ status: 'pending', expiresAt: '2026-01-01T00:00:00.000Z' }, '2026-06-01T00:00:00.000Z')
 * // → 'expired'
 * ```
 */
export function effectiveApprovalStatus(link: ApprovalLinkState, nowIso: string): ApprovalStatus {
  if (link.status === 'pending' && link.expiresAt !== null && link.expiresAt <= nowIso) {
    return 'expired';
  }
  return link.status;
}

export interface ApprovalTransition {
  ok: boolean;
  next?: Exclude<ApprovalStatus, 'expired'>;
  error?: string;
}

/**
 * Guard an approve/reject/revoke action against the link's effective status.
 * Only an effectively-'pending' link can transition; an expired/approved/
 * rejected/revoked link is final and rejects the action.
 *
 * @example
 * ```ts
 * applyApprovalAction({ status: 'pending', expiresAt: null }, 'approve', now) // → { ok: true, next: 'approved' }
 * applyApprovalAction({ status: 'approved', expiresAt: null }, 'reject', now) // → { ok: false, error: '…' }
 * ```
 */
export function applyApprovalAction(
  link: ApprovalLinkState,
  action: ApprovalAction,
  nowIso: string,
): ApprovalTransition {
  const status = effectiveApprovalStatus(link, nowIso);
  if (status !== 'pending') {
    return { ok: false, error: `link is ${status}; only a pending link can be ${action}d` };
  }
  switch (action) {
    case 'approve':
      return { ok: true, next: 'approved' };
    case 'reject':
      return { ok: true, next: 'rejected' };
    case 'revoke':
      return { ok: true, next: 'revoked' };
    default:
      return { ok: false, error: 'unknown_action' };
  }
}
