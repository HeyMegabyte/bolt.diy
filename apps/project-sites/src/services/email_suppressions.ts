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
 * @returns `{ suppressed, failed }` — `suppressed` counts NEWLY-suppressed
 *   addresses (existing rows are no-ops via `INSERT OR IGNORE`, so a replayed
 *   webhook is safe); `failed` counts suppression WRITES that ERRORED (D1
 *   outage/schema drift). A `failed > 0` result MUST be surfaced as a non-2xx by
 *   the SES webhook so SNS/Hookdeck retries the idempotent notification — the
 *   suppression is compliance-critical and must never be silently lost.
 *
 * @example
 * await recordSuppressions(env.DB, parseSesNotification(snsBody));
 */
export async function recordSuppressions(
  db: D1Database,
  records: readonly SesSuppression[],
): Promise<{ suppressed: number; failed: number }> {
  let suppressed = 0;
  let failed = 0;
  for (const r of records) {
    const now = new Date().toISOString();
    // INSERT OR IGNORE keeps the FIRST suppression reason — idempotent replay.
    const ins = await dbExecute(
      db,
      `INSERT OR IGNORE INTO email_suppressions (email, reason, sub_type, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [r.email, r.reason, r.subType, r.sourceMessageId, now],
    );
    // The suppression WRITE is compliance-critical: a dropped row means we keep
    // emailing a hard-bounced/complained address (SES reputation + account-suspension
    // risk). `dbExecute` NEVER throws — it swallows the D1 error and returns `{ error }`
    // — so a bare `if (ins.changes > 0)` silently lost the drop (INVERTED severity vs the
    // audit write below, which WAS error-logged). Count it as `failed` so the SES webhook
    // 5xxes → SNS retries the idempotent notification (INSERT OR IGNORE = safe replay),
    // and LOG it (email masked — PII) so the drop is observable.
    if (ins.error) {
      failed++;
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'email_suppressions',
          message: 'dropped email_suppressions write',
          reason: r.reason,
          source_message_id: r.sourceMessageId,
          error: ins.error,
        }),
      );
    } else if (ins.changes > 0) {
      suppressed++;
    }
    // Append every notification to the audit log regardless of dedup.
    const audit = await dbExecute(
      db,
      `INSERT INTO email_events (id, email, type, sub_type, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), r.email, r.reason, r.subType, r.sourceMessageId, now],
    );
    // Best-effort audit append — never break suppression processing, but LOG a dropped
    // write (email masked — PII) so a gap in the email_events trail is observable.
    if (audit.error) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'email_suppressions',
          message: 'dropped email_events audit write',
          reason: r.reason,
          source_message_id: r.sourceMessageId,
          error: audit.error,
        }),
      );
    }
  }
  return { suppressed, failed };
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
