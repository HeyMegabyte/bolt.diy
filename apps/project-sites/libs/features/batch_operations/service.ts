import type { Env } from '../../../src/types/env.js';
import { dbQueryOne, dbExecute } from '../../../src/services/db.js';
import type { BatchResult } from './schemas.js';

export async function batchProcess(
  env: Env,
  orgId: string,
  siteIds: string[],
  action: string,
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  for (const siteId of siteIds) {
    const site = await dbQueryOne<{ id: string }>(
      env.DB,
      `SELECT id FROM sites WHERE id=? AND org_id=? AND deleted_at IS NULL`,
      [siteId, orgId],
    );
    if (!site) {
      results.push({ siteId, ok: false, message: 'not_found_or_not_owned' });
      continue;
    }
    try {
      // `dbExecute` RETURNS `{ error, changes }` (it does NOT throw), so the surrounding
      // try/catch never sees a D1 write failure — a bare `await` reported `ok: true`
      // even when the INSERT/UPDATE silently failed (a lying-success on a bulk
      // DESTRUCTIVE action: "delete 50 sites" could claim every one succeeded while the
      // rows survived). Capture the outcome and report it honestly per site.
      let error: string | null = null;
      let changes = 0;
      if (action === 'rebuild' || action === 'snapshot') {
        // Both queue a workflow_jobs row — same shape, only the job name differs.
        const jobName = action === 'rebuild' ? 'build' : 'snapshot';
        ({ error, changes } = await dbExecute(
          env.DB,
          `INSERT INTO workflow_jobs (id, org_id, site_id, job_name, status, created_at, updated_at) VALUES (?,?,?,?,'queued',datetime('now'),datetime('now'))`,
          [crypto.randomUUID(), orgId, siteId, jobName],
        ));
      } else if (action === 'delete') {
        ({ error, changes } = await dbExecute(
          env.DB,
          `UPDATE sites SET deleted_at=datetime('now') WHERE id=?`,
          [siteId],
        ));
      } else {
        // Unreachable in prod (the handler Zod-validates action ∈ ACTIONS), but never
        // silently claim success for an action we didn't actually run.
        results.push({ siteId, ok: false, message: `unknown_action:${action}` });
        continue;
      }
      if (error) {
        results.push({ siteId, ok: false, message: `${action}_failed: ${error}` });
      } else if (action === 'delete' && changes === 0) {
        // The site existed at the SELECT but the soft-delete matched no row — a race
        // deleted it first. Report honestly rather than a phantom success.
        results.push({ siteId, ok: false, message: 'not_found_or_already_deleted' });
      } else {
        results.push({ siteId, ok: true, message: `${action}_queued` });
      }
    } catch (e: unknown) {
      results.push({
        siteId,
        ok: false,
        message: e instanceof Error ? e.message : 'unknown_error',
      });
    }
  }
  return results;
}
