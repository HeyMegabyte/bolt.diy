/**
 * @module libs/features/billing
 *
 * Feature manifest for the Billing surface.
 * Stripe checkout sessions, subscription management, entitlements,
 * billing portal, and embedded checkout. Gated via existing billing flags.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'billing',
  name: 'Billing',
  description:
    'Stripe checkout + subscriptions + entitlements + billing portal. ' +
    'Gated behind stripe_meters flag for metered add-ons.',
  lifecycle: 'beta',
  flagKey: 'stripe_meters',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/billing', '/admin/upgrade'],
  apiRoutes: [
    'POST /api/billing/checkout',
    'POST /api/billing/embedded-checkout',
    'GET  /api/billing/subscription',
    'GET  /api/billing/entitlements',
    'POST /api/billing/portal',
  ],

  // ---- governance ----
  permissions: ['billing:read', 'billing:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'admin-and-billing.spec.ts',
    'billing/billing-flows.spec.ts',
    '_fortress/billing/happy-path.spec.ts',
    '_fortress/billing/adversarial.spec.ts',
  ],
  unitTests: [
    '__tests__/billing.test.ts',
  ],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [
    // CheckoutBodySchema, EmbeddedCheckoutBodySchema inline in routes/api.ts
    // DRIFT: should be extracted to libs/features/billing/schemas.ts
  ],

  // ---- observability ----
  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Base checkout + portal are stable. Metered billing (stripe_meters flag) still experimental. ' +
      'Beta after: metered billing unit tests + idempotency tests for checkout sessions.',
  },

  risks: [
    'Stripe webhook idempotency guard uses D1 webhook_events; batch insert + UNIQUE index race possible under retries.',
    'Embedded checkout uses Stripe.js client secret — never log or expose via API.',
    'Entitlements cached in KV (60s TTL); billing portal changes may not reflect immediately.',
  ],

  removalNotes:
    'Remove: billing.ts service, billing routes in routes/api.ts, ' +
    'frontend billing.component.ts + /admin/billing lazy route. ' +
    'Drop STRIPE_* secrets. Remove webhook_events rows for billing events.',
});
