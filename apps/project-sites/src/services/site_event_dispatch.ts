/**
 * Shared site-event dispatch keystone (#10 — Outbound Webhooks).
 *
 * One platform event (`form.submitted`, `site.published`, …) fans out to the
 * outbound-webhooks arm. The automation-recipes arm (#11 Automation Builder) was
 * removed on 2026-06-08; this stays a thin, per-arm-isolated dispatcher so a new
 * arm can be re-added without reworking callers.
 *
 *   event → [ dispatchWebhooks(event) ] → { webhooks }
 *
 * @remarks Per-arm isolation is the hard property: an arm failure (e.g. a D1
 * hiccup loading webhook endpoints) becomes `{ error }` rather than throwing.
 * `Promise.allSettled` preserves that contract (and the shape that lets a second
 * arm slot back in later). The arm is injected so the orchestration is
 * unit-testable with no real I/O.
 */
import type { DispatchOutcome } from './webhook_dispatch.js';

/** The injected webhook arm (wraps its load + dispatch). */
export interface SiteEventDeps {
  dispatchWebhooks: (event: { type: string; payload: unknown }) => Promise<DispatchOutcome>;
}

/** One arm's result is its outcome, or `{ error }` if that arm threw (isolated). */
export type ArmResult<T> = T | { error: string };

export interface SiteEventResult {
  webhooks: ArmResult<DispatchOutcome>;
}

function armError(reason: unknown): { error: string } {
  return { error: reason instanceof Error ? reason.message : 'arm_failed' };
}

/**
 * Fan one event out to the webhook arm, isolating per-arm failure.
 *
 * @param deps - the injected webhook arm thunk.
 * @param event - the platform event `{ type, payload }`.
 * @returns the arm's outcome, or `{ error }` if it threw.
 *
 * @example
 * await handleSiteEvent({
 *   dispatchWebhooks: (e) => dispatchEvent(whDeps, e, await loadDispatchEndpoints(env, siteId), siteId, ts),
 * }, event);
 */
export async function handleSiteEvent(
  deps: SiteEventDeps,
  event: { type: string; payload: unknown },
): Promise<SiteEventResult> {
  const [w] = await Promise.allSettled([deps.dispatchWebhooks(event)]);
  return {
    webhooks: w.status === 'fulfilled' ? w.value : armError(w.reason),
  };
}
