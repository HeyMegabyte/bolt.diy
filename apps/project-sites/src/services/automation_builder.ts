/**
 * @module services/automation_builder
 * @description Core for the Automation Builder (build-first module #11, P1) —
 * no-code trigger→action recipes (Zapier-lite) wiring forms / payments / CRM /
 * email.
 *
 * This slice is the pure heart: the trigger/action allowlists, recipe shape
 * validation, and the event→recipe matcher (does an incoming platform event
 * fire a given recipe?). The persistence (recipes table), the route CRUD, and
 * the action dispatch (which reuses the outbound-webhook signer #10, the email
 * sender, etc.) are slice 2. Keeping match + validation pure makes them
 * unit-testable without a queue or DB.
 *
 * @packageDocumentation
 */

/** Platform events a recipe can trigger on (allowlist — a typo can't mint a phantom trigger). */
export const TRIGGER_TYPES = [
  'form.submitted',
  'site.published',
  'payment.succeeded',
  'review.received',
  'build.failed',
  'domain.active',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** Actions a recipe can perform (allowlist). */
export const ACTION_TYPES = ['send_email', 'webhook', 'add_tag', 'notify', 'create_task'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Max actions per recipe (a runaway recipe backstop). */
export const MAX_RECIPE_ACTIONS = 10;

export interface RecipeTrigger {
  type: string;
  /** Optional equals-filter against the event payload (all keys must match). */
  filter?: Record<string, string | number | boolean>;
}
export interface RecipeAction {
  type: string;
  config?: Record<string, unknown>;
}
export interface AutomationRecipe {
  name: string;
  enabled: boolean;
  trigger: RecipeTrigger;
  actions: RecipeAction[];
}
export interface AutomationEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface RecipeValidation {
  ok: boolean;
  errors: string[];
}

/** Validate a recipe's shape against the allowlists — pure, returns all errors. */
export function validateRecipe(recipe: AutomationRecipe): RecipeValidation {
  const errors: string[] = [];

  if (!recipe.name || recipe.name.trim().length === 0) errors.push('Recipe name is required.');
  if (!(TRIGGER_TYPES as readonly string[]).includes(recipe.trigger?.type)) {
    errors.push(`Unknown trigger "${recipe.trigger?.type}". Allowed: ${TRIGGER_TYPES.join(', ')}.`);
  }
  if (!Array.isArray(recipe.actions) || recipe.actions.length === 0) {
    errors.push('A recipe needs at least one action.');
  } else {
    if (recipe.actions.length > MAX_RECIPE_ACTIONS) {
      errors.push(`Too many actions (${recipe.actions.length}); max ${MAX_RECIPE_ACTIONS}.`);
    }
    for (const a of recipe.actions) {
      if (!(ACTION_TYPES as readonly string[]).includes(a?.type)) {
        errors.push(`Unknown action "${a?.type}". Allowed: ${ACTION_TYPES.join(', ')}.`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Whether an incoming event fires this recipe: the recipe is enabled, the event
 * type equals the trigger type, and every filter key strictly equals the
 * corresponding event-payload value (a missing key never matches).
 */
export function recipeMatchesEvent(recipe: AutomationRecipe, event: AutomationEvent): boolean {
  if (!recipe.enabled) return false;
  if (event.type !== recipe.trigger.type) return false;
  const filter = recipe.trigger.filter;
  if (!filter) return true;
  return Object.entries(filter).every(([k, v]) => event.payload[k] === v);
}
