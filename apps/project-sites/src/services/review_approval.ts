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

import type { Env } from '../types/env.js';
import { dbQuery, dbQueryOne, dbExecute } from './db.js';
import { writeAuditLog } from './audit.js';

/** Max length of a reviewer comment (kept in the append-only audit log). */
export const MAX_REVIEW_COMMENT_LEN = 2000;

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

/** SHA-256 hex of a string (Web Crypto — available in Workers + the Jest runtime). */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Default review-link lifetime: 7 days. */
export const DEFAULT_REVIEW_TTL_MS = 7 * 86_400_000;

export interface CreateReviewLinkResult {
  ok: boolean;
  /** Unguessable UUID — the public bearer credential in `/review/:id`. */
  id?: string;
  /** Relative reviewer URL (`/review/:id`). */
  url?: string;
  /** ISO-8601 UTC expiry. */
  expiresAt?: string;
  error?: string;
}

/**
 * Create a shareable review link for a site — the REAL, owned replacement for
 * the demo `createReviewLink` stub in services/features.ts (which used
 * 'demo-site'/'demo-agency' defaults and swallowed insert errors with
 * `.catch(() => {})`). The CALLER enforces auth + site ownership
 * (`assertSiteOwned`) before calling; this persists the token row and returns
 * the link. The id is the bearer credential (id-as-bearer MVP — token_hash
 * verification is a follow-up). Clock + ttl are injected for testability.
 *
 * @param orgId - the owning org (stored as `agency_org_id`).
 * @param siteId - the site the link previews.
 * @param opts.ttlMs - link lifetime (default {@link DEFAULT_REVIEW_TTL_MS}).
 * @param opts.nowMs - injected clock (default `Date.now()`).
 *
 * @example
 * const link = await createReviewLink(env, orgId, siteId); // { ok, id, url: '/review/…', expiresAt }
 */
export async function createReviewLink(
  env: Env,
  orgId: string,
  siteId: string,
  opts: { ttlMs?: number; nowMs?: number } = {},
): Promise<CreateReviewLinkResult> {
  const ttlMs = opts.ttlMs ?? DEFAULT_REVIEW_TTL_MS;
  const nowMs = opts.nowMs ?? Date.now();
  const id = crypto.randomUUID();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const tokenHash = await sha256Hex(`${id}.${siteId}.${orgId}.${expiresAt}`);
  const res = await dbExecute(
    env.DB,
    'INSERT INTO review_tokens (id, site_id, agency_org_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    [id, siteId, orgId, tokenHash, expiresAt],
  );
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, id, url: `/review/${id}`, expiresAt };
}

export interface ReviewLinkSummary {
  id: string;
  /** Effective status at read time (pending links past expiry read as 'expired'). */
  status: ApprovalStatus;
  /** Relative reviewer URL (`/review/:id`). */
  url: string;
  expiresAt: string;
  usedAt: string | null;
}

/**
 * List a site's review links (org+site scoped) with each link's EFFECTIVE
 * status derived at read time via {@link effectiveApprovalStatus}. The caller
 * enforces auth + site ownership before calling.
 *
 * @param nowIso - injected clock (ISO-UTC) for the expiry derivation.
 */
export async function listReviewLinks(
  env: Env,
  orgId: string,
  siteId: string,
  nowIso: string = new Date().toISOString(),
): Promise<ReviewLinkSummary[]> {
  const { data } = await dbQuery<{ id: string; decision: string | null; expires_at: string; used_at: string | null }>(
    env.DB,
    `SELECT id, decision, expires_at, used_at FROM review_tokens
     WHERE agency_org_id = ? AND site_id = ? ORDER BY expires_at DESC`,
    [orgId, siteId],
  );
  return data.map((r) => ({
    id: r.id,
    status: effectiveApprovalStatus({ status: (r.decision as ApprovalStatus) ?? 'pending', expiresAt: r.expires_at }, nowIso),
    url: `/review/${r.id}`,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
  }));
}

export interface ReviewLinkRow {
  id: string;
  site_id: string;
  agency_org_id: string;
  decision: string | null;
  expires_at: string;
}

/** Load a review link by its (unguessable UUID) id — the public bearer credential. */
export async function getReviewLink(env: Env, id: string): Promise<ReviewLinkRow | null> {
  return dbQueryOne<ReviewLinkRow>(
    env.DB,
    'SELECT id, site_id, agency_org_id, decision, expires_at FROM review_tokens WHERE id = ?',
    [id],
  );
}

