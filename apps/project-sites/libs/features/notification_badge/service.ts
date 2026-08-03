import type { Env } from '../../../src/types/env.js';
import { dbQueryOne } from '../../../src/services/db.js';

interface CountRow { cnt: number }

export async function getBadgeCounts(env: Env, orgId: string): Promise<{ total: number; alerts: number; builds: number }> {
  const [alerts, failedBuilds] = await Promise.all([
    dbQueryOne<CountRow>(env.DB, `SELECT COUNT(*) as cnt FROM audit_logs WHERE org_id=? AND action LIKE '%.failed%' AND created_at > datetime('now','-7 days')`, [orgId]),
    dbQueryOne<CountRow>(env.DB, `SELECT COUNT(*) as cnt FROM workflow_jobs WHERE org_id=? AND status='failed' AND deleted_at IS NULL`, [orgId]),
  ]);
  const a = Number(alerts?.cnt ?? 0), f = Number(failedBuilds?.cnt ?? 0);
  return { total: a + f, alerts: a, builds: f };
}
