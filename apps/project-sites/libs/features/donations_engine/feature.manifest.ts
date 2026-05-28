/**
 * @module libs/features/donations_engine
 *
 * Feature manifest for the Donations Engine.
 * Donorbox-class: one-time + recurring gifts, DAFpay (Donor-Advised Fund),
 * memorial gifts, embedded donate widget, Stripe Link Express Checkout.
 *
 * This file is the registry entry only — NO source files are moved here.
 * Everything points at where existing implementation lives.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'donations_engine',
  name: 'Donations Engine',
  description:
    'Donorbox-class fundraising: one-time + recurring gifts, DAFpay (Donor-Advised Fund routing), ' +
    'memorial gifts, sandboxed donate widget iframe, Stripe Link Express Checkout with 1.5% platform fee.',
  lifecycle: 'alpha',
  flagKey: 'donations_engine',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [
    // DRIFT: /admin/sites/:id/donations component not yet built
  ],
  apiRoutes: [
    'POST /api/donate',
    'GET  /_widget/donate.js',
    'GET  /_widget/donate/embed',
  ],

  // ---- governance ----
  permissions: ['billing:read', 'billing:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    // Tangential coverage only — no dedicated donations spec yet
    // DRIFT: e2e/donations_engine/ directory missing
    'forms-handling-widget.spec.ts',
  ],
  unitTests: [
    // billing.test.ts covers Stripe checkout session creation helpers
    // DRIFT: no dedicated donations unit test
    'billing.test.ts',
  ],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [
    // Donation body schema lives inline in routes/search.ts
    // DRIFT: should be extracted to libs/features/donations_engine/schemas.ts
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
      'Experimental. Enable via /admin/feature-flags. ' +
      'Beta after: dedicated D1 donations table + admin UI component + dedicated E2E spec.',
  },

  risks: [
    'Stripe Connect application_fee rate (1.5%) must not exceed platform limits.',
    'Widget iframe served unconditionally — should be flag-gated on the serve path.',
    'No dedicated D1 tables yet; uses subscriptions + Stripe as source of truth.',
  ],

  removalNotes:
    'Remove: routes/search.ts POST /api/donate handler, routes/public.ts /_widget/donate* handlers, ' +
    'billing.ts Stripe Connect application_fee paths. Drop FLAG_REGISTRY entry.',
});