export interface ReviewDecisionResult {
  ok: boolean;
  status?: string;
  error?: string;
}

/**
 * Persist an approve/reject/revoke decision on a `review_tokens` row.
 *
 * Dedup note: `review_tokens` already has a nullable `decision` column +
 * `used_at` — this uses them (NO new `status` column). State is derived:
 * `decision IS NULL` → pending; otherwise the stored terminal status. The
 * `AND decision IS NULL` guard in the UPDATE makes a double-decide race a
 * no-op (`already_decided`).
 *
 * On a successful transition we record an append-only `review.{action}` audit
 * row (org-scoped to the link's `agency_org_id`) carrying the optional reviewer
 * `comment` in `metadata_json` — comments need NO new column/migration because
 * they live in the existing `audit_logs` table. Audit writes are best-effort
 * (`writeAuditLog` never throws) so they never fail the decision.
 *
 * @param nowIso - injected clock (ISO-UTC) for the expiry check.
 * @param comment - optional reviewer note recorded alongside the decision.
 */
export async function recordReviewDecision(
  env: Env,
  reviewId: string,
  action: ApprovalAction,
  nowIso: string,
  comment?: string,
): Promise<ReviewDecisionResult> {
  const row = await dbQueryOne<{ decision: string | null; expires_at: string; agency_org_id: string }>(
    env.DB,
    'SELECT decision, expires_at, agency_org_id FROM review_tokens WHERE id = ?',
    [reviewId],
  );
  if (!row) return { ok: false, error: 'not_found' };

  const link: ApprovalLinkState = {
    status: (row.decision as ApprovalStatus) ?? 'pending',
    expiresAt: row.expires_at,
  };
  const t = applyApprovalAction(link, action, nowIso);
  if (!t.ok) return { ok: false, error: t.error };

  const res = await dbExecute(
    env.DB,
    "UPDATE review_tokens SET decision = ?, used_at = datetime('now') WHERE id = ? AND decision IS NULL",
    [t.next, reviewId],
  );
  if (res.error) return { ok: false, error: res.error };
  if (res.changes === 0) return { ok: false, error: 'already_decided' };

  await writeAuditLog(env.DB, {
    org_id: row.agency_org_id,
    actor_id: null,
    action: `review.${action}`,
    target_type: 'review_token',
    // reviewId lives in metadata (not target_id) so audit recording never
    // depends on the id being UUID-shaped.
    metadata_json: { review_id: reviewId, status: t.next, comment: comment?.trim() || undefined },
  });

  return { ok: true, status: t.next };
}

export interface ReviewCommentResult {
  ok: boolean;
  error?: string;
}

/**
 * Record a reviewer comment on a review link WITHOUT transitioning its state.
 *
 * A comment is only allowed while the link is effectively `pending` (not
 * expired, not already decided) — the same guard as a decision. The comment
 * persists as an append-only `review.comment` row in the existing `audit_logs`
 * table (org-scoped to the link's `agency_org_id`); there is NO `comment`
 * column on `review_tokens`, so this needs no migration. The token stays
 * pending so the reviewer can still approve/reject afterwards.
 *
 * @param nowIso - injected clock (ISO-UTC) for the expiry check.
 */
export async function recordReviewComment(
  env: Env,
  reviewId: string,
  comment: string,
  nowIso: string,
): Promise<ReviewCommentResult> {
  const text = (comment ?? '').trim();
  if (!text) return { ok: false, error: 'comment must not be empty' };
  if (text.length > MAX_REVIEW_COMMENT_LEN) {
    return { ok: false, error: `comment exceeds ${MAX_REVIEW_COMMENT_LEN} characters` };
  }

  const row = await dbQueryOne<{ decision: string | null; expires_at: string; agency_org_id: string }>(
    env.DB,
    'SELECT decision, expires_at, agency_org_id FROM review_tokens WHERE id = ?',
    [reviewId],
  );
  if (!row) return { ok: false, error: 'not_found' };

  const status = effectiveApprovalStatus(
    { status: (row.decision as ApprovalStatus) ?? 'pending', expiresAt: row.expires_at },
    nowIso,
  );
  if (status !== 'pending') {
    return { ok: false, error: `link is ${status}; only a pending link can be commented on` };
  }

  await writeAuditLog(env.DB, {
    org_id: row.agency_org_id,
    actor_id: null,
    action: 'review.comment',
    target_type: 'review_token',
    metadata_json: { review_id: reviewId, comment: text },
  });

  return { ok: true };
}
