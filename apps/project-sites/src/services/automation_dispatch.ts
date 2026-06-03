/**
 * Automation-recipe execution orchestrator (#11 automation_builder).
 *
 * The firing engine that was the only remaining backend piece for #11: given an
 * incoming event + a site's recipes, run every action of every MATCHING recipe.
 *
 *   event → (per recipe) recipeMatchesEvent → (per action) runAction
 *
 * Mirrors the webhook dispatch core ({@link ./webhook_dispatch}): the per-action
 * effect is INJECTED so the orchestration — match gating, per-action error
 * isolation, unknown-action skipping — is unit-testable with no real I/O. The
 * thin Workflow wrapper (slice 2, ships on push) supplies the real `runAction`
 * that maps each action type to its effect: `webhook` → the #10 signed dispatch,
 * `send_email` → Resend, `notify` → the notifications service, `add_tag` /
 * `create_task` → their D1 writes.
 *
 * @remarks Per-action error isolation is a hard property: one failing action
 * (e.g. a down email provider) MUST NOT abort the remaining actions or recipes —
 * each is tallied (`failedActions`) and execution continues.
 */
import {
  ACTION_TYPES,
  type AutomationEvent,
  type AutomationRecipe,
  type RecipeAction,
  recipeMatchesEvent,
} from './automation_builder';

/** The single side effect the orchestrator needs, injected for testability. */
export interface AutomationRunDeps {
  /** Execute ONE action for an event. Throws on failure (caught + tallied per-action). */
  runAction: (action: RecipeAction, event: AutomationEvent) => Promise<void>;
}

export interface AutomationRunOutcome {
  /** Recipes whose trigger + filter matched this event. */
  matchedRecipes: number;
  /** Actions that ran without throwing. */
  firedActions: number;
  /** Actions whose `runAction` threw (isolated — did not abort the run). */
  failedActions: number;
  /** Actions skipped because their type is not on the allowlist (defense-in-depth). */
  skippedUnknownActions: number;
}

/**
 * Run all matching recipes' actions for one event.
 *
 * @param deps - injected `runAction` effect.
 * @param event - the platform event `{ type, payload }`.
 * @param recipes - the site's recipes (matching is computed here via `recipeMatchesEvent`).
 * @returns counts of matched recipes + fired / failed / skipped actions.
 *
 * @example
 * await runAutomations({ runAction }, { type: 'form.submitted', payload: { formId } }, recipes);
 */
export async function runAutomations(
  deps: AutomationRunDeps,
  event: AutomationEvent,
  recipes: AutomationRecipe[],
): Promise<AutomationRunOutcome> {
  let matchedRecipes = 0;
  let firedActions = 0;
  let failedActions = 0;
  let skippedUnknownActions = 0;

  for (const recipe of recipes) {
    if (!recipeMatchesEvent(recipe, event)) continue;
    matchedRecipes++;

    for (const action of recipe.actions) {
      if (!(ACTION_TYPES as readonly string[]).includes(action.type)) {
        skippedUnknownActions++;
        continue;
      }
      try {
        await deps.runAction(action, event);
        firedActions++;
      } catch {
        // Isolated: a failing action never aborts the remaining actions/recipes.
        failedActions++;
      }
    }
  }

  return { matchedRecipes, firedActions, failedActions, skippedUnknownActions };
}
