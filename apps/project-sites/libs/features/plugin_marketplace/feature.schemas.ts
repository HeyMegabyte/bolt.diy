/**
 * @module libs/features/plugin_marketplace/schemas
 * @description Zod schemas for the Plugin / Integration Marketplace (IDEAS-50 #41).
 *
 * Webflow-style 500-plugin catalog with 70/30 creator rev-share. Plugins
 * declare install hooks via a manifest JSON the site-build pipeline reads.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Economics — 70/30 split.
// ─────────────────────────────────────────────────────────────────────────────

export const PLUGIN_CREATOR_BPS = 7000;
export const PLUGIN_PLATFORM_BPS = 3000;
export const PLUGIN_BPS_FULL = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// Enums.
// ─────────────────────────────────────────────────────────────────────────────

export const PluginCategorySchema = z.enum([
  'payments',
  'scheduling',
  'maps',
  'forms',
  'analytics',
  'ai',
  'social',
  'other',
]);
export type PluginCategory = z.infer<typeof PluginCategorySchema>;

export const PluginStatusSchema = z.enum(['pending', 'approved', 'live', 'rejected', 'archived']);
export type PluginStatus = z.infer<typeof PluginStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Manifest — declares how the site-build pipeline installs the plugin.
// ─────────────────────────────────────────────────────────────────────────────

export const PluginHookSchema = z.object({
  /** Pipeline phase the hook fires in. */
  phase: z.enum(['pre-build', 'post-build', 'post-deploy']),
  /** Script path inside the plugin bundle (relative). */
  script: z.string().min(1),
  /** Optional cron schedule when the hook is scheduled. */
  cron: z.string().optional(),
});
export type PluginHook = z.infer<typeof PluginHookSchema>;

export const PluginEnvVarSchema = z.object({
  /** Env var name. UPPER_SNAKE_CASE. */
  name: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, 'env var name must be UPPER_SNAKE_CASE'),
  /** Whether the value is required or optional. */
  required: z.boolean().default(true),
  /** Human-readable description shown to the buyer at install time. */
  description: z.string().min(1).max(300),
});
export type PluginEnvVar = z.infer<typeof PluginEnvVarSchema>;

export const PluginScriptInjectionSchema = z.object({
  /** Where to inject the script tag. */
  position: z.enum(['head', 'body-start', 'body-end']),
  /** URL of the script (typically a CDN). */
  src: z.string().url(),
  /** Whether to defer / async. */
  defer: z.boolean().default(false),
  async: z.boolean().default(false),
});
export type PluginScriptInjection = z.infer<typeof PluginScriptInjectionSchema>;

export const PluginManifestSchema = z.object({
  /** Manifest schema version. */
  version: z.literal('1.0'),
  /** Build hooks fired during the site-build pipeline. */
  hooks: z.array(PluginHookSchema).default([]),
  /** Env vars the plugin needs at runtime. */
  env_vars: z.array(PluginEnvVarSchema).default([]),
  /** Script tags injected into the generated site HTML. */
  scripts: z.array(PluginScriptInjectionSchema).default([]),
  /** Required permissions (RBAC scopes the plugin reads). */
  permissions: z.array(z.string()).default([]),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Plugin submission — creator → marketplace.
// ─────────────────────────────────────────────────────────────────────────────

export const PluginSubmissionSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric + hyphens'),
  name: z.string().min(3).max(120),
  description: z.string().min(20).max(500),
  category: PluginCategorySchema,
  manifest: PluginManifestSchema,
  price_cents: z.number().int().min(0).max(50_000),
  thumbnail_url: z.string().url().optional(),
  repository_url: z.string().url().optional(),
});
export type PluginSubmission = z.infer<typeof PluginSubmissionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Install — per-site activation.
// ─────────────────────────────────────────────────────────────────────────────

export const PluginInstallInputSchema = z.object({
  plugin_id: z.string().min(1),
  site_id: z.string().min(1),
  /** Per-install configuration JSON. Validated against the plugin manifest at install time. */
  config: z.record(z.string(), z.unknown()).default({}),
  /** Stripe PaymentIntent for paid plugins. Required when price_cents > 0. */
  stripe_payment_intent: z.string().optional(),
});
export type PluginInstallInput = z.infer<typeof PluginInstallInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Pure split calculator.
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginRevenueSplit {
  creator_share_cents: number;
  platform_share_cents: number;
}

/**
 * Pure 70/30 split.
 *
 * @example
 * computePluginRevenueSplit(10_000)
 * //=> { creator_share_cents: 7_000, platform_share_cents: 3_000 }
 */
export function computePluginRevenueSplit(amountCents: number): PluginRevenueSplit {
  if (!Number.isFinite(amountCents) || amountCents < 0 || !Number.isInteger(amountCents)) {
    throw new RangeError(`amount_cents must be a non-negative integer (got ${amountCents})`);
  }
  const creator = Math.floor((amountCents * PLUGIN_CREATOR_BPS) / PLUGIN_BPS_FULL);
  const platform = amountCents - creator;
  return { creator_share_cents: creator, platform_share_cents: platform };
}

// ─────────────────────────────────────────────────────────────────────────────
// Row shapes.
// ─────────────────────────────────────────────────────────────────────────────

export const PluginRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  creator_user_id: z.string().nullable().optional(),
  category: PluginCategorySchema,
  manifest_json: z.string(),
  price_cents: z.number().int().nonnegative(),
  install_count: z.number().int().nonnegative(),
  sales_count: z.number().int().nonnegative(),
  total_revenue_cents: z.number().int().nonnegative(),
  rating_avg: z.number().nullable().optional(),
  rating_count: z.number().int().nonnegative(),
  status: PluginStatusSchema,
  thumbnail_url: z.string().nullable().optional(),
  repository_url: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
});

export type PluginRow = z.infer<typeof PluginRowSchema>;
