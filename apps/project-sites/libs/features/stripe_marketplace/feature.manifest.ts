/**
 * @module libs/features/stripe_marketplace
 *
 * Feature manifest for the Stripe App Marketplace listing (idea #36).
 * Ships a public `stripe-app.json` manifest + an OAuth install callback
 * that exchanges Stripe codes for refresh tokens (stored AES-GCM encrypted).
 *
 * Requires Brian: submit the listing via the Stripe Dashboard
 * (Distribution → Public). The manifest endpoint must be reachable
 * before submission.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'stripe_marketplace',
  name: 'Stripe App Marketplace Listing',
  description:
    'Stripe App Marketplace listing: public manifest + OAuth install callback so merchants can install projectsites from the Stripe Dashboard.',
  lifecycle: 'alpha',
  flagKey: 'stripe_marketplace',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  routes: ['/admin/integrations/stripe-marketplace'],
  apiRoutes: [
    'GET  /api/stripe-marketplace/manifest',
    'GET  /api/stripe-marketplace/oauth/callback',
    'POST /api/stripe-marketplace/uninstall',
    'GET  /api/stripe-marketplace/installs',
  ],

  permissions: ['billing:read', 'billing:write'],
  dependencies: ['billing'],

  // DRIFT: e2e/stripe_marketplace/ specs not yet authored; unit tests live
  // colocated at libs/features/stripe_marketplace/__tests__/ (Jest finds them
  // via discovery; validator only accepts src/__tests__/ prefix). Move on
  // next sweep per [[e2e-tdd-organization]].
  e2eTests: [],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  zodSchemas: ['libs/features/stripe_marketplace/schemas.ts'],

  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Requires Brian: Stripe app submission via the Stripe Dashboard (Distribution → Public). Manifest endpoint must be reachable before submission.',
  },

  risks: [
    'Stripe refresh tokens are persisted encrypted with MCP_ENCRYPTION_KEY (Tier 1.5) — rotating that key invalidates every install.',
    'OAuth callback does not yet verify a CSRF state token; only acceptable while flag is off-by-default.',
    'No access-token refresh helper yet — every consumer needs to re-mint via /v1/oauth/token before calling Stripe APIs on behalf of an install.',
  ],

  removalNotes:
    'Drop table stripe_marketplace_installs. Remove route mount. Delete stripe-app.json from repo root. Drop FLAG_REGISTRY.stripe_marketplace.',
});
