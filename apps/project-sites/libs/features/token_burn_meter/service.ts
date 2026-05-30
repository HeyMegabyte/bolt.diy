/**
 * @module libs/features/token_burn_meter/service
 * @description Thin service wrapper over `src/services/build_budget.ts` for the
 * Token-Burn Meter feature module (idea #13).
 *
 * Owns the feature's API-facing surface — plan resolution + meter assembly —
 * without duplicating the budget math, which stays canonical in
 * `build_budget.ts` per [[feature-module-architecture]].
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import {
  checkBudget,
  recordSpend,
  PLAN_BUDGET_USD,
  type BudgetMeter,
  type SpendRecord,
} from '../../../src/services/build_budget.js';

export { checkBudget, recordSpend, PLAN_BUDGET_USD };
export type { BudgetMeter, SpendRecord };

/** Flag key gating this feature. */
export const FLAG_KEY = 'token_burn_meter';

/** Normalized billing plan for budget purposes. */
export type BudgetPlan = 'free' | 'paid' | 'unlimited';

/**
 * Resolve the active billing plan for an org from the `subscriptions` table.
 * Only an `active` `paid` subscription counts as paid — everything else
 * (free, past_due, canceled, missing) resolves to `free`. There is no
 * `'unlimited'` subscription row; unlimited is granted by owner-email in
 * `build_budget.ts`.
 *
 * @param db    - D1Database binding.
 * @param orgId - Organization to resolve.
 * @returns `'paid'` for an active paid sub, otherwise `'free'`.
 */
export async function resolveOrgPlan(db: D1Database, orgId: string): Promise<BudgetPlan> {
  const sub = await dbQueryOne<{ plan: string; status: string }>(
    db,
    'SELECT plan, status FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  ).catch(() => null);
  return sub?.plan === 'paid' && sub.status === 'active' ? 'paid' : 'free';
}

/** Org meter snapshot bundled with the resolved plan for API responses. */
export interface OrgMeter {
  orgId: string;
  plan: BudgetPlan;
  meter: BudgetMeter;
}

/**
 * Assemble the current-org meter snapshot — resolves the plan, then computes
 * the budget meter via the canonical `checkBudget`.
 *
 * @param env   - Worker env (uses `env.DB`).
 * @param orgId - Organization to meter.
 * @returns Plan + {@link BudgetMeter} snapshot.
 */
export async function getOrgMeter(env: Env, orgId: string): Promise<OrgMeter> {
  const plan = await resolveOrgPlan(env.DB, orgId);
  const meter = await checkBudget(env.DB, orgId, plan);
  return { orgId, plan, meter };
}

/**
 * Assemble meter snapshots for every org (admin view). Resolves each org's
 * plan in one query, then computes meters concurrently.
 *
 * @param env   - Worker env (uses `env.DB`).
 * @param limit - Max orgs to return (defaults to 200, capped at 500).
 * @returns Array of per-org {@link OrgMeter} snapshots.
 */
export async function getAllOrgMeters(env: Env, limit = 200): Promise<OrgMeter[]> {
  const cap = Math.min(Math.max(1, limit), 500);
  const { data: subs } = await dbQuery<{ org_id: string; plan: string; status: string }>(
    env.DB,
    'SELECT org_id, plan, status FROM subscriptions WHERE deleted_at IS NULL',
    [],
  ).catch(() => ({ data: [] as { org_id: string; plan: string; status: string }[] }));

  const planByOrg = new Map<string, BudgetPlan>();
  for (const s of subs) {
    planByOrg.set(s.org_id, s.plan === 'paid' && s.status === 'active' ? 'paid' : 'free');
  }

  const { data: orgs } = await dbQuery<{ id: string }>(
    env.DB,
    'SELECT id FROM orgs WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?',
    [cap],
  ).catch(() => ({ data: [] as { id: string }[] }));

  return Promise.all(
    orgs.map(async ({ id }) => {
      const plan = planByOrg.get(id) ?? 'free';
      const meter = await checkBudget(env.DB, id, plan);
      return { orgId: id, plan, meter };
    }),
  );
}
