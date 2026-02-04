/**
 * Configuration and environment validation schemas
 */
import { z } from 'zod';
import { uuidSchema, httpsUrlSchema } from './base.js';

// ============================================================================
// ENVIRONMENT VARIABLES
// ============================================================================

/**
 * Required environment variables for production
 * Validated at boot time - fail fast if missing
 */
export const requiredEnvSchema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Stripe
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_'),

  // Cloudflare
  CF_API_TOKEN: z.string().min(1),
  CF_ZONE_ID: z.string().min(1),
  CF_ACCOUNT_ID: z.string().min(1),

  // SendGrid
  SENDGRID_API_KEY: z.string().startsWith('SG.'),

  // Google
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_PLACES_API_KEY: z.string().min(1),

  // Sentry
  SENTRY_DSN: z.string().url(),
});

/**
 * Optional environment variables
 */
export const optionalEnvSchema = z.object({
  // OpenAI (via AI Gateway)
  OPENAI_API_KEY: z.string().optional(),

  // Chatwoot
  CHATWOOT_API_URL: z.string().url().optional(),
  CHATWOOT_API_KEY: z.string().optional(),

  // Novu
  NOVU_API_KEY: z.string().optional(),

  // Lago (feature-flagged)
  LAGO_API_URL: z.string().url().optional(),
  LAGO_API_KEY: z.string().optional(),

  // Sale webhook callback
  SALE_WEBHOOK_URL: z.string().url().optional(),
  SALE_WEBHOOK_SECRET: z.string().optional(),

  // Environment
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const fullEnvSchema = requiredEnvSchema.merge(optionalEnvSchema);

// ============================================================================
// PRODUCTION SAFETY CHECKS
// ============================================================================

export const productionEnvSchema = requiredEnvSchema.extend({
  NODE_ENV: z.literal('production'),
  // Ensure we're not using test keys in production
  STRIPE_SECRET_KEY: z.string().startsWith('sk_live_'),
  STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_live_'),
});

// ============================================================================
// FEATURE FLAGS
// ============================================================================

export const featureFlagSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().default(false),
  org_id: uuidSchema.nullable().optional(),
  user_id: uuidSchema.nullable().optional(),
  percentage: z.number().min(0).max(100).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const createFeatureFlagInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  org_id: uuidSchema.optional(),
  user_id: uuidSchema.optional(),
  percentage: z.number().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// ADMIN SETTINGS
// ============================================================================

export const adminSettingSchema = z.object({
  id: uuidSchema,
  key: z.string().min(1).max(100),
  value: z.string(),
  value_type: z.enum(['string', 'number', 'boolean', 'json']),
  description: z.string().max(500).nullable().optional(),
  updated_by: uuidSchema.nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const updateAdminSettingInputSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
  value_type: z.enum(['string', 'number', 'boolean', 'json']).optional(),
  description: z.string().max(500).optional(),
});

// ============================================================================
// WRANGLER CONFIG (for reference)
// ============================================================================

export const wranglerConfigSchema = z.object({
  name: z.string(),
  main: z.string(),
  compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  compatibility_flags: z.array(z.string()).optional(),
  kv_namespaces: z.array(z.object({
    binding: z.string(),
    id: z.string(),
    preview_id: z.string().optional(),
  })).optional(),
  r2_buckets: z.array(z.object({
    binding: z.string(),
    bucket_name: z.string(),
    preview_bucket_name: z.string().optional(),
  })).optional(),
  queues: z.object({
    producers: z.array(z.object({
      binding: z.string(),
      queue: z.string(),
    })).optional(),
    consumers: z.array(z.object({
      queue: z.string(),
      max_batch_size: z.number().optional(),
      max_batch_timeout: z.number().optional(),
      max_retries: z.number().optional(),
      dead_letter_queue: z.string().optional(),
    })).optional(),
  }).optional(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type RequiredEnv = z.infer<typeof requiredEnvSchema>;
export type OptionalEnv = z.infer<typeof optionalEnvSchema>;
export type FullEnv = z.infer<typeof fullEnvSchema>;
export type ProductionEnv = z.infer<typeof productionEnvSchema>;
export type FeatureFlag = z.infer<typeof featureFlagSchema>;
export type CreateFeatureFlagInput = z.infer<typeof createFeatureFlagInputSchema>;
export type AdminSetting = z.infer<typeof adminSettingSchema>;
export type UpdateAdminSettingInput = z.infer<typeof updateAdminSettingInputSchema>;
export type WranglerConfig = z.infer<typeof wranglerConfigSchema>;
