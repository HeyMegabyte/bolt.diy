import type { Env } from '../../../src/types/env.js';
import { dbExecute, dbQueryOne, dbQuery, dbInsert } from '../../../src/services/db.js';
import type { CloneResponse } from './schemas.js';

export async function cloneSite(env: Env, orgId: string, sourceSiteId: string, targetSlug: string, targetName: string): Promise<CloneResponse> {
  const src = await dbQueryOne<{ id: string; org_id: string; status: string }>(env.DB, `SELECT id, org_id, status FROM sites WHERE id=? AND org_id=? AND deleted_at IS NULL`, [sourceSiteId, orgId]);
  if (!src) throw new Error('source_not_found');

  const existing = await dbQueryOne<{ id: string }>(env.DB, `SELECT id FROM sites WHERE slug=? AND org_id=? AND deleted_at IS NULL`, [targetSlug, orgId]);
  if (existing) throw new Error('slug_taken');

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  await dbExecute(env.DB, `INSERT INTO sites (id, org_id, slug, name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [newId, orgId, targetSlug, targetName, 'draft', now, now]);

  const pages = await dbQuery<{ id: string; title: string; path: string; content: string; meta_json: string | null }>(env.DB, `SELECT id, title, path, content, meta_json FROM pages WHERE site_id=? AND deleted_at IS NULL`, [sourceSiteId]);
  let copied = 0;
  for (const p of (pages.data ?? [])) {
    await dbExecute(env.DB, `INSERT INTO pages (id, site_id, title, path, content, meta_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`, [crypto.randomUUID(), newId, p.title, p.path, p.content, p.meta_json, now, now]);
    copied++;
  }
  return { id: newId, slug: targetSlug, name: targetName, pagesCopied: copied };
}
