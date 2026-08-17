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
  // dbExecute returns { error } (it never throws) — a bare await ignored a failed INSERT
  // and still returned { id } → the handler 201'd a phantom annotation (lying-success).
  const { error } = await dbExecute(env.DB, `INSERT INTO analytics_annotations (id, site_id, date, note, category, created_at, updated_at) VALUES (?,?,?,?,?,datetime('now'),datetime('now'))`, [id, siteId, date, note, category]);
  if (error) throw new Error('annotation_create_failed');
  return { id };
}

export async function deleteAnnotation(env: Env, orgId: string, id: string): Promise<boolean> {
  // Org-scope the delete via annotation.site_id → sites.org_id so a caller can't soft-delete
  // ANOTHER org's annotation (the old id-only WHERE was an IDOR). Capture the result: a failed
  // write throws; a no-row match (wrong id / not this org / already gone) returns false so the
  // handler 404s instead of a lying 204.
  const { error, changes } = await dbExecute(
    env.DB,
    `UPDATE analytics_annotations SET deleted_at=datetime('now')
       WHERE id=? AND deleted_at IS NULL
         AND site_id IN (SELECT id FROM sites WHERE org_id=? AND deleted_at IS NULL)`,
    [id, orgId],
  );
  if (error) throw new Error('annotation_delete_failed');
  return changes > 0;
}
