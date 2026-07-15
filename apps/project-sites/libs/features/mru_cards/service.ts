/**
 * MRU Cards service — most-recently-active sites per org.
 *
 * Queries audit_logs joined with sites to find the N most recently
 * touched sites for the current org. Each result includes the site
 * name, slug, the last action performed, and a timestamp.
 *
 * @module libs/features/mru_cards/service
 */
import type { Env } from '../../../src/types/env.js';
import { dbQuery } from '../../../src/services/db.js';
import type { MruCard } from './schemas.js';

interface MruRow {
  site_id: string;
  slug: string;
  name: string;
  action: string;
  max_created_at: string;
}

/**
 * Return the N most-recently-active sites for an org.
 *
 * @param env - Worker bindings (needs D1)
 * @param orgId - Org scope
 * @param limit - Max cards (default 5, max 20)
 */
export async function getMruCards(
  env: Env,
  orgId: string,
  limit = 5,
): Promise<MruCard[]> {
  const effectiveLimit = Math.min(Math.max(limit, 1), 20);
  const rows = await dbQuery<MruRow>(
    env.DB,
    `SELECT a.target_id as site_id, s.slug, s.name,
            a.action, MAX(a.created_at) as max_created_at
     FROM audit_logs a
     JOIN sites s ON s.id = a.target_id AND s.deleted_at IS NULL
     WHERE a.org_id = ? AND a.deleted_at IS NULL
       AND a.target_type = 'site'
     GROUP BY a.target_id
     ORDER BY max_created_at DESC
     LIMIT ?`,
    [orgId, effectiveLimit],
  );

  return (rows.data ?? []).map((r) => ({
    siteId: r.site_id,
    slug: r.slug,
    name: r.name,
    lastAction: r.action,
    lastActivityAt: r.max_created_at,
  }));
}
