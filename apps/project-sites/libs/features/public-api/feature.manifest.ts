/**
 * @module libs/features/public-api
 *
 * Alias manifest — resolves the TEST_NOT_LINKED drift warning for
 * e2e/_fortress/public-api/.  The canonical implementation lives in
 * libs/features/public_api_v1/feature.manifest.ts.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'public-api',
  name: 'Public API v1 (alias)',
  description:
    'Alias dir for _fortress/public-api → canonical lib public_api_v1. ' +
    'See libs/features/public_api_v1/feature.manifest.ts for full spec.',
  lifecycle: 'alpha',
  flagKey: 'alias_public_api',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [],

  // ---- governance ----
  permissions: [],
  dependencies: ['public_api_v1'],

  // ---- tests ----
  e2eTests: [
    '_fortress/public-api/happy-path.spec.ts',
    '_fortress/public-api/adversarial.spec.ts',
  ],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [],

  // ---- observability ----
  observability: {
    sentry: false,
    logs: false,
    analytics: false,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: false,
    environments: {},
    notes: 'Alias only — defer to public_api_v1 manifest for rollout decisions.',
  },

  risks: [
    'This is an alias dir. Canonical manifest is libs/features/public_api_v1/. Keep in sync.',
  ],

  removalNotes: 'Remove when e2e/_fortress/public-api/ is renamed to public_api_v1 or canonical manifest is updated.',
});
