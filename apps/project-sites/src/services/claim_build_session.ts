/**
 * claimyour.site — the idempotent build-session state machine.
 *
 * @remarks
 * A claim-link click resolves a lead, opens a build session, and kicks an AI
 * site build that must survive the user leaving the page and must NOT restart on
 * a refresh or double-click. This module is the pure, persistence-free core of
 * that flow: a reducer over a typed {@link BuildSession} whose transitions encode
 * the idempotency guarantees, so the route / Durable Object that persists the
 * session (next slice) is a thin shell around proven logic.
 *
 * Guarantees:
 *  - **One build per click** — `START_BUILD` only advances `pending`/`failed`;
 *    on an already-`building` (or `completed`) session it's a no-op, so a refresh
 *    or repeated claim-link hit never spawns a duplicate build.
 *  - **Edits are never lost** — `EDIT_RECEIVED` stashes a merged `pendingContext`
 *    whether the build is in flight or finished.
 *  - **"Rebuild with my changes"** — `REQUEST_REBUILD` only fires from a finished
 *    session and folds the pending edits into the next build.
 *
 * @example
 * ```ts
 * let s = createBuildSession(sessionId, leadId);
 * if (canStartBuild(s)) s = reduceBuildSession(s, { type: 'START_BUILD', siteId });
 * // …user edits the prefilled form while it builds…
 * s = reduceBuildSession(s, { type: 'EDIT_RECEIVED', context: { tone: 'warm' } });
 * s = reduceBuildSession(s, { type: 'BUILD_COMPLETED', previewUrl });
 * s = reduceBuildSession(s, { type: 'REQUEST_REBUILD' }); // applies the edits
 * ```
 */
import { z } from 'zod';

/** Lifecycle of a claim build session. */
export const BuildStatusSchema = z.enum(['pending', 'building', 'completed', 'failed']);
export type BuildStatus = z.infer<typeof BuildStatusSchema>;

/** The persisted build-session shape (Zod = source of truth). */
export const BuildSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    leadId: z.string().min(1),
    siteId: z.string().nullable(),
    status: BuildStatusSchema,
    previewUrl: z.string().nullable(),
    pendingRebuild: z.boolean(),
    pendingContext: z.record(z.unknown()).nullable(),
    attempts: z.number().int().min(0),
    error: z.string().nullable(),
  })
  .strict();

export type BuildSession = z.infer<typeof BuildSessionSchema>;

/** Events that drive the session. */
export type BuildSessionEvent =
  | { type: 'START_BUILD'; siteId?: string }
  | { type: 'BUILD_COMPLETED'; previewUrl: string; siteId?: string }
  | { type: 'BUILD_FAILED'; error: string }
  | { type: 'EDIT_RECEIVED'; context: Record<string, unknown> }
  | { type: 'REQUEST_REBUILD' };

/** A fresh session for a claimed lead — `pending`, nothing built yet. */
export function createBuildSession(sessionId: string, leadId: string): BuildSession {
  return {
    sessionId,
    leadId,
    siteId: null,
    status: 'pending',
    previewUrl: null,
    pendingRebuild: false,
    pendingContext: null,
    attempts: 0,
    error: null,
  };
}

/**
 * Whether a build may be kicked off now. The route calls this on every
 * claim-link hit so a refresh / re-click on an in-flight or finished session
 * does NOT spawn a duplicate build.
 *
 * @param s - The current session.
 * @returns `true` only when `pending` (first build) or `failed` (retry).
 */
export function canStartBuild(s: BuildSession): boolean {
  return s.status === 'pending' || s.status === 'failed';
}

/**
 * Apply an event to a session. Pure + total: every invalid/redundant transition
 * is a no-op that returns the input unchanged (never throws), which is exactly
 * what makes the flow idempotent under refreshes and out-of-order callbacks.
 *
 * @param s - The current session.
 * @param ev - The event to apply.
 * @returns The next session (or `s` unchanged for a no-op transition).
 */
export function reduceBuildSession(s: BuildSession, ev: BuildSessionEvent): BuildSession {
  switch (ev.type) {
    case 'START_BUILD':
      // Only a not-running session may start; refresh on building/completed = no-op.
      if (s.status !== 'pending' && s.status !== 'failed') return s;
      return {
        ...s,
        status: 'building',
        attempts: s.attempts + 1,
        error: null,
        ...(ev.siteId ? { siteId: ev.siteId } : {}),
      };

    case 'BUILD_COMPLETED':
      if (s.status !== 'building') return s; // ignore a stray completion
      return {
        ...s,
        status: 'completed',
        previewUrl: ev.previewUrl,
        pendingContext: null, // the just-finished build consumed it
        ...(ev.siteId ? { siteId: ev.siteId } : {}),
      };

    case 'BUILD_FAILED':
      if (s.status !== 'building') return s;
      return { ...s, status: 'failed', error: ev.error };

    case 'EDIT_RECEIVED':
      // Always retain edits — in flight OR finished — as the next build's context.
      return {
        ...s,
        pendingRebuild: true,
        pendingContext: { ...(s.pendingContext ?? {}), ...ev.context },
      };

    case 'REQUEST_REBUILD':
      // Only from a finished session; the pending edits ride into the new build.
      if (s.status !== 'completed' && s.status !== 'failed') return s;
      return {
        ...s,
        status: 'building',
        attempts: s.attempts + 1,
        pendingRebuild: false, // consumed — now in progress
        error: null,
      };

    default:
      return s;
  }
}
