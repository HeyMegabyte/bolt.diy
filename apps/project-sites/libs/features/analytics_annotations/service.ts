import type { Env } from '../../../src/types/env.js';
import { dbExecute, dbQuery, dbQueryOne } from '../../../src/services/db.js';

interface AnnRow { id: string; site_id: string; date: string; note: string; category: string; created_at: string }

export async function listAnnotations(env: Env, siteId: string): Promise<{ id: string; siteId: string; date: string; note: string; category: string; createdAt: string }[]> {
  const rows = await dbQuery<AnnRow>(env.DB, `SELECT id, site_id, date, note, category, created_at FROM analytics_annotations WHERE site_id=? AND deleted_at IS NULL ORDER BY date DESC LIMIT 100`, [siteId]);
  return (rows.data ?? []).map(r => ({ id: r.id, siteId: r.site_id, date: r.date, note: r.note, category: r.category, createdAt: r.created_at }));
}

export async function createAnnotation(env: Env, orgId: string, siteId: string, date: string, note: string, category: string): Promise<{ id: string }> {
  const site = await dbQueryOne<{ id: string }>(env.DB, `SELECT id FROM sites WHERE id=? AND org_id=? AND deleted_at IS NULL`, [siteId, orgId]);
  if (!site) throw new Error('site_not_found');
  const id = crypto.randomUUID();
  await dbExecute(env.DB, `INSERT INTO analytics_annotations (id, site_id, date, note, category, created_at, updated_at) VALUES (?,?,?,?,?,datetime('now'),datetime('now'))`, [id, siteId, date, note, category]);
  return { id };
}

export async function deleteAnnotation(env: Env, id: string): Promise<boolean> {
  await dbExecute(env.DB, `UPDATE analytics_annotations SET deleted_at=datetime('now') WHERE id=?`, [id]);
  return true;
}
