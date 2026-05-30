/**
 * @module libs/features/token_burn_meter/schemas
 * @description Zod schemas for the Token-Burn Meter feature module.
 *
 * Re-exports the canonical budget schemas from `src/services/build_budget.ts`
 * (single source of truth per [[zod-everywhere]]) and adds the API-response
 * envelope shapes the handlers return.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  BudgetMeterSchema,
  SpendRecordSchema,
} from '../../../src/services/build_budget.js';

export { BudgetMeterSchema, SpendRecordSchema };
export type { BudgetMeter, SpendRecord } from '../../../src/services/build_budget.js';

/** Response for `GET /api/usage/budget` — the caller-org meter snapshot. */
export const OrgBudgetResponseSchema = z
  .object({
    orgId: z.string().min(1),
    plan: z.enum(['free', 'paid', 'unlimited']),
    meter: BudgetMeterSchema,
  })
  .strict();

export type OrgBudgetResponse = z.infer<typeof OrgBudgetResponseSchema>;

/** One per-org row in the admin all-orgs meter response. */
export const AdminBudgetRowSchema = z
  .object({
    orgId: z.string().min(1),
    plan: z.enum(['free', 'paid', 'unlimited']),
    meter: BudgetMeterSchema,
  })
  .strict();

export type AdminBudgetRow = z.infer<typeof AdminBudgetRowSchema>;

/** Response for `GET /api/admin/usage/budget` — every org's meter. */
export const AdminBudgetResponseSchema = z
  .object({
    count: z.number().int().nonnegative(),
    orgs: z.array(AdminBudgetRowSchema),
  })
  .strict();

export type AdminBudgetResponse = z.infer<typeof AdminBudgetResponseSchema>;
