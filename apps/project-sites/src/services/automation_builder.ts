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

import { z } from 'zod';
import type { Env } from '../types/env.js';
import { dbQuery, dbExecute } from './db.js';

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
        continue;
      }
      // Deeper config contract per action type (e.g. send_email needs `to`).
      const cfg = validateActionConfig(a);
      if (!cfg.ok) errors.push(...cfg.errors);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Per-action-type config contract (Zod). A recipe action's `config` carries the
 * data its effect needs — the recipient for `send_email`, the URL for `webhook`,
 * etc. `validateRecipe` (above) only checks the action TYPE; this is the deeper
 * config contract that `buildRunAction` (the executor) + the recipe-builder UI
 * config inputs consume.
 *
 * @remarks NOT yet wired into `validateRecipe` — the current recipe-builder UI
 * does not collect config, so enforcing it would reject config-less recipes. It
 * is wired in alongside the UI config-input slice. Used standalone today to
 * validate config when present.
 */
export const ACTION_CONFIG_SCHEMAS = {
  send_email: z
    .object({ to: z.string().email(), subject: z.string().min(1).max(200).optional(), body: z.string().max(5000).optional() })
    .strict(),
  webhook: z.object({ url: z.string().url().max(2048) }).strict(),
  add_tag: z.object({ tag: z.string().min(1).max(64) }).strict(),
  notify: z.object({ message: z.string().min(1).max(500).optional() }).strict(),
  create_task: z.object({ title: z.string().min(1).max(200), assignee: z.string().min(1).max(120).optional() }).strict(),
} as const;

/**
 * Validate ONE action's config against its type's schema. Returns all issues,
 * prefixed `actionType.field`. An unknown action type fails (the allowlist guard
 * also lives in {@link validateRecipe}).
 *
 * @example
 * validateActionConfig({ type: 'send_email', config: { to: 'x@y.com' } }) // → { ok: true, errors: [] }
 * validateActionConfig({ type: 'webhook', config: {} })                   // → { ok: false, errors: ['webhook.url: …'] }
 */
export function validateActionConfig(action: RecipeAction): RecipeValidation {
  const schema = ACTION_CONFIG_SCHEMAS[action.type as keyof typeof ACTION_CONFIG_SCHEMAS];
  if (!schema) {
    return { ok: false, errors: [`Unknown action "${action.type}". Allowed: ${ACTION_TYPES.join(', ')}.`] };
  }
  const parsed = schema.safeParse(action.config ?? {});
  if (parsed.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${action.type}.${i.path.join('.') || 'config'}: ${i.message}`),
  };
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

export interface StoredRecipe extends AutomationRecipe {
  id: string;
}
export interface CreateRecipeResult {
  ok: boolean;
  id?: string;
  errors?: string[];
}

/** Validate then persist a recipe (org+site scoped). Rejects with all validation errors. */
export async function createRecipe(
  env: Env,
  orgId: string,
  siteId: string,
  recipe: AutomationRecipe,
): Promise<CreateRecipeResult> {
  const v = validateRecipe(recipe);
  if (!v.ok) return { ok: false, errors: v.errors };

  const id = crypto.randomUUID();
  const res = await dbExecute(
    env.DB,
    `INSERT INTO automation_recipes (id, site_id, org_id, name, enabled, trigger_type, trigger_filter, actions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      siteId,
      orgId,
      recipe.name.trim(),
      recipe.enabled ? 1 : 0,
      recipe.trigger.type,
      recipe.trigger.filter ? JSON.stringify(recipe.trigger.filter) : null,
      JSON.stringify(recipe.actions),
    ],
  );
  if (res.error) return { ok: false, errors: [res.error] };
  return { ok: true, id };
}

/** List a site's recipes (org+site scoped), JSON columns parsed back to objects. */
export async function listRecipes(env: Env, orgId: string, siteId: string): Promise<StoredRecipe[]> {
  const { data } = await dbQuery<{
    id: string;
    name: string;
    enabled: number;
    trigger_type: string;
    trigger_filter: string | null;
    actions: string;
  }>(
    env.DB,
    `SELECT id, name, enabled, trigger_type, trigger_filter, actions
     FROM automation_recipes WHERE org_id = ? AND site_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [orgId, siteId],
  );
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled === 1,
    trigger: { type: r.trigger_type, filter: r.trigger_filter ? JSON.parse(r.trigger_filter) : undefined },
    actions: JSON.parse(r.actions) as AutomationRecipe['actions'],
  }));
}

/** Soft-delete a recipe (org+site scoped). `ok:false` when nothing matched. */
export async function deleteRecipe(
  env: Env,
  orgId: string,
  siteId: string,
  id: string,
): Promise<{ ok: boolean }> {
  const res = await dbExecute(
    env.DB,
    "UPDATE automation_recipes SET deleted_at = datetime('now') WHERE id = ? AND org_id = ? AND site_id = ? AND deleted_at IS NULL",
    [id, orgId, siteId],
  );
  return { ok: !res.error && res.changes > 0 };
}
