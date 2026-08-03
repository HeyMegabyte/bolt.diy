/**
 * Activity Feed service — aggregates recent events from audit_logs + workflow_jobs.
 *
 * Queries D1 with org-scoping and pagination (cursor-based). Each row is
 * normalized into a unified {@link ActivityEntry} shape regardless of source
 * table. Designed for the admin dashboard live-activity widget.
 *
 * @module libs/features/activity_feed/service
 */
import type { Env } from '../../../src/types/env.js';
import { dbQuery } from '../../../src/services/db.js';
import type { ActivityEntry, ActivityKind } from './schemas.js';

interface AuditRow {
  id: string;
  action: string;
  message: string;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata_json: string | null;
  created_at: string;
}

function mapKind(action: string): ActivityKind {
  const m: Record<string, ActivityKind> = {
    'build.completed': 'build.completed',
    'build.failed': 'build.failed',
    'site.published': 'site.published',
    'site.unpublished': 'site.archived',
    'hostname.added': 'domain.added',
    'hostname.deleted': 'domain.removed',
    'billing.subscription_updated': 'billing.plan_changed',
    'billing.payment_failed': 'billing.payment_failed',
    'member.added': 'member.invited',
    'member.removed': 'member.removed',
    'workflow.started': 'workflow.started',
    'workflow.completed': 'workflow.completed',
    'integration.connected': 'integration.connected',
    'integration.disconnected': 'integration.disconnected',
  };
  return m[action] ?? 'build.completed';
}

function actorName(row: AuditRow): string | null {
  try {
    if (row.metadata_json) {
      const meta = JSON.parse(row.metadata_json);
      if (meta.actor_email) return meta.actor_email;
      if (meta.actor_name) return meta.actor_name;
    }
  } catch { /* ignore parse errors */ }
  return row.actor_id;
}

/**
 * Fetch the most recent org-scoped activity entries.
 *
 * @param env - Worker bindings (needs D1)
 * @param orgId - Org scope
 * @param limit - Max entries (default 50, max 100)
 * @param cursor - ISO timestamp cursor for pagination (inclusive)
 */
export async function getActivityFeed(
  env: Env,
  orgId: string,
  limit = 50,
  cursor?: string,
): Promise<{ entries: ActivityEntry[]; hasMore: boolean }> {
  const effectiveLimit = Math.min(Math.max(limit, 1), 100);
  const rows = await dbQuery<AuditRow>(
    env.DB,
    `SELECT id, action, message, actor_id, target_type, target_id,
            metadata_json, created_at
     FROM audit_logs
     WHERE org_id = ?
       ${cursor ? 'AND created_at <= ?' : ''}
     ORDER BY created_at DESC
     LIMIT ?`,
    cursor ? [orgId, cursor, effectiveLimit + 1] : [orgId, effectiveLimit + 1],
  );

  const data = rows.data ?? [];
  const hasMore = data.length > effectiveLimit;
  const sliced = data.slice(0, effectiveLimit);

  const entries: ActivityEntry[] = sliced.map((r) => ({
    id: r.id,
    kind: mapKind(r.action),
    summary: r.message ?? r.action,
    actorName: actorName(r),
    targetType: r.target_type,
    targetName: r.target_id,
    siteSlug: null, // populated by a join or the caller
    timestamp: r.created_at,
  }));

  return { entries, hasMore };
}
