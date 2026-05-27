/**
 * Tenant + membership SSOT. Mirrors D1 `orgs` + `memberships`.
 */
import { z } from 'zod';
import { RoleSchema } from './role.js';

export const PlanTierSchema = z.enum([
  'free',
  'starter',
  'pro',
  'business',
  'enterprise',
] as const);
export type PlanTier = z.infer<typeof PlanTierSchema>;

export const TenantSchema = z
  .object({
    id: z.string().min(1),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'invalid tenant slug'),
    name: z.string().min(1),
    owner_id: z.string().min(1),
    plan_tier: PlanTierSchema,
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type Tenant = z.infer<typeof TenantSchema>;

export const MembershipSchema = z
  .object({
    tenant_id: z.string().min(1),
    user_id: z.string().min(1),
    role: RoleSchema,
    invited_at: z.iso.datetime({ offset: true }).nullable(),
    accepted_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export type Membership = z.infer<typeof MembershipSchema>;
