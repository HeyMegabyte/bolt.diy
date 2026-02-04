/**
 * Site and hostname schemas
 */
import { z } from 'zod';
import {
  uuidSchema,
  slugSchema,
  hostnameSchema,
  httpsUrlSchema,
  businessNameSchema,
  emailSchema,
  phoneSchema,
  confidenceSchema,
  timestampsSchema,
  safeTextSchema,
} from './base.js';
import { HOSTNAME_STATES } from '../constants/index.js';

// ============================================================================
// SITE
// ============================================================================

export const siteSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  slug: slugSchema,
  business_name: businessNameSchema,
  business_email: emailSchema.nullable().optional(),
  business_phone: phoneSchema.nullable().optional(),
  business_address: safeTextSchema.nullable().optional(),
  website_url: httpsUrlSchema.nullable().optional(),
  bolt_chat_id: z.string().nullable().optional(),
  r2_path: z.string().nullable().optional(),
  last_published_at: z.string().datetime().nullable().optional(),
  lighthouse_score: z.number().int().min(0).max(100).nullable().optional(),
  ...timestampsSchema.shape,
});

export const createSiteInputSchema = z.object({
  business_name: businessNameSchema,
  slug: slugSchema.optional(),
  business_email: emailSchema.optional(),
  business_phone: phoneSchema.optional(),
  business_address: safeTextSchema.optional(),
  website_url: httpsUrlSchema.optional(),
});

export const updateSiteInputSchema = z.object({
  business_name: businessNameSchema.optional(),
  business_email: emailSchema.optional(),
  business_phone: phoneSchema.optional(),
  business_address: safeTextSchema.optional(),
  website_url: httpsUrlSchema.optional(),
});

// ============================================================================
// HOSTNAME
// ============================================================================

export const hostnameStateSchema = z.enum([
  HOSTNAME_STATES.PENDING,
  HOSTNAME_STATES.ACTIVE,
  HOSTNAME_STATES.FAILED,
  HOSTNAME_STATES.DELETED,
]);

export const siteHostnameSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  site_id: uuidSchema,
  hostname: hostnameSchema,
  cf_hostname_id: z.string().nullable().optional(),
  state: hostnameStateSchema,
  ssl_status: z.string().nullable().optional(),
  verification_errors: z.array(z.string()).nullable().optional(),
  is_free_domain: z.boolean().default(false),
  last_verified_at: z.string().datetime().nullable().optional(),
  ...timestampsSchema.shape,
});

export const createHostnameInputSchema = z.object({
  site_id: uuidSchema,
  hostname: hostnameSchema,
});

// ============================================================================
// CONFIDENCE ATTRIBUTES
// ============================================================================

export const confidenceAttributeSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  site_id: uuidSchema,
  attribute_name: z.string().min(1).max(100),
  confidence: confidenceSchema,
  source: z.string().max(255),
  rationale: safeTextSchema.nullable().optional(),
  raw_value: z.string().nullable().optional(),
  normalized_value: z.string().nullable().optional(),
  ...timestampsSchema.shape,
});

// ============================================================================
// LIGHTHOUSE RUNS
// ============================================================================

export const lighthouseRunSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  site_id: uuidSchema,
  performance_score: z.number().min(0).max(100),
  accessibility_score: z.number().min(0).max(100),
  best_practices_score: z.number().min(0).max(100),
  seo_score: z.number().min(0).max(100),
  is_mobile: z.boolean(),
  results_r2_path: z.string().nullable().optional(),
  ...timestampsSchema.shape,
});

// ============================================================================
// SITE SETTINGS
// ============================================================================

export const siteSettingsSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  site_id: uuidSchema,
  meta_title: safeTextSchema.nullable().optional(),
  meta_description: safeTextSchema.nullable().optional(),
  og_title: safeTextSchema.nullable().optional(),
  og_description: safeTextSchema.nullable().optional(),
  og_image_url: httpsUrlSchema.nullable().optional(),
  favicon_url: httpsUrlSchema.nullable().optional(),
  logo_url: httpsUrlSchema.nullable().optional(),
  primary_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
  secondary_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
  custom_css: safeTextSchema.nullable().optional(),
  ...timestampsSchema.shape,
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Site = z.infer<typeof siteSchema>;
export type CreateSiteInput = z.infer<typeof createSiteInputSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteInputSchema>;
export type HostnameState = z.infer<typeof hostnameStateSchema>;
export type SiteHostname = z.infer<typeof siteHostnameSchema>;
export type CreateHostnameInput = z.infer<typeof createHostnameInputSchema>;
export type ConfidenceAttribute = z.infer<typeof confidenceAttributeSchema>;
export type LighthouseRun = z.infer<typeof lighthouseRunSchema>;
export type SiteSettings = z.infer<typeof siteSettingsSchema>;
