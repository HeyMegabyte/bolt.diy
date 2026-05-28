/**
 * @module libs/features/feature-flags
 *
 * Feature manifest for the Feature Flags admin surface (core, always-on).
 * The /admin/feature-flags UI that lets operators toggle flags, set rollout
 * percentages, promote stages, and manage per-scope overrides.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'feature-flags',
  name: 'Feature Flags Admin',
  description:
    'Admin UI to toggle flags, set rollout %, promote stages, and manage ' +
    'per-scope overrides. Core surface — always-on sentinel.',
  lifecycle: 'stable',
  flagKey: 'core_feature_flags',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/feature-flags'],
  apiRoutes: [
    'GET  /api/feature-flags',
    'POST /api/feature-flags/:key',
    'POST /api/feature-flags/:key/overrides',
    'DELETE /api/feature-flags/:key/overrides/:id',
  ],

  // ---- governance ----
  permissions: ['admin'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'features/all-endpoints.spec.ts',
    '_fortress/feature-flags/happy-path.spec.ts',
    '_fortress/feature-flags/adversarial.spec.ts',
  ],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [
    // FlagUpdateBodySchema, OverrideBodySchema inline in the feature-flags route handler
    // DRIFT: should be extracted to libs/features/feature-flags/schemas.ts
  ],

  // ---- observability ----
  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: true,
    environments: {
      development: true,
      production: true,
    },
    notes: 'Core surface — always enabled. flagKey core_feature_flags sentinel. Gating it would prevent operators from recovering from broken flags.',
  },

  risks: [
    'A bad flag mutation could disable core surfaces (auth, billing). Audit trail in feature_flag_audit D1 table provides recovery path.',
    'KV 60s TTL cache means a killswitch may take up to 60s to propagate to all edge PoPs.',
    'Admin mutations invalidate KV immediately — verify the invalidation pattern is applied after every POST.',
  ],

  removalNotes: 'This is a core governance surface. Removal would require migrating to an external flag service.',
});
