/**
 * @module libs/features/plugin_marketplace
 *
 * Feature manifest for the Plugin / Integration Marketplace (IDEAS-50 #41).
 * Webflow-style 500-plugin catalog with 70/30 creator revenue share.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'plugin_marketplace',
  name: 'Plugin / Integration Marketplace',
  description:
    'Third-party integrations installable per site. Plugins declare install hooks via a JSON manifest the build pipeline reads. 70/30 creator revenue share.',
  lifecycle: 'in-development',
  flagKey: 'plugin_marketplace',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'GET  /api/plugin-marketplace/plugins',
    'GET  /api/plugin-marketplace/plugins/:id',
    'POST /api/plugin-marketplace/submissions',
    'POST /api/plugin-marketplace/plugins/:id/install',
    'GET  /api/plugin-marketplace/sites/:siteId/installs',
    'DELETE /api/plugin-marketplace/installs/:installId',
  ],

  // ---- governance ----
  permissions: ['sites:write', 'billing:read'],
  dependencies: ['template_marketplace'],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['src/__tests__/plugin_marketplace.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/plugin_marketplace/feature.schemas.ts'],

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
      'Experimental. Beta after: site-build pipeline integration that reads plugin_installs + executes manifest hooks + injects scripts.',
  },

  risks: [
    'Plugin install hooks run inside the build pipeline — sandbox isolation is mandatory; untrusted creator code never runs in the main Worker.',
    'Manifest JSON validation must reject unsafe script src patterns (no data: / blob: / javascript: URLs).',
    'Requires Brian to complete Stripe Connect onboarding before creator payouts can fire.',
    'No plugin update lifecycle yet — site-build pipeline uses the latest live version at install time and never migrates older installs.',
  ],

  removalNotes:
    'Remove: src/routes/plugin_marketplace.ts, src/services/plugin_marketplace.ts, app.route mount in src/index.ts. ' +
    'Drop tables plugins, plugin_installs from migration 0520. Drop FLAG_REGISTRY entry plugin_marketplace.',
});
