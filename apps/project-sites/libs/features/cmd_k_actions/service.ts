import type { Env } from '../../../src/types/env.js';
import { dbQuery } from '../../../src/services/db.js';

interface SiteRow { id: string; slug: string; name: string }

const ACTIONS = [
  { verb: 'rebuild', label: 'Rebuild', action: 'rebuild' as const, route: '/admin/sites/' },
  { verb: 'snapshot', label: 'Snapshot', action: 'snapshot' as const, route: '/admin/sites/' },
  { verb: 'delete', label: 'Delete', action: 'delete' as const, route: '/admin/sites/' },
  { verb: 'view', label: 'View', action: 'view' as const, route: '/admin/sites/' },
  { verb: 'edit', label: 'Edit', action: 'edit' as const, route: '/admin/sites/' },
  { verb: 'publish', label: 'Publish', action: 'publish' as const, route: '/admin/sites/' },
];

function matchScore(slug: string, name: string, query: string): number {
  const q = query.toLowerCase();
  let score = 0;
  if (slug.includes(q)) score += 10;
  if (name.toLowerCase().includes(q)) score += 8;
  if (slug.startsWith(q)) score += 5;
  return score;
}

export async function suggestActions(env: Env, orgId: string, query: string): Promise<{ id: string; label: string; action: string; siteSlug: string | null; route: string }[]> {
  // sites has no `name` column — it's `business_name`. Alias it back to `name` so
  // the SiteRow shape + reads below stay unchanged. (Was `name` → no such column →
  // swallowed → the Cmd-K palette returned only static fallbacks for every org.)
  const sites = await dbQuery<SiteRow>(env.DB, `SELECT id, slug, business_name as name FROM sites WHERE org_id=? AND deleted_at IS NULL ORDER BY business_name LIMIT 50`, [orgId]);
  const results: { score: number; id: string; label: string; action: string; siteSlug: string | null; route: string }[] = [];
  for (const site of (sites.data ?? [])) {
    for (const a of ACTIONS) {
      const score = matchScore(site.slug, site.name, query);
      if (score > 0 || query.length < 2) {
        results.push({ score, id: `${a.action}-${site.id}`, label: `${a.label}: ${site.name}`, action: a.action, siteSlug: site.slug, route: `${a.route}${site.id}` });
      }
    }
  }
  if (query.length < 2) {
    results.push({ score: 1, id: 'sites', label: 'Sites', action: 'view', siteSlug: null, route: '/admin/sites' });
    results.push({ score: 1, id: 'billing', label: 'Billing', action: 'view', siteSlug: null, route: '/admin/billing' });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 20);
}
