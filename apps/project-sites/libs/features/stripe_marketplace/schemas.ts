/**
 * @module libs/features/stripe_marketplace/schemas
 * @description Zod schemas for the Stripe App Marketplace listing (idea #36).
 *
 * Models the install + OAuth callback. Refresh tokens are persisted
 * encrypted via `MCP_ENCRYPTION_KEY` per the existing AES-GCM pattern.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

export const InstallStatusSchema = z.enum(['active', 'uninstalled', 'revoked']);
export type InstallStatus = z.infer<typeof InstallStatusSchema>;

/**
 * `GET /api/stripe-marketplace/oauth/callback?code=...&state=...`
 * Stripe sends these query params after a merchant approves the install.
 */
export const OAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(256),
  state: z.string().min(8).max(256),
  scope: z.string().max(256).optional(),
  livemode: z.enum(['true', 'false']).optional(),
});
export type OAuthCallbackQuery = z.infer<typeof OAuthCallbackQuerySchema>;

/**
 * `POST /api/stripe-marketplace/uninstall` body — fires from Stripe webhook
 * `account.application.deauthorized`.
 */
export const UninstallRequestSchema = z.object({
  stripe_account_id: z.string().min(8).max(64),
});
export type UninstallRequest = z.infer<typeof UninstallRequestSchema>;

export const StripeMarketplaceInstallSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  stripe_account_id: z.string(),
  installer_user_id: z.string().nullable(),
  scopes: z.array(z.string()).default([]),
  livemode: z.boolean(),
  status: InstallStatusSchema,
  installed_at: z.string(),
  uninstalled_at: z.string().nullable(),
});
export type StripeMarketplaceInstall = z.infer<typeof StripeMarketplaceInstallSchema>;

/**
 * Shape of the Stripe `stripe-app.json` manifest that we ship at the
 * repo root. The schema is intentionally narrow — Stripe's full schema
 * is documented at https://stripe.com/docs/stripe-apps/reference/manifest.
 */
export const StripeAppManifestSchema = z.object({
  id: z.string().regex(/^com\.[a-z0-9.]+\.[a-z0-9]+$/),
  version: z.string(),
  name: z.string(),
  icon: z.string(),
  permissions: z.array(
    z.object({
      permission: z.string(),
      purpose: z.string(),
    }),
  ),
  app_url: z.string().url(),
  post_install_url: z.string().url().optional(),
  distribution_type: z.enum(['public', 'private']),
});
export type StripeAppManifest = z.infer<typeof StripeAppManifestSchema>;
