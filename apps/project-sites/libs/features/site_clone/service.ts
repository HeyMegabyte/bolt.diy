import type { Env } from '../../../src/types/env.js';
import { dbExecute, dbQueryOne } from '../../../src/services/db.js';
import type { CloneResponse } from './schemas.js';

export async function cloneSite(env: Env, orgId: string, sourceSiteId: string, targetSlug: string, targetName: string): Promise<CloneResponse> {
  const src = await dbQueryOne<{ id: string; org_id: string; status: string }>(env.DB, `SELECT id, org_id, status FROM sites WHERE id=? AND org_id=? AND deleted_at IS NULL`, [sourceSiteId, orgId]);
  if (!src) throw new Error('source_not_found');

  const existing = await dbQueryOne<{ id: string }>(env.DB, `SELECT id FROM sites WHERE slug=? AND org_id=? AND deleted_at IS NULL`, [targetSlug, orgId]);
  if (existing) throw new Error('slug_taken');

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  // sites has no `name` column — it's `business_name`. (Was `name` → the INSERT
  // threw `no such column` → cloneSite 500'd on every call.)
  await dbExecute(env.DB, `INSERT INTO sites (id, org_id, slug, business_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [newId, orgId, targetSlug, targetName, 'draft', now, now]);

  // No `pages`/`site_pages` table exists in prod — per-site page content lives
  // in R2 (sites/{slug}/{version}/…), not D1. The old SELECT was swallowed to
  // empty and the INSERT threw `no such table: pages` (a real 500) the moment a
  // source site had rows. Clone the site row only; deep-copying the source's R2
  // files is a separate concern (boarded).
  return { id: newId, slug: targetSlug, name: targetName, pagesCopied: 0 };
}
