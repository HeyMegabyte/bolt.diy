/**
 * @module audit
 * @description Append-only audit log service for Project Sites.
 *
 * Records all significant state changes: auth events, permission changes,
 * billing mutations, site operations, and webhook processing decisions.
 * Logs are org-scoped and ordered by `created_at DESC` for pagination.
 *
 * ## Table: `audit_logs`
 *
 * | Column         | Type   | Description                          |
 * | -------------- | ------ | ------------------------------------ |
 * | `id`           | TEXT   | UUID primary key                     |
 * | `org_id`       | TEXT   | Organization that owns the log entry |
 * | `actor_id`     | TEXT?  | User who performed the action        |
 * | `action`       | TEXT   | Dot-notation event (e.g. `site.created`) |
 * | `target_type`  | TEXT?  | Entity type affected                 |
 * | `target_id`    | TEXT?  | Entity ID affected                   |
 * | `metadata_json`| TEXT?  | Arbitrary JSON context               |
 * | `request_id`   | TEXT?  | Correlation ID for distributed trace |
 * | `created_at`   | TEXT   | ISO-8601 timestamp                   |
 *
 * @example
 * ```ts
 * import { writeAuditLog, getAuditLogs } from '../services/audit.js';
 *
 * await writeAuditLog(env.DB, {
 *   org_id: orgId,
 *   actor_id: userId,
 *   action: 'site.created',
 *   target_type: 'site',
 *   target_id: siteId,
 *   request_id: c.get('requestId'),
 * });
 *
 * const { data } = await getAuditLogs(env.DB, orgId, { limit: 25, offset: 0 });
 * ```
 *
 * @packageDocumentation
 */

import type { CreateAuditLog } from '@project-sites/shared';
import { createAuditLogSchema } from '@project-sites/shared';
import { dbInsert, dbQuery } from './db.js';

/**
 * Turn dot-namespaced action codes into a readable fallback English line
 * so historic callers that don't pass `message` still write something
 * useful into the new column.
 *
 * @example
 * actionToFallbackMessage('site.snapshot.created')
 *   // → 'Site snapshot created'
 * actionToFallbackMessage('billing.subscription.canceled')
 *   // → 'Billing subscription canceled'
 */
function actionToFallbackMessage(action: string): string {
  const words = action.split('.').filter(Boolean);
  if (words.length === 0) return action;
  return words
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/_/g, ' ');
}

/**
 * Resolve the human-readable site reference for an audit MESSAGE — the site's
 * slug when known, otherwise the raw id as a last-resort fallback. Audit
 * messages must read like "…to site 'vito-salon'", never "…to site
 * '9df831e5-fba0-…-uuid'": a raw UUID in the activity feed / audit log is
 * meaningless to the operator reading it (they can't tell which site it is).
 *
 * @param slug   - The site slug (from `SELECT slug FROM sites`), or null/undefined if the lookup missed.
 * @param siteId - The site id (UUID) — the fallback when no slug is available.
 * @returns The slug when non-blank, else the `siteId`.
 * @example
 * auditSiteLabel('vito-salon', '9df8…') // → 'vito-salon'
 * auditSiteLabel(null, '9df8…')         // → '9df8…' (never a blank reference)
 */
export function auditSiteLabel(slug: string | null | undefined, siteId: string): string {
  return slug && slug.trim() ? slug.trim() : siteId;
}

/**
 * Async DB variant of {@link auditSiteLabel} for handlers that hold only the
 * site id — resolves the slug from D1 so an audit MESSAGE reads "…site
 * 'vito-salon'" instead of a raw UUID. Never throws (a lookup miss/failure
 * falls back to the id) so it can't break an audit write.
 *
 * @param db     - D1 binding.
 * @param siteId - The site id (UUID).
 * @returns The slug when the site exists, else `siteId` (never blank).
 * @example
 * const label = await auditSiteLabelDb(env.DB, siteId); // 'vito-salon' | siteId
 */
