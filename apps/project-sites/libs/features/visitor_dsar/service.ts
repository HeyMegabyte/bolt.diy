import type { D1Database } from '@cloudflare/workers-types';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../../../src/services/db.js';
import type { VisitorIdentityExport } from './schemas.js';

/** Detect whether the subject string looks like an email address. */
function isEmail(subject: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject);
}

/** Build the WHERE fragment and params for a subject lookup. */
function subjectClause(subject: string): { clause: string; param: string } {
  return isEmail(subject)
    ? { clause: 'email = ?', param: subject }
    : { clause: 'visitor_id = ?', param: subject };
}

/**
 * Retrieve visitor_identities rows for a subject within a site.
 *
 * @returns Array of matching rows (may be empty).
 */
export async function exportVisitorData(
  db: D1Database,
  siteId: string,
  subject: string,
): Promise<VisitorIdentityExport[]> {
  const { clause, param } = subjectClause(subject);
  const { data } = await dbQuery<VisitorIdentityExport>(
    db,
    `SELECT id, org_id, site_id, email, phone, visitor_id, anon_id,
            display_name, first_seen_at, last_seen_at, channel_flags, metadata_json
     FROM visitor_identities
     WHERE site_id = ? AND ${clause} AND deleted_at IS NULL`,
    [siteId, param],
  );
  return data;
}

/**
 * Soft-delete all visitor_identities rows for a subject within a site.
 *
 * @returns Number of rows marked deleted.
 */
export async function deleteVisitorData(
  db: D1Database,
  siteId: string,
  subject: string,
): Promise<number> {
  const { clause, param } = subjectClause(subject);
  const { changes } = await dbExecute(
    db,
    `UPDATE visitor_identities
     SET deleted_at = datetime('now')
     WHERE site_id = ? AND ${clause} AND deleted_at IS NULL`,
    [siteId, param],
  );
  return changes;
}

/**
 * Write an audit log entry for a DSAR action.
 *
 * Fire-and-forget; caller uses executionCtx.waitUntil to avoid blocking the response.
 */
export async function writeDsarAuditLog(
  db: D1Database,
  opts: {
    orgId: string;
    siteId: string;
    actorId: string;
    mode: 'export' | 'delete';
    subject: string;
    count: number;
  },
): Promise<void> {
  await dbInsert(db, 'audit_logs', {
    id: crypto.randomUUID(),
    org_id: opts.orgId,
    site_id: opts.siteId,
    actor_id: opts.actorId,
    action: `dsar.${opts.mode}`,
    resource_type: 'visitor_identity',
    resource_id: opts.siteId,
    metadata_json: JSON.stringify({
      subject: opts.subject,
      count: opts.count,
    }),
  });
}

/**
 * Verify that the given siteId belongs to the given orgId and is not deleted.
 *
 * @returns true if ownership is confirmed, false otherwise.
 */
export async function verifySiteOwnership(
  db: D1Database,
  siteId: string,
  orgId: string,
): Promise<boolean> {
  const row = await dbQueryOne<{ id: string }>(
    db,
    'SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  return row !== null;
}
