/**
 * claimyour.site — build-completion orchestration (#1).
 *
 * @remarks
 * The glue the generation workflow calls when a claim build finishes or fails:
 * it applies the terminal session event ({@link reduceBuildSession}'s
 * `BUILD_COMPLETED` / `BUILD_FAILED`) and emails the owner (preview link on
 * success, a recovery path on failure). All side-effects are injected
 * ({@link CompletionDeps}) so this orchestration is unit-provable with no
 * D1/email/network, and it NEVER throws — a missing lead email or a failed send
 * just yields `emailed:false`; the terminal event is always applied.
 *
 * @example
 * ```ts
 * await handleClaimBuildResult(
 *   { applyEvent: (s,l,e) => applyClaimEvent(env.DB, s, l, e),
 *     getLead: (l) => getLead(env.DB, l),
 *     sendEmail: (k,to,ctx) => sendClaimBuildEmail(k, to, ctx, { send: (m) => sendEmail(env, m) }) },
 *   { sessionId, leadId, ok: true, previewUrl },
 * );
 * ```
 */
import type { BuildSessionEvent } from './claim_build_session.js';
import type { ClaimEmailKind, ClaimEmailContext } from './claim_build_emails.js';

/** Injected side-effects (db/email already bound by the caller). */
export interface CompletionDeps {
  applyEvent: (sessionId: string, leadId: string, event: BuildSessionEvent) => Promise<unknown>;
  getLead: (
    leadId: string,
  ) => Promise<{ profile: { businessName?: string; email?: string } } | null>;
  sendEmail: (kind: ClaimEmailKind, to: string, ctx: ClaimEmailContext) => Promise<{ ok: boolean }>;
}

/** The build result reported by the generation workflow. */
export interface ClaimBuildResult {
  sessionId: string;
  leadId: string;
  ok: boolean;
  previewUrl?: string;
  error?: string;
  createUrl?: string;
}

/**
 * Apply a finished/failed claim build's terminal event + notify the owner.
 *
 * @param deps - Injected applyEvent / getLead / sendEmail.
 * @param r - The build result.
 * @returns `{ status, emailed }`; never throws.
 */
export async function handleClaimBuildResult(
  deps: CompletionDeps,
  r: ClaimBuildResult,
): Promise<{ status: 'completed' | 'failed'; emailed: boolean }> {
  const event: BuildSessionEvent = r.ok
    ? { type: 'BUILD_COMPLETED', previewUrl: r.previewUrl ?? '' }
    : { type: 'BUILD_FAILED', error: r.error ?? 'build_failed' };
  await deps.applyEvent(r.sessionId, r.leadId, event);

  const status = r.ok ? 'completed' : 'failed';

  // Best-effort notify — needs an email on file; a send failure never flips the
  // build's reported status (the build outcome is the source of truth).
  let emailed = false;
  let lead: Awaited<ReturnType<CompletionDeps['getLead']>> = null;
  try {
    lead = await deps.getLead(r.leadId);
  } catch {
    lead = null;
  }
  const to = lead?.profile.email;
  if (to) {
    const kind: ClaimEmailKind = r.ok ? 'finished' : 'failed';
    const ctx: ClaimEmailContext = {
      businessName: lead?.profile.businessName,
      ...(r.previewUrl ? { previewUrl: r.previewUrl } : {}),
      ...(r.error ? { error: r.error } : {}),
      ...(r.createUrl ? { createUrl: r.createUrl } : {}),
    };
    try {
      const res = await deps.sendEmail(kind, to, ctx);
      emailed = res.ok;
    } catch {
      emailed = false;
    }
  }

  return { status, emailed };
}
