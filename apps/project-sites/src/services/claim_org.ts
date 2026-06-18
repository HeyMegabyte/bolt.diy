/**
 * claimyour.site (#1) — platform-org ownership of claim-built sites + the
 * transfer-on-claim step (design option A).
 *
 * @remarks
 * A claim build provisions a `sites` row BEFORE the visitor has an org, so it is
 * parented to the platform org (seeded by migration 0571). When the visitor
 * signs in and adopts the build, {@link transferClaimSite} re-parents the row to
 * their real org — the second half of option A. Guarded so a claim site can only
 * be transferred OUT OF the platform org (never steal another org's site) and is
 * idempotent for the same org.
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';
import { dbQueryOne, dbUpdate } from './db.js';
import { writeAuditLog } from './audit.js';

/**
 * The platform org that owns claim-built sites until the visitor claims them.
 * Seeded by migration 0571; the home of every speculative claim build.
 */
export const PLATFORM_CLAIMS_ORG_ID = 'org_platform_claims';

/** Outcome of a transfer attempt. `reason` explains a no-op. */
export type TransferResult =
  | { transferred: true; slug: string }
  | {
      transferred: false;
      reason: 'not_found' | 'already_yours' | 'already_claimed' | 'update_failed';
    };

/**
 * Re-parent a platform-org claim site to `newOrgId` (the claiming user's org).
 *
 * @param env       - Worker env (uses `env.DB`).
 * @param siteId    - The claim-built site to transfer.
 * @param newOrgId  - The claiming user's org id.
 * @param actorId   - The claiming user (for the audit log).
 * @returns A {@link TransferResult}. Never throws; a DB failure → `update_failed`.
 */
export async function transferClaimSite(
  env: Pick<Env, 'DB'>,
  siteId: string,
  newOrgId: string,
  actorId?: string | null,
): Promise<TransferResult> {
  const site = await dbQueryOne<{ id: string; org_id: string; slug: string }>(
    env.DB,
    'SELECT id, org_id, slug FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  ).catch(() => null);

  if (!site) return { transferred: false, reason: 'not_found' };
  if (site.org_id !== PLATFORM_CLAIMS_ORG_ID) {
    // Already owned by a real org — idempotent if it's already this user's org,
    // otherwise it belongs to someone else: never reassign it.
    return {
      transferred: false,
      reason: site.org_id === newOrgId ? 'already_yours' : 'already_claimed',
    };
  }

  // Scoped to the platform org so a concurrent claim can't double-transfer.
  const res = await dbUpdate(env.DB, 'sites', { org_id: newOrgId }, 'id = ? AND org_id = ?', [
    siteId,
    PLATFORM_CLAIMS_ORG_ID,
  ]);
  if (res.error) return { transferred: false, reason: 'update_failed' };

  await writeAuditLog(env.DB, {
    org_id: newOrgId,
    actor_id: actorId ?? null,
    action: 'site.claimed',
    message: `Site '${site.slug}' claimed from the platform org`,
    target_type: 'site',
    target_id: siteId,
    metadata_json: { site_id: siteId, slug: site.slug, from_org: PLATFORM_CLAIMS_ORG_ID },
  });

  return { transferred: true, slug: site.slug };
}
