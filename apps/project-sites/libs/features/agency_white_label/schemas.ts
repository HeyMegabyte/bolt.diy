/**
 * @module libs/features/agency_white_label/schemas
 * @description Zod schemas for the White-Label Agency Tier (idea #34).
 *
 * Different from the older `agency_tier` flag (sub-orgs + Connect billing):
 * this module owns the **brand chrome swap**. Agencies bring their own
 * domain; the Worker swaps logos, colors, and admin shell per hostname.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

export const AgencyTierSchema = z.enum(['starter', 'studio', 'enterprise']);
export type AgencyTier = z.infer<typeof AgencyTierSchema>;

export const AgencyStatusSchema = z.enum([
  'pending',
  'active',
  'suspended',
  'cancelled',
]);
export type AgencyStatus = z.infer<typeof AgencyStatusSchema>;

/** Hex `#RRGGBB` color used for brand chrome. */
const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be 6-digit hex (e.g. #00E5FF)');

/** RFC-1123 hostname — admin custom domain. */
const HostnameSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/,
    'Invalid hostname',
  );

export const AgencyConfigSchema = z.object({
  brand_name: z.string().min(2).max(64),
  logo_url: z.string().url().max(512).optional().nullable(),
  primary_color: HexColorSchema.optional().nullable(),
  custom_domain: HostnameSchema.optional().nullable(),
  support_email: z.string().email().max(254).optional().nullable(),
});
export type AgencyConfig = z.infer<typeof AgencyConfigSchema>;

/** `POST /api/agency-white-label` create body. */
export const CreateAgencyRequestSchema = AgencyConfigSchema.extend({
  tier: AgencyTierSchema.default('starter'),
});
export type CreateAgencyRequest = z.infer<typeof CreateAgencyRequestSchema>;

/** `PATCH /api/agency-white-label/:id` update body. */
export const UpdateAgencyRequestSchema = AgencyConfigSchema.partial();
export type UpdateAgencyRequest = z.infer<typeof UpdateAgencyRequestSchema>;

export const AgencyTenantSchema = z.object({
  id: z.string(),
  owner_user_id: z.string(),
  owner_org_id: z.string(),
  brand_name: z.string(),
  logo_url: z.string().nullable(),
  primary_color: z.string().nullable(),
  custom_domain: z.string().nullable(),
  stripe_account_id: z.string().nullable(),
  support_email: z.string().nullable(),
  tier: AgencyTierSchema,
  status: AgencyStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  activated_at: z.string().nullable(),
});
export type AgencyTenant = z.infer<typeof AgencyTenantSchema>;

/** Shape returned by the hostname-router lookup. */
export const BrandChromeSchema = z.object({
  brand_name: z.string(),
  logo_url: z.string().nullable(),
  primary_color: z.string().nullable(),
  support_email: z.string().nullable(),
  tier: AgencyTierSchema,
});
export type BrandChrome = z.infer<typeof BrandChromeSchema>;
