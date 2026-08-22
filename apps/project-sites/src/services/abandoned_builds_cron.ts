/**
 * @module services/abandoned_builds_cron
 * @description Env-backed cron runner for the abandoned-build recovery nudge (#27).
 *
 * The pure eligibility + orchestration live in `abandoned_builds.ts` (fully unit
 * tested). This module wires the real I/O deps (D1 scan, recovery email, nudge
 * stamp) and is invoked from the Worker `scheduled()` handler. Dark-launched
 * behind the `abandoned_build_nudge` flag (default-off) so it is a no-op until
 * promoted — a subtly-wrong scan has zero live impact while dark.
 */
import type { Env } from '../types/env.js';
import { DOMAINS } from '@project-sites/shared';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { sendEmail } from './notifications.js';
import { sendClaimBuildEmail } from './claim_build_emails.js';
import { runAbandonedBuildNudges, type NudgeCandidate } from './abandoned_builds.js';

/** D1 projection row for the candidate scan. */
interface ScanRow {
  site_id: string;
  org_id: string;
  status: string;
  slug: string;
  business_name: string | null;
  updated_at: string | null;
  nudged_at: number | null;
  email: string | null;
  active_subs: number;
}

/** Parse a D1 `datetime('now')` text timestamp (UTC, no zone) to epoch ms. */
function tsToMs(raw: string | null): number {
  if (!raw) return 0;
  const ms = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Run the abandoned-build recovery sweep for this Worker env. No-op (returns
 * `{ skipped: true }`) when the `abandoned_build_nudge` flag is off.
 *
 * @param env - Worker bindings (DB + email).
 * @returns Counts for cron observability.
 */
export async function runAbandonedNudgesForEnv(
  env: Env,
): Promise<{ scanned: number; nudged: number; skipped?: boolean }> {
  if (!(await isFlagOn(env, 'abandoned_build_nudge'))) {
    return { scanned: 0, nudged: 0, skipped: true };
  }

  return runAbandonedBuildNudges({
    now: () => Date.now(),
    listCandidates: async (): Promise<NudgeCandidate[]> => {
      const { results } = await env.DB.prepare(
        `SELECT s.id AS site_id, s.org_id, s.status, s.slug, s.business_name, s.updated_at, s.nudged_at,
                (SELECT u.email FROM users u JOIN memberships m ON u.id = m.user_id
                 WHERE m.org_id = s.org_id AND m.deleted_at IS NULL AND u.deleted_at IS NULL
                 ORDER BY u.created_at ASC LIMIT 1) AS email,
                (SELECT COUNT(*) FROM subscriptions sub
                 WHERE sub.org_id = s.org_id AND sub.status = 'active'
                   AND sub.deleted_at IS NULL) AS active_subs
         FROM sites s
         WHERE s.deleted_at IS NULL
           AND s.status IN ('published','finished','complete')
         LIMIT 500`,
      ).all<ScanRow>();
      return (results ?? []).map((r) => ({
        siteId: r.site_id,
        orgId: r.org_id,
        status: r.status,
        finishedAtMs: tsToMs(r.updated_at),
        claimed: (r.active_subs ?? 0) > 0,
        nudgedAtMs: r.nudged_at ?? null,
        email: r.email ?? '',
        businessName: r.business_name ?? undefined,
        previewUrl: `https://${r.slug}${DOMAINS.SITES_SUFFIX}`,
      }));
    },
    sendRecovery: (to, ctx) =>
      sendClaimBuildEmail('recovery', to, ctx, { send: (m) => sendEmail(env, m) }),
    markNudged: async (siteId, atMs) => {
      await env.DB.prepare('UPDATE sites SET nudged_at = ? WHERE id = ?').bind(atMs, siteId).run();
    },
  });
}
