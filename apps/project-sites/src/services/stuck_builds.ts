/**
 * @module services/stuck_builds
 * @description Cron sweep that recovers builds whose generation workflow died mid-run.
 *
 * A site whose build workflow crashes / times-out / loses its container is left in an
 * IN-PROGRESS status (`collecting`/`imaging`/`generating`/`building`) with a frozen
 * `updated_at`. The public serve layer renders those statuses the animated
 * "Building your website… auto-refreshes every 15 seconds" page (see
 * {@link ./site_serving.serveSiteFromR2}), so WITHOUT this sweep a dead build loops
 * that page FOREVER — the exact misleading reload-loop `serveSiteFromR2`'s own comment
 * warns against. The workflow heartbeats `updated_at` every ~30s, so 30 min of silence
 * = a dead workflow; those get flipped to `error`, and the serve layer then shows the
 * honest branded "the last build didn't finish — open your dashboard to rebuild" page.
 *
 * ⚠️ Root cause this closes: the original INLINE sweep (in `index.ts` `scheduled()`)
 * listed `('building','queued','generating','imaging','uploading')` — it OMITTED
 * `collecting` (the research phase), which `serveSiteFromR2` DOES treat as
 * build-in-progress. A build that stalled during research was therefore never
 * recovered and looped "Building…" indefinitely. Extracting the sweep here with the
 * status set as a documented SSOT + a unit test prevents the two lists drifting again.
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';
import { dbQuery, dbExecute } from './db.js';

/**
 * In-progress build statuses a dead workflow can strand a site in — every status
 * `site_serving` renders the "Building…" page for EXCEPT `draft`. `draft` is
 * intentionally excluded: it's the pre-build idle state (a user may create/save a
 * site without triggering a build), so a stale draft must NOT be auto-errored — only
 * a genuinely-started-then-stalled build is recovered.
 */
export const IN_PROGRESS_BUILD_STATUSES = [
  'collecting',
  'imaging',
  'generating',
  'building',
  'queued',
  'uploading',
] as const;

/**
 * Flip every in-progress build with no `updated_at` progress in `staleMinutes` to
 * `error`. Idempotent + self-healing: a LIVE build heartbeats `updated_at` every ~30s
 * so it's never caught; a genuinely dead one is recovered on this (or the next) fire.
 *
 * @param env - Worker env (needs `DB`).
 * @param staleMinutes - Silence window that marks a build dead (default 30; the
 *   workflow heartbeats every ~30s and the container is killed at ~15 min, so 30 min
 *   of frozen `updated_at` is unambiguously a dead workflow).
 * @returns The number of builds recovered (flipped to `error`).
 *
 * @example
 * const recovered = await unstickStalledBuilds(env); // e.g. 2
 */
export async function unstickStalledBuilds(env: Env, staleMinutes = 30): Promise<number> {
  const placeholders = IN_PROGRESS_BUILD_STATUSES.map(() => '?').join(', ');
  const { data } = await dbQuery<{ id: string; slug: string; business_name: string }>(
    env.DB,
    `SELECT id, slug, business_name FROM sites
       WHERE status IN (${placeholders})
         AND updated_at < datetime('now', ?)
         AND deleted_at IS NULL`,
    [...IN_PROGRESS_BUILD_STATUSES, `-${staleMinutes} minutes`],
  );

  let recovered = 0;
  for (const site of data) {
    // dbExecute NEVER throws — it returns { error } (see db.ts). The original inline
    // UPDATE discarded it; a dropped flip self-heals on the next sweep, but LOG it so a
    // recovery gap is observable rather than silently looping the "Building…" page.
    const { error } = await dbExecute(
      env.DB,
      `UPDATE sites SET status = 'error', updated_at = datetime('now') WHERE id = ?`,
      [site.id],
    );
    if (error) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'stuck_builds',
          message: 'failed to unstick a stalled build',
          site_id: site.id,
          slug: site.slug,
          error,
        }),
      );
      continue;
    }
    recovered++;
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'stuck_builds',
        message: 'unstuck stalled build',
        site_id: site.id,
        slug: site.slug,
        business_name: site.business_name,
      }),
    );
  }
  return recovered;
}