export async function auditSiteLabelDb(db: D1Database, siteId: string): Promise<string> {
  try {
    const row = await db.prepare('SELECT slug FROM sites WHERE id = ?').bind(siteId).first<{ slug: string }>();
    return auditSiteLabel(row?.slug, siteId);
  } catch {
    return siteId;
  }
}

/**
 * Write an audit log entry to D1.
 *
 * Failures are logged but **never throw** — audit logging must not break
 * the request flow.
 *
 * @param db    - D1Database binding.
 * @param entry - Audit log fields (validated via Zod).
 */
export async function writeAuditLog(db: D1Database, entry: CreateAuditLog): Promise<void> {
  try {
    const validated = createAuditLogSchema.parse(entry);

    // Synthesise a fallback `message` from the action namespace when the
    // caller didn't pass one — keeps older call-sites compiling while we
    // sweep them to provide explicit English summaries (Turn 6 migration).
    const message = validated.message ?? actionToFallbackMessage(validated.action);

    const { error } = await dbInsert(db, 'audit_logs', {
      id: crypto.randomUUID(),
      org_id: validated.org_id,
      actor_id: validated.actor_id ?? null,
      action: validated.action,
      message,
      target_type: validated.target_type ?? null,
      target_id: validated.target_id ?? null,
      metadata_json: validated.metadata_json ? JSON.stringify(validated.metadata_json) : null,
      ip_address: null,
      request_id: validated.request_id ?? null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          service: 'audit',
          message: 'Failed to write audit log',
          error,
          entry: {
            org_id: validated.org_id,
            action: validated.action,
            request_id: validated.request_id,
          },
        }),
      );
    }
  } catch (err) {
    // Truly never throw — audit logging must not break request flow
    console.error(
      JSON.stringify({
        level: 'error',
        service: 'audit',
        message: 'Audit log write threw unexpectedly',
        error: err instanceof Error ? err.message : String(err),
        action: entry?.action,
        org_id: entry?.org_id,
      }),
    );
  }
}

/**
 * Query audit logs for an organization with pagination.
 *
 * @param db      - D1Database binding.
 * @param orgId   - Organization ID to filter by.
 * @param options - Pagination options (`limit` defaults to 50, `offset` to 0).
 * @returns Paginated array of audit log entries.
 */
export async function getAuditLogs(
  db: D1Database,
  orgId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ data: unknown[]; error: string | null }> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const result = await dbQuery<unknown>(
    db,
    'SELECT * FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [orgId, limit, offset],
  );

  return { data: result.data, error: result.error };
}

/**
 * Query audit logs for a specific site within an organization.
 *
 * Retrieves logs where the target_id matches the site ID, OR where
 * metadata_json contains a reference to the site_id. This captures
 * both direct site actions and related actions (hostname changes, etc.).
 *
 * @param db     - D1Database binding.
 * @param orgId  - Organization ID to filter by.
 * @param siteId - Site ID to filter logs for.
 * @param options - Pagination options.
 * @returns Paginated array of audit log entries for the site.
 */
export async function getSiteAuditLogs(
  db: D1Database,
  orgId: string,
  siteId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ data: unknown[]; total: number; error: string | null }> {
  const limit = Math.min(options.limit ?? 100, 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const like = `%"site_id":"${siteId}"%`;

  const result = await dbQuery<unknown>(
    db,
    `SELECT * FROM audit_logs
     WHERE org_id = ?
       AND (target_id = ? OR metadata_json LIKE ?)
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [orgId, siteId, like, limit, offset],
  );

  // Total matching rows (unpaginated), so the endpoint can expose `total`/`has_more`
  // and a caller can page instead of silently capping at `limit`. Same WHERE as the
  // page query, no LIMIT/OFFSET. Without this a site with 353 logs looks like it has
  // exactly `limit` (verify-against-source-of-truth: display must reconcile to the store).
  const countResult = await dbQuery<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM audit_logs
     WHERE org_id = ?
       AND (target_id = ? OR metadata_json LIKE ?)`,
    [orgId, siteId, like],
  );
  const total = Number(
    (countResult.data?.[0] as { n?: number } | undefined)?.n ?? result.data.length,
  );

  return { data: result.data, total, error: result.error };
}
