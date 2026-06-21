/**
 * @module services/snapshot_restore
 * @description Restore a site to one of its named D1 `site_snapshots` by
 * re-pointing `sites.current_build_version` at the snapshot's frozen
 * `build_version`.
 *
 * @remarks
 * This is the clean fix for the broken revert contract. The frontend's
 * `revertSnapshot` sends a `snapshot_id`, but `POST /snapshots/revert` expects
 * a git `commit_id` from a SEPARATE R2-git subsystem (`sites/{slug}/commits/`).
 * The D1 `site_snapshots` timeline and the R2-git timeline are disjoint — a
 * snapshot row carries no commit SHA (snapshot-create makes no git commit), so
 * the original "expose the SHA on the list" idea is unbuildable. Instead, this
 * restores by the data the snapshot DOES carry: its `build_version`, an R2
 * path that already serves. Re-pointing the current version is:
 *
 *  - **Reversible** — the prior version's R2 files remain; restore again to undo.
 *  - **Org-scoped** — the snapshot must belong to a site owned by the caller's
 *    org (an org-joined lookup), so a caller can't restore another tenant's site.
 *  - **Non-throwing** — every failure path returns a typed `{ ok: false, error }`.
 *
 * @see src/routes/api.ts `POST /api/sites/:siteId/snapshots/:snapshotId/restore`
 */

import { DOMAINS } from '@project-sites/shared';
import type { Env } from '../types/env.js';
import { dbQuery, dbQueryOne, dbUpdate } from './db.js';
import * as auditService from './audit.js';

/** Inputs for {@link restoreSnapshot}. */
export interface RestoreSnapshotParams {
  siteId: string;
  orgId: string;
  snapshotId: string;
  userId: string | null;
  requestId?: string | null;
}

/** Result of {@link restoreSnapshot}. */
export interface RestoreSnapshotResult {
  ok: boolean;
  error?: string;
  /** The R2 build version the site was re-pointed to (on success). */
  version?: string;
  /** The site's slug (on success). */
  slug?: string;
}

/**
 * Restore `siteId` to the build frozen by snapshot `snapshotId`.
 *
 * @param env - Worker env (D1, R2 `SITES_BUCKET`, `CACHE_KV`).
 * @param params - Site, org, snapshot, and actor identifiers.
 * @returns `{ ok: true, version, slug }` on success, else `{ ok: false, error }`.
 * @example
 * const r = await restoreSnapshot(env, { siteId, orgId, snapshotId, userId, requestId });
 * if (!r.ok) return notFound(r.error);
 */
export async function restoreSnapshot(
  env: Env,
  params: RestoreSnapshotParams,
): Promise<RestoreSnapshotResult> {
  const { siteId, orgId, snapshotId, userId, requestId } = params;

  // Org-scoped lookup: the snapshot must belong to THIS site, and the site must
  // be owned by the caller's org. A miss (wrong org / wrong site / deleted) → null.
  const row = await dbQueryOne<{ build_version: string | null; slug: string }>(
    env.DB,
    `SELECT ss.build_version AS build_version, s.slug AS slug
       FROM site_snapshots ss
       JOIN sites s ON s.id = ss.site_id
      WHERE ss.id = ? AND ss.site_id = ? AND s.org_id = ?
        AND ss.deleted_at IS NULL AND s.deleted_at IS NULL`,
    [snapshotId, siteId, orgId],
  );
  if (!row) return { ok: false, error: 'Snapshot not found' };
  if (!row.build_version) return { ok: false, error: 'Snapshot has no build to restore' };

  // The frozen build must still exist in R2 before we re-point to it.
  const head = await env.SITES_BUCKET.head(`sites/${row.slug}/${row.build_version}/index.html`);
  if (!head) return { ok: false, error: 'Snapshot build is no longer in storage' };

  // Re-point the live build version (reversible — old version files remain).
  await dbUpdate(env.DB, 'sites', { current_build_version: row.build_version }, 'id = ?', [siteId]);

  // Purge the host KV cache so serving resolves the new version immediately —
  // the base subdomain plus every active custom hostname bound to the site.
  await env.CACHE_KV.delete(`host:${row.slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});
  const { data: hosts } = await dbQuery<{ hostname: string }>(
    env.DB,
    `SELECT hostname FROM hostnames WHERE site_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [siteId],
  );
  for (const h of hosts ?? []) {
    await env.CACHE_KV.delete(`host:${h.hostname}`).catch(() => {});
  }

  await auditService
    .writeAuditLog(env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'site.snapshot.restored',
      message: `Restored snapshot to build '${row.build_version}' on '${row.slug}'`,
      target_type: 'site',
      target_id: siteId,
      metadata_json: { snapshot_id: snapshotId, build_version: row.build_version, slug: row.slug },
      request_id: requestId ?? undefined,
    })
    .catch(() => {});

  return { ok: true, version: row.build_version, slug: row.slug };
}
