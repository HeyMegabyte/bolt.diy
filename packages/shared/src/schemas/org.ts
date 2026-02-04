/**
 * Organization and membership schemas
 */
import { z } from 'zod';
import {
  uuidSchema,
  emailSchema,
  shortTextSchema,
  timestampsSchema,
} from './base.js';
import { ROLES } from '../constants/index.js';

// ============================================================================
// ORGANIZATION
// ============================================================================

export const orgSchema = z.object({
  id: uuidSchema,
  name: shortTextSchema,
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9-]+$/),
  stripe_customer_id: z.string().nullable().optional(),
  ...timestampsSchema.shape,
});

export const createOrgInputSchema = z.object({
  name: shortTextSchema,
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

export const updateOrgInputSchema = z.object({
  name: shortTextSchema.optional(),
});

// ============================================================================
// USER
// ============================================================================

export const userSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  phone: z.string().nullable().optional(),
  email_verified: z.boolean().default(false),
  phone_verified: z.boolean().default(false),
  avatar_url: z.string().url().nullable().optional(),
  display_name: shortTextSchema.nullable().optional(),
  ...timestampsSchema.shape,
});

export const createUserInputSchema = z.object({
  email: emailSchema,
  phone: z.string().optional(),
  display_name: shortTextSchema.optional(),
});

// ============================================================================
// MEMBERSHIP
// ============================================================================

export const roleSchema = z.enum([
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.MEMBER,
  ROLES.VIEWER,
]);

export const membershipSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  user_id: uuidSchema,
  role: roleSchema,
  billing_admin: z.boolean().default(false),
  ...timestampsSchema.shape,
});

export const createMembershipInputSchema = z.object({
  org_id: uuidSchema,
  user_id: uuidSchema,
  role: roleSchema,
  billing_admin: z.boolean().optional(),
});

export const updateMembershipInputSchema = z.object({
  role: roleSchema.optional(),
  billing_admin: z.boolean().optional(),
});

// ============================================================================
// INVITE
// ============================================================================

export const inviteSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  email: emailSchema,
  role: roleSchema,
  token: z.string(),
  expires_at: z.string().datetime(),
  accepted_at: z.string().datetime().nullable().optional(),
  ...timestampsSchema.shape,
});

export const createInviteInputSchema = z.object({
  email: emailSchema,
  role: roleSchema.default(ROLES.MEMBER),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Org = z.infer<typeof orgSchema>;
export type CreateOrgInput = z.infer<typeof createOrgInputSchema>;
export type UpdateOrgInput = z.infer<typeof updateOrgInputSchema>;
export type User = z.infer<typeof userSchema>;
export type CreateUserInput = z.infer<typeof createUserInputSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type CreateMembershipInput = z.infer<typeof createMembershipInputSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipInputSchema>;
export type Invite = z.infer<typeof inviteSchema>;
export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;
