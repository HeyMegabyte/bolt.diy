import type { Env } from '../../../src/types/env.js';
import { dbQueryOne } from '../../../src/services/db.js';
import type { CompareResponse, DiffRow } from './schemas.js';

interface SiteInfo {
  slug: string;
  name: string;
  status: string;
  build_version: string | null;
  lighthouse: number | null;
  domain_count: number;
  updated_at: string;
}

async function getSiteInfo(env: Env, siteId: string): Promise<SiteInfo | null> {
  // Compare only REAL, populated sites columns. The old query selected `s.name`
  // (phantom — it's `business_name`), counted `FROM pages` (that table doesn't
  // exist in prod), and filtered `workflow_jobs.type='build'` (phantom — real col
  // is `job_name`, and the table is empty platform-wide). Every one of those threw
  // `no such column`/`no such table` → swallowed → getSiteInfo returned null →
  // compareSites returned null (a blank comparison for every pair). Now we compare
  // status, custom-domain count (real hostnames), build version + lighthouse score
  // (real sites columns) — data brian's sites actually have.
  return dbQueryOne<SiteInfo>(
    env.DB,
    `SELECT s.slug, s.business_name AS name, s.status,
            s.current_build_version AS build_version, s.lighthouse_score AS lighthouse,
            (SELECT COUNT(*) FROM hostnames
               WHERE site_id = s.id AND deleted_at IS NULL AND status = 'active') AS domain_count,
            s.updated_at
       FROM sites s WHERE s.id = ? AND s.deleted_at IS NULL`,
    [siteId],
  );
}

export async function compareSites(env: Env, siteIdA: string, siteIdB: string): Promise<CompareResponse | null> {
  const [a, b] = await Promise.all([getSiteInfo(env, siteIdA), getSiteInfo(env, siteIdB)]);
  if (!a || !b) return null;
  const d = (va: unknown, vb: unknown, label: string): DiffRow => {
    const sa = String(va ?? '-'), sb = String(vb ?? '-'), diff = sa === sb ? null : `${label} differs`;
    return { metric: label, valueA: sa, valueB: sb, diff };
  };
  return {
    siteA: { slug: a.slug, name: a.name },
    siteB: { slug: b.slug, name: b.name },
    rows: [
      d(a.status, b.status, 'Status'),
      d(a.domain_count, b.domain_count, 'Custom Domains'),
      d(a.build_version ?? 'none', b.build_version ?? 'none', 'Build Version'),
      d(a.lighthouse ?? '—', b.lighthouse ?? '—', 'Lighthouse'),
      d(a.updated_at, b.updated_at, 'Updated'),
    ],
  };
}
