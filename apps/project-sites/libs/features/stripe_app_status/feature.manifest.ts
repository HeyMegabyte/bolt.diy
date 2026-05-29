/**
 * @module libs/features/stripe_app_status
 *
 * Feature manifest for the Stripe App Marketplace install-analytics
 * surface (idea #36, admin-side slice).
 *
 * The growth agent owns the marketplace listing manifest itself; this
 * feature owns the admin page that surfaces install analytics + lifecycle
 * events for already-installed accounts.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'stripe_app_status',
  name: 'Stripe App Marketplace Status',
  description:
    'Admin dashboard for Stripe App Marketplace installs: install analytics, lifecycle events, top install sources. Marketplace manifest itself is owned by the growth agent.',
  lifecycle: 'in-development',
  flagKey: 'stripe_app_status',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/stripe-app-status'],
  apiRoutes: [
    'GET    /api/stripe-app/installs',
    'GET    /api/stripe-app/summary',
    'POST   /api/stripe-app/lifecycle',
  ],

  // ---- governance ----
  permissions: ['billing:read'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['__tests__/stripe_app_status.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/stripe_app_status/feature.schemas.ts'],

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
      'Experimental. Beta once the growth agent ships the marketplace manifest + OAuth callback feeds install events into POST /api/stripe-app/lifecycle.',
  },

  risks: [
    'Cross-agent coordination: marketplace OAuth callback (growth agent) must POST to /api/stripe-app/lifecycle once it lands.',
    'Install row is keyed on Stripe account id; org association can lag until the merchant signs in via Stripe.',
  ],

  removalNotes:
    'Remove: src/routes/stripe_app_status.ts, src/services/stripe_app_status.ts, /admin/stripe-app-status component, migration 0520 stripe_app_installations table, FLAG_REGISTRY stripe_app_status entry.',
});
