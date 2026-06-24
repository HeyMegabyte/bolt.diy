/**
 * @module services/email_suppressions
 *
 * @description
 * §42/ADR-0019 — the email suppression store. Persists SES bounce/complaint
 * suppressions (produced by {@link parseSesNotification}) and answers
 * {@link isSuppressed} so the email seam never re-sends to a hard-bounced or
 * complained address.
 *
 * Platform-level, NOT tenant-scoped: SES reputation is account-wide, so a
 * suppression applies to every tenant's sends (re-sending to a hard bounce from
 * any tenant damages the shared sending domain). See migration 0575.
 *
 * @see services/ses_notifications.ts
 * @see migrations/0575_email_suppressions.sql
 */
import type { SesSuppression } from './ses_notifications.js';
import { dbExecute, dbQuery, dbQueryOne } from './db.js';

/** A persisted suppression row (operator view). */
export interface SuppressionRow {
  email: string;
  reason: string;
  sub_type: string | null;
  source_message_id: string | null;
  created_at: string;
}

/**
 * Persist suppression records idempotently and append each to the event log.
 *
 * @param db - The platform D1 binding.
 * @param records - Normalized suppressions from {@link parseSesNotification}.
 * @returns `{ suppressed }` — the count of NEWLY-suppressed addresses (rows that
 *   already existed are no-ops via `INSERT OR IGNORE`, so a replayed webhook is
 *   safe).
 *
 * @example
 * await recordSuppressions(env.DB, parseSesNotification(snsBody));
 */
export async function recordSuppressions(
  db: D1Database,
  records: readonly SesSuppression[],
): Promise<{ suppressed: number }> {
  let suppressed = 0;
  for (const r of records) {
    const now = new Date().toISOString();
    // INSERT OR IGNORE keeps the FIRST suppression reason — idempotent replay.
    const ins = await dbExecute(
      db,
      `INSERT OR IGNORE INTO email_suppressions (email, reason, sub_type, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [r.email, r.reason, r.subType, r.sourceMessageId, now],
    );
    if (ins.changes > 0) suppressed++;
    // Append every notification to the audit log regardless of dedup.
    await dbExecute(
      db,
      `INSERT INTO email_events (id, email, type, sub_type, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), r.email, r.reason, r.subType, r.sourceMessageId, now],
    );
  }
  return { suppressed };
}

/**
 * Whether an address is on the suppression list (case-insensitive).
 *
 * @param db - The platform D1 binding.
 * @param email - Any-case recipient address.
 * @returns true when the address has hard-bounced or complained.
 */
export async function isSuppressed(db: D1Database, email: string): Promise<boolean> {
  const row = await dbQueryOne<{ email: string }>(
    db,
    `SELECT email FROM email_suppressions WHERE email = ? LIMIT 1`,
    [email.trim().toLowerCase()],
  );
  return row !== null;
}

/**
 * List suppressed addresses, newest first (operator view). Capped at 1000.
 *
 * @param db - The platform D1 binding.
 * @param limit - Max rows (1-1000, default 200).
 */
export async function listSuppressions(db: D1Database, limit = 200): Promise<SuppressionRow[]> {
  const capped = Math.max(1, Math.min(Math.floor(limit) || 200, 1000));
  const { data } = await dbQuery<SuppressionRow>(
    db,
    `SELECT email, reason, sub_type, source_message_id, created_at
       FROM email_suppressions ORDER BY created_at DESC LIMIT ?`,
    [capped],
  );
  return data;
}

/**
 * Manually un-suppress an address (operator action — a customer who fixed their
 * mailbox). Idempotent: removing an absent address is a no-op.
 *
 * @returns `{ removed }` — true when a row was deleted.
 */
export async function removeSuppression(
  db: D1Database,
  email: string,
): Promise<{ removed: boolean }> {
  const { changes } = await dbExecute(db, `DELETE FROM email_suppressions WHERE email = ?`, [
    email.trim().toLowerCase(),
  ]);
  return { removed: changes > 0 };
}
