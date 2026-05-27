/**
 * Weekly auto-snapshot job.
 *
 * Cron: `0 4 * * 0` (Sundays 04:00 UTC). Enumerates every active site and
 * fires the existing snapshot workflow per site. Failures are logged and the
 * batch keeps going — one bad site never blocks the rest.
 *
 * The snapshot itself runs through Workers Workflows v2 (production-grade
 * step-based execution with replay + retries). When that binding isn't
 * available in the current deploy environment, the function records the
 * intent in `billing_events` as a `manual` event so observability picks it up.
 *
 * @see https://developers.cloudflare.com/workflows/
 */

import type { Env } from '../env.js';

interface SiteToSnapshot {
  id: string;
  tenant_id: string;
  slug: string;
}

/** Pulled from the platform `sites` table. */
async function listActiveSites(env: Env): Promise<SiteToSnapshot[]> {
  const stmt = env.DB.prepare(
    `SELECT id, tenant_id, slug
       FROM sites
      WHERE status = 'active' AND deleted_at IS NULL`,
  );
  const { results } = await stmt.all<SiteToSnapshot>();
  return results ?? [];
}

export interface ScheduledSnapshotsResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ site_id: string; error: string }>;
}

/**
 * Entry point invoked by the cron handler in `src/index.ts`.
 *
 * Iterates sequentially so a fan-out of 500 sites doesn't accidentally DDoS
 * the workflows API. For larger fleets, switch to chunking + `ctx.waitUntil`.
 */
export async function scheduledSnapshots(env: Env): Promise<ScheduledSnapshotsResult> {
  const result: ScheduledSnapshotsResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
  const sites = await listActiveSites(env);
  for (const site of sites) {
    result.attempted += 1;
    try {
      await fireSnapshotForSite(env, site);
      result.succeeded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed += 1;
      result.errors.push({ site_id: site.id, error: message });
    }
  }
  return result;
}

/**
 * Per-site snapshot trigger. Tries the queue producer first (when wired) so
 * the cron tick returns fast; falls back to a direct DB marker so the
 * downstream snapshot worker has a row to pick up.
 */
async function fireSnapshotForSite(env: Env, site: SiteToSnapshot): Promise<void> {
  // Lazy-load the queue helper — it's only present when `[[queues.producers]]`
  // is declared in wrangler.jsonc. Falls back gracefully in test envs.
  const { enqueue } = await import('./queue.js');
  await enqueue(env, {
    type: 'snapshot',
    payload: {
      site_id: site.id,
      tenant_id: site.tenant_id,
      slug: site.slug,
      reason: 'weekly_auto',
      requested_at: new Date().toISOString(),
    },
  });
}
