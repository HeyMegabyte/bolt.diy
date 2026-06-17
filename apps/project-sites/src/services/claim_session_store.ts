/**
 * claimyour.site — D1 persistence shell for the build-session state machine.
 *
 * @remarks
 * Thin store that round-trips a {@link BuildSession} to the `claim_build_sessions`
 * D1 table and drives transitions through the pure {@link reduceBuildSession}
 * reducer. The idempotency guarantees live in the reducer; this shell adds one
 * property of its own: **a no-op transition is never written** (`next === current`
 * → skip the `UPDATE`), so a refresh / double-click that the reducer turns into a
 * no-op also produces zero DB churn and zero risk of a duplicate build kick.
 *
 * @example
 * ```ts
 * // on a claim-link hit:
 * const s = await loadOrCreateSession(env.DB, sessionId, leadId);
 * if (canStartBuild(s)) await applyClaimEvent(env.DB, sessionId, leadId, { type: 'START_BUILD', siteId });
 * // on an edit while building:
 * await applyClaimEvent(env.DB, sessionId, leadId, { type: 'EDIT_RECEIVED', context });
 * ```
 */
import type { D1Database } from '@cloudflare/workers-types';
import { dbQueryOne, dbInsert, dbUpdate } from './db.js';
import {
  createBuildSession,
  reduceBuildSession,
  BuildSessionSchema,
  type BuildSession,
  type BuildSessionEvent,
} from './claim_build_session.js';

const TABLE = 'claim_build_sessions';

/** The persisted row shape (snake_case columns; booleans as 0/1, context as JSON text). */
interface SessionRow {
  session_id: string;
  lead_id: string;
  site_id: string | null;
  status: string;
  preview_url: string | null;
  pending_rebuild: number;
  pending_context: string | null;
  attempts: number;
  error: string | null;
}

/** Row → validated domain session. */
function rowToSession(row: SessionRow): BuildSession {
  return BuildSessionSchema.parse({
    sessionId: row.session_id,
    leadId: row.lead_id,
    siteId: row.site_id ?? null,
    status: row.status,
    previewUrl: row.preview_url ?? null,
    pendingRebuild: !!row.pending_rebuild,
    pendingContext: row.pending_context
      ? (JSON.parse(row.pending_context) as Record<string, unknown>)
      : null,
    attempts: row.attempts,
    error: row.error ?? null,
  });
}

/** Domain session → row columns (for insert + update). */
function sessionToRow(s: BuildSession): SessionRow {
  return {
    session_id: s.sessionId,
    lead_id: s.leadId,
    site_id: s.siteId,
    status: s.status,
    preview_url: s.previewUrl,
    pending_rebuild: s.pendingRebuild ? 1 : 0,
    pending_context: s.pendingContext ? JSON.stringify(s.pendingContext) : null,
    attempts: s.attempts,
    error: s.error,
  };
}

/**
 * Read a session by id, or insert a fresh `pending` one when absent.
 *
 * @param db - D1 binding.
 * @param sessionId - The build-session id.
 * @param leadId - The claimed lead this session builds for.
 * @returns The current (or newly-created) {@link BuildSession}.
 */
export async function loadOrCreateSession(
  db: D1Database,
  sessionId: string,
  leadId: string,
): Promise<BuildSession> {
  const row = await dbQueryOne<SessionRow>(db, `SELECT * FROM ${TABLE} WHERE session_id = ?`, [
    sessionId,
  ]);
  if (row) return rowToSession(row);
  const session = createBuildSession(sessionId, leadId);
  await dbInsert(db, TABLE, sessionToRow(session) as unknown as Record<string, unknown>);
  return session;
}

/**
 * Apply an event: load → {@link reduceBuildSession} → persist only on change.
 *
 * @param db - D1 binding.
 * @param sessionId - The build-session id.
 * @param leadId - The lead (used when the session must be created first).
 * @param event - The event to apply.
 * @returns The next {@link BuildSession} (unchanged on a no-op transition).
 */
export async function applyClaimEvent(
  db: D1Database,
  sessionId: string,
  leadId: string,
  event: BuildSessionEvent,
): Promise<BuildSession> {
  const current = await loadOrCreateSession(db, sessionId, leadId);
  const next = reduceBuildSession(current, event);
  // No-op transitions return the SAME reference (reducer is total) — skip the
  // write entirely so a refresh/double-click produces zero DB churn.
  if (next === current) return current;
  const row = sessionToRow(next);
  await dbUpdate(
    db,
    TABLE,
    {
      site_id: row.site_id,
      status: row.status,
      preview_url: row.preview_url,
      pending_rebuild: row.pending_rebuild,
      pending_context: row.pending_context,
      attempts: row.attempts,
      error: row.error,
    },
    'session_id = ?',
    [sessionId],
  );
  return next;
}

/**
 * Read a session by id without creating one.
 *
 * @param db - D1 binding.
 * @param sessionId - The build-session id.
 * @returns The {@link BuildSession} or `null` when absent.
 */
export async function getSession(db: D1Database, sessionId: string): Promise<BuildSession | null> {
  const row = await dbQueryOne<SessionRow>(db, `SELECT * FROM ${TABLE} WHERE session_id = ?`, [
    sessionId,
  ]);
  return row ? rowToSession(row) : null;
}
