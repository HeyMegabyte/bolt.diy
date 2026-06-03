/**
 * Automation action executor (#11) — maps a validated `RecipeAction` to its
 * concrete effect. This is the `runAction` that {@link ./automation_dispatch}'s
 * `runAutomations` calls per matching action, and the bridge from #11 to #10
 * (a `webhook` action reuses the outbound-webhook signed dispatch).
 *
 *   action → re-validate config (ACTION_CONFIG_SCHEMAS) → injected effect
 *
 * The 5 low-level effects are INJECTED ({@link ActionEffectDeps}) so the routing
 * + config-derivation is unit-testable with no real email/HTTP/D1. The Workflow
 * wrapper (slice 3, ships on push) supplies the real effects: `sendWebhook` →
 * the #10 signed `attemptDelivery`, `sendEmail` → Resend, `notify` → the
 * notifications service, `addTag`/`createTask` → their D1 writes.
 *
 * @remarks Config is re-validated here via `z.parse` (defense-in-depth — even
 * though `validateRecipe` enforces it at create, a recipe row could predate the
 * contract). A parse throw is ISOLATED by `runAutomations`' per-action try/catch
 * (tallied as a failed action), so one malformed recipe never aborts the rest.
 */
import { ACTION_CONFIG_SCHEMAS, type AutomationEvent, type RecipeAction } from './automation_builder.js';

/** The 5 low-level effects an action can trigger, injected for testability. */
export interface ActionEffectDeps {
  sendWebhook: (url: string, body: string) => Promise<void>;
  sendEmail: (to: string, subject: string, body: string) => Promise<void>;
  notify: (siteId: string, message: string) => Promise<void>;
  addTag: (siteId: string, tag: string) => Promise<void>;
  createTask: (siteId: string, title: string, assignee?: string) => Promise<void>;
}

/**
 * Build the `runAction` executor for a site: returns a function compatible with
 * `AutomationRunDeps['runAction']` that routes each action to its injected effect.
 *
 * @param deps - the injected low-level effects.
 * @param siteId - the owning site (passed to site-scoped effects).
 *
 * @example
 * const runAction = buildRunAction(effects, siteId);
 * await runAutomations({ runAction }, event, recipes);
 */
export function buildRunAction(
  deps: ActionEffectDeps,
  siteId: string,
): (action: RecipeAction, event: AutomationEvent) => Promise<void> {
  return async (action, event) => {
    switch (action.type) {
      case 'webhook': {
        const c = ACTION_CONFIG_SCHEMAS.webhook.parse(action.config ?? {});
        await deps.sendWebhook(c.url, JSON.stringify({ type: event.type, payload: event.payload }));
        return;
      }
      case 'send_email': {
        const c = ACTION_CONFIG_SCHEMAS.send_email.parse(action.config ?? {});
        await deps.sendEmail(c.to, c.subject ?? `Automation: ${event.type}`, c.body ?? `Triggered by ${event.type}.`);
        return;
      }
      case 'notify': {
        const c = ACTION_CONFIG_SCHEMAS.notify.parse(action.config ?? {});
        await deps.notify(siteId, c.message ?? `Event: ${event.type}`);
        return;
      }
      case 'add_tag': {
        const c = ACTION_CONFIG_SCHEMAS.add_tag.parse(action.config ?? {});
        await deps.addTag(siteId, c.tag);
        return;
      }
      case 'create_task': {
        const c = ACTION_CONFIG_SCHEMAS.create_task.parse(action.config ?? {});
        await deps.createTask(siteId, c.title, c.assignee);
        return;
      }
      default:
        throw new Error(`unknown action "${action.type}"`);
    }
  };
}
