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

import type { Env } from '../types/env.js';
import { DOMAINS } from '@project-sites/shared';
import { dbExecute, dbQueryOne } from './db.js';

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

export interface BulkExecResult {
  archived: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Execute a reversible bulk archive over already-planned eligible ids.
 *
 * Writes `status='archived'` ONLY — it NEVER sets `deleted_at` (that is the
 * soft-DELETE path, which would drop the rows out of the product). Scoped by
 * `org_id` as defense-in-depth even though the planner already filtered to the
 * caller's owned sites. Idempotent: re-archiving an archived (non-deleted) site
 * is a harmless no-op.
 *
 * @example
 * ```ts
 * const { archived, failed } = await executeBulkArchive(env, orgId, plan.eligible);
 * ```
 */
export async function executeBulkArchive(env: Env, orgId: string, ids: string[]): Promise<BulkExecResult> {
  const archived: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    const res = await dbExecute(
      env.DB,
      "UPDATE sites SET status = 'archived', updated_at = datetime('now') WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
      [id, orgId],
    );
    if (res.error) failed.push({ id, error: res.error });
    else if (res.changes > 0) archived.push(id);
    else failed.push({ id, error: 'no_match' }); // raced delete / wrong org — planner already excludes these
  }

  return { archived, failed };
}

export interface BulkSetFlagResult {
  set: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Set a per-site (tenant-scoped) feature-flag override across eligible sites.
 *
 * Writes to `flag_overrides` (scope='tenant') — the SAME table `isFlagOn`
 * reads — via the canonical upsert (`ON CONFLICT(scope, scope_id, flag_key)
 * WHERE deleted_at IS NULL`), so re-running just updates the value. NOTE: the
 * caller MUST validate `flagKey` (known registry key, non-core) and that `ids`
 * are the org-owned eligible set from the planner — this executor trusts both.
 *
 * @example
 * ```ts
 * await executeBulkSetFlag(env, plan.eligible, 'review_synthesis', true, userId);
 * ```
 */
export async function executeBulkSetFlag(
  env: Env,
  ids: string[],
  flagKey: string,
  enabled: boolean,
  setBy: string | null,
): Promise<BulkSetFlagResult> {
  const set: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const valueJson = JSON.stringify({ enabled });

  for (const id of ids) {
    const now = new Date().toISOString();
    const res = await dbExecute(
      env.DB,
      `INSERT INTO flag_overrides (id, scope, scope_id, flag_key, value_json, set_by, set_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(scope, scope_id, flag_key) WHERE deleted_at IS NULL
       DO UPDATE SET value_json = excluded.value_json, set_by = excluded.set_by,
                     set_at = excluded.set_at, updated_at = excluded.updated_at`,
      [crypto.randomUUID(), 'tenant', id, flagKey, valueJson, setBy, now, now, now],
    );
    if (res.error) failed.push({ id, error: res.error });
    else set.push(id);
  }

  return { set, failed };
}

export interface BulkRepublishResult {
  republished: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Re-publish each already-planned eligible site in bulk.
 *
 * This is the lightweight republish — NOT a full AI rebuild (that is the
 * credit-burning `/api/sites/:id/reset` workflow path). The planner only marks
 * a site `republish`-eligible when its status is already `'published'`, so the
 * correct bulk action is to re-serve the existing R2 artifact fresh: re-assert
 * `status='published'` + bump `updated_at` (a reversible, status-ONLY write —
 * it NEVER touches `deleted_at`, idempotent on an already-published site), then
 * bust the 60s `host:{slug}${SITES_SUFFIX}` KV cache so the live site picks the
 * republish up immediately.
 *
 * Per id, the UPDATE is scoped by `org_id` AND `status='published'` AND
 * `deleted_at IS NULL` as defense-in-depth even though the planner already
 * filtered to the caller's owned, published sites: a raced delete / archive /
 * wrong-org row matches nothing and is reported as `no_match` (never
 * cross-tenant). A per-id DB error is captured without aborting the batch, and
 * the cache for a site that did NOT commit is left untouched.
 *
 * @example
 * ```ts
 * const { republished, failed } = await executeBulkRepublish(env, orgId, plan.eligible);
 * ```
 */
export async function executeBulkRepublish(
  env: Env,
  orgId: string,
  ids: string[],
): Promise<BulkRepublishResult> {
  const republished: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    // Resolve the slug under the same org + published + not-deleted scope. A null
    // row means the site is foreign / archived / deleted — skip as no_match.
    const row = await dbQueryOne<{ slug: string }>(
      env.DB,
      "SELECT slug FROM sites WHERE id = ? AND org_id = ? AND status = 'published' AND deleted_at IS NULL",
      [id, orgId],
    );
    if (!row) {
      failed.push({ id, error: 'no_match' });
      continue;
    }

    let res;
    try {
      res = await dbExecute(
        env.DB,
        "UPDATE sites SET status = 'published', updated_at = datetime('now') WHERE id = ? AND org_id = ? AND status = 'published' AND deleted_at IS NULL",
        [id, orgId],
      );
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : 'db error' });
      continue;
    }
    if (res.error) {
      failed.push({ id, error: res.error });
      continue;
    }
    if (res.changes === 0) {
      failed.push({ id, error: 'no_match' }); // raced delete/archive between SELECT and UPDATE
      continue;
    }

    // Bust the host cache so the republished site re-serves immediately.
    await env.CACHE_KV.delete(`host:${row.slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});
    republished.push(id);
  }

  return { republished, failed };
}
