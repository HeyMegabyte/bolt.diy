import type { Env } from '../../../src/types/env.js';
import { dbQueryOne } from '../../../src/services/db.js';
import type { CompareResponse, DiffRow } from './schemas.js';

interface SiteInfo { slug: string; name: string; page_count: number; build_count: number; domain_count: number; status: string; last_build: string | null; updated_at: string }

async function getSiteInfo(env: Env, siteId: string): Promise<SiteInfo | null> {
  return dbQueryOne<SiteInfo>(env.DB, `SELECT s.slug, s.name, (SELECT COUNT(*) FROM pages WHERE site_id=s.id AND deleted_at IS NULL) as page_count, (SELECT COUNT(*) FROM workflow_jobs WHERE site_id=s.id AND type='build' AND deleted_at IS NULL) as build_count, (SELECT COUNT(*) FROM hostnames WHERE site_id=s.id AND deleted_at IS NULL AND status='active') as domain_count, s.status, (SELECT MAX(created_at) FROM workflow_jobs WHERE site_id=s.id AND type='build' AND status='completed') as last_build, s.updated_at FROM sites s WHERE s.id=? AND s.deleted_at IS NULL`, [siteId]);
}

export async function compareSites(env: Env, siteIdA: string, siteIdB: string): Promise<CompareResponse | null> {
  const [a, b] = await Promise.all([getSiteInfo(env, siteIdA), getSiteInfo(env, siteIdB)]);
  if (!a || !b) return null;
  const d = (va: unknown, vb: unknown, label: string): DiffRow => {
    const sa = String(va ?? '-'), sb = String(vb ?? '-'), diff = sa === sb ? null : `${label} differs`;
    return { metric: label, valueA: sa, valueB: sb, diff };
  };
  return { siteA: { slug: a.slug, name: a.name }, siteB: { slug: b.slug, name: b.name }, rows: [d(a.page_count, b.page_count, 'Pages'), d(a.build_count, b.build_count, 'Builds'), d(a.domain_count, b.domain_count, 'Domains'), d(a.status, b.status, 'Status'), d(a.last_build, b.last_build, 'Last Build'), d(a.updated_at, b.updated_at, 'Updated')] };
}
