/**
 * @module services/bulk_site_ops
 * @description Core planner for Bulk Site Ops (build-first module #17, P1) —
 * "apply a change/flag across ALL your sites at once" (agency leverage).
 *
 * This is the SAFETY-CRITICAL heart of the feature: before any site is mutated
 * in bulk, `planBulkOperation` decides which of the requested sites are
 * eligible and which are skipped (with a structured reason). It enforces:
 *   1. ownership — only sites in the caller's owned set act (never cross-tenant);
 *   2. operation validity — e.g. you can't republish a non-published site;
 *   3. a hard batch cap so a runaway "all sites" request can't fan out forever.
 *
 * Pure + deterministic (no DB, no network) → fully unit-testable. The route
 * (slice 2) resolves the caller's org-scoped sites from D1, calls this, then
 * executes only `eligible`.
 *
 * @packageDocumentation
 */

/** Operations a bulk request may apply across the caller's sites. */
export type BulkOperation = 'set_flag' | 'republish' | 'archive';

/** Hard cap on sites mutated in one bulk request (overflow is skipped, not silently dropped). */
export const MAX_BULK_SITES = 100;

/** Minimal site shape the planner needs (org-scoping already applied upstream). */
export interface BulkSiteRef {
  id: string;
  status: string;
}

export interface BulkPlanInput {
  operation: BulkOperation;
  /** Site ids the caller asked to target (duplicates tolerated). */
  requestedSiteIds: string[];
  /** The caller's own sites (already org-scoped + non-deleted) from D1. */
  ownedSites: BulkSiteRef[];
}

export interface BulkSkip {
  id: string;
  reason:
    | 'not_owned'
    | 'archived'
    | 'already_archived'
    | 'not_publishable'
    | 'batch_cap_exceeded'
    | 'unknown_operation';
}

export interface BulkPlan {
  operation: BulkOperation;
  eligible: string[];
  skipped: BulkSkip[];
  /** Set to MAX_BULK_SITES when overflow was trimmed; null otherwise. */
  cappedAt: number | null;
}

/** Why a site can't take `op` in its current `status` — null = eligible. */
function ineligibleReason(op: BulkOperation, status: string): BulkSkip['reason'] | null {
  if (status === 'archived') return op === 'archive' ? 'already_archived' : 'archived';
  switch (op) {
    case 'republish':
      return status === 'published' ? null : 'not_publishable';
    case 'archive':
      return null;
    case 'set_flag':
      return null;
    default:
      return 'unknown_operation';
  }
}

/**
 * Resolve a bulk request into an eligible set + structured skips.
 *
 * @example
 * ```ts
 * const plan = planBulkOperation({
 *   operation: 'republish',
 *   requestedSiteIds: ['a', 'b'],
 *   ownedSites: [{ id: 'a', status: 'published' }], // 'b' not owned
 * });
 * // plan.eligible = ['a']; plan.skipped = [{ id: 'b', reason: 'not_owned' }]
 * ```
 */
export function planBulkOperation(input: BulkPlanInput): BulkPlan {
  const ownedById = new Map(input.ownedSites.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const eligible: string[] = [];
  const skipped: BulkSkip[] = [];

  for (const id of input.requestedSiteIds) {
    if (seen.has(id)) continue; // dedupe silently
    seen.add(id);

    const site = ownedById.get(id);
    if (!site) {
      skipped.push({ id, reason: 'not_owned' });
      continue;
    }
    const reason = ineligibleReason(input.operation, site.status);
    if (reason) {
      skipped.push({ id, reason });
      continue;
    }
    eligible.push(id);
  }

  let cappedAt: number | null = null;
  if (eligible.length > MAX_BULK_SITES) {
    const overflow = eligible.splice(MAX_BULK_SITES);
    for (const id of overflow) skipped.push({ id, reason: 'batch_cap_exceeded' });
    cappedAt = MAX_BULK_SITES;
  }

  return { operation: input.operation, eligible, skipped, cappedAt };
}
