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

/** Result of a DSAR erasure — identity rows soft-deleted + correlated events purged. */
export interface DsarDeleteResult {
  /** visitor_identities rows soft-deleted. */
  identities: number;
  /** visitor_events rows hard-deleted (anonymous, correlated by session_id). */
  events: number;
}

/**
 * Erase all of a subject's personal data within a site (GDPR Art.17 cascade).
 *
 * Two-stage: (1) hard-delete any anonymous `visitor_events` whose `session_id`
 * correlates to the subject's known client identifiers (`visitor_id` / `anon_id`)
 * — that table carries no PII column or `deleted_at`, so erasure is a hard DELETE;
 * (2) soft-delete the `visitor_identities` rows themselves (where the PII lives).
 *
 * @returns Counts of identity rows soft-deleted and event rows purged.
 */
export async function deleteVisitorData(
  db: D1Database,
  siteId: string,
  subject: string,
): Promise<DsarDeleteResult> {
  const { clause, param } = subjectClause(subject);

  // 1. Gather the subject's client identifiers so correlated anonymous events
  //    can be erased too (a bare identity-row delete leaves their events behind).
  const { data: idRows } = await dbQuery<{ visitor_id: string | null; anon_id: string | null }>(
    db,
    `SELECT visitor_id, anon_id FROM visitor_identities WHERE site_id = ? AND ${clause}`,
    [siteId, param],
  );
  const clientIds = [
    ...new Set(idRows.flatMap((r) => [r.visitor_id, r.anon_id]).filter((v): v is string => !!v)),
  ];

  // 2. Hard-delete correlated events (no deleted_at column → true erasure).
  let events = 0;
  if (clientIds.length > 0) {
    const placeholders = clientIds.map(() => '?').join(', ');
    const { changes } = await dbExecute(
      db,
      `DELETE FROM visitor_events WHERE site_id = ? AND session_id IN (${placeholders})`,
      [siteId, ...clientIds],
    );
    events = changes ?? 0;
  }

  // 3. Soft-delete the identity rows.
  const { changes } = await dbExecute(
    db,
    `UPDATE visitor_identities
     SET deleted_at = datetime('now')
     WHERE site_id = ? AND ${clause} AND deleted_at IS NULL`,
    [siteId, param],
  );

  return { identities: changes ?? 0, events };
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
  // audit_logs has no `site_id`/`resource_type`/`resource_id` columns (real:
  // target_type/target_id/metadata_json). The old shape threw `no such column`
  // → dbInsert swallowed it → the DSAR export/delete audit row NEVER landed.
  await dbInsert(db, 'audit_logs', {
    id: crypto.randomUUID(),
    org_id: opts.orgId,
    actor_id: opts.actorId,
    action: `dsar.${opts.mode}`,
    target_type: 'visitor_identity',
    target_id: opts.siteId,
    metadata_json: JSON.stringify({
      subject: opts.subject,
      count: opts.count,
      site_id: opts.siteId,
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
