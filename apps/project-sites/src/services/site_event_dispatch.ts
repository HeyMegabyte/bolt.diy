/**
 * Shared site-event dispatch keystone (#10 + #11).
 *
 * One platform event (`form.submitted`, `site.published`, …) fans out to BOTH
 * arms — outbound webhooks (#10) and automation recipes (#11) — concurrently and
 * INDEPENDENTLY. This is the connective tissue that makes the Workflow wrapper
 * (slice: ships on push) trivial glue: it supplies the two arm thunks (each
 * already a tested unit) and this orchestrates them.
 *
 *   event → [ dispatchWebhooks(event) ‖ runAutomations(event) ] → { webhooks, automations }
 *
 * @remarks Per-arm isolation is the hard property: a failure in one arm (e.g. a
 * D1 hiccup loading webhook endpoints) MUST NOT prevent the other arm (recipes)
 * from running. `Promise.allSettled` gives both concurrency AND isolation — a
 * rejected arm becomes `{ error }` while the other arm's result is preserved.
 * Both arms are injected so the orchestration is unit-testable with no real I/O.
 */
import type { DispatchOutcome } from './webhook_dispatch.js';
import type { AutomationRunOutcome } from './automation_dispatch.js';

/** The two independent arms, injected (each wraps its load + dispatch/automate). */
export interface SiteEventDeps {
  dispatchWebhooks: (event: { type: string; payload: unknown }) => Promise<DispatchOutcome>;
  runAutomations: (event: { type: string; payload: unknown }) => Promise<AutomationRunOutcome>;
}

/** One arm's result is its outcome, or `{ error }` if that arm threw (isolated). */
export type ArmResult<T> = T | { error: string };

export interface SiteEventResult {
  webhooks: ArmResult<DispatchOutcome>;
  automations: ArmResult<AutomationRunOutcome>;
}

function armError(reason: unknown): { error: string } {
  return { error: reason instanceof Error ? reason.message : 'arm_failed' };
}

/**
 * Fan one event out to both arms concurrently, isolating per-arm failure.
 *
 * @param deps - the injected webhook + automation arm thunks.
 * @param event - the platform event `{ type, payload }`.
 * @returns each arm's outcome, or `{ error }` for an arm that threw.
 *
 * @example
 * await handleSiteEvent({
 *   dispatchWebhooks: (e) => dispatchEvent(whDeps, e, await loadDispatchEndpoints(env, siteId), siteId, ts),
 *   runAutomations: (e) => runAutomations({ runAction: buildRunAction(effects, siteId) }, e, await listRecipes(env, orgId, siteId)),
 * }, event);
 */
export async function handleSiteEvent(
  deps: SiteEventDeps,
  event: { type: string; payload: unknown },
): Promise<SiteEventResult> {
  const [w, a] = await Promise.allSettled([deps.dispatchWebhooks(event), deps.runAutomations(event)]);
  return {
    webhooks: w.status === 'fulfilled' ? w.value : armError(w.reason),
    automations: a.status === 'fulfilled' ? a.value : armError(a.reason),
  };
}
