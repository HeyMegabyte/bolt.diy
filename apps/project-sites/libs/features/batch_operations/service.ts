import type { Env } from '../../../src/types/env.js';
import { dbQueryOne, dbExecute } from '../../../src/services/db.js';
import type { BatchResult } from './schemas.js';

export async function batchProcess(env: Env, orgId: string, siteIds: string[], action: string): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  for (const siteId of siteIds) {
    const site = await dbQueryOne<{ id: string }>(env.DB, `SELECT id FROM sites WHERE id=? AND org_id=? AND deleted_at IS NULL`, [siteId, orgId]);
    if (!site) { results.push({ siteId, ok: false, message: 'not_found_or_not_owned' }); continue; }
    try {
      if (action === 'rebuild') {
        await dbExecute(env.DB, `INSERT INTO workflow_jobs (id, org_id, site_id, type, status, created_at, updated_at) VALUES (?,?,?,?,'queued',datetime('now'),datetime('now'))`, [crypto.randomUUID(), orgId, siteId, 'build']);
      } else if (action === 'snapshot') {
        await dbExecute(env.DB, `INSERT INTO workflow_jobs (id, org_id, site_id, type, status, created_at, updated_at) VALUES (?,?,?,?,'queued',datetime('now'),datetime('now'))`, [crypto.randomUUID(), orgId, siteId, 'snapshot']);
      } else if (action === 'delete') {
        await dbExecute(env.DB, `UPDATE sites SET deleted_at=datetime('now') WHERE id=?`, [siteId]);
      }
      results.push({ siteId, ok: true, message: `${action}_queued` });
    } catch (e: unknown) {
      results.push({ siteId, ok: false, message: e instanceof Error ? e.message : 'unknown_error' });
    }
  }
  return results;
}
