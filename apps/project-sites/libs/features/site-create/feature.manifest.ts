/**
 * @module libs/features/site-create
 *
 * Feature manifest for the Site Creation flow (core, always-on).
 * The homepage search → select → details → waiting funnel that drives a
 * new site through the AI Workflow pipeline. No feature flag gates this.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'site-create',
  name: 'Site Creation',
  description:
    'Core site creation flow: homepage search → select business → upload ' +
    'details → AI workflow pipeline → published site. Always-on.',
  lifecycle: 'beta',
  flagKey: 'core_site_create',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/'],
  apiRoutes: [
    'GET  /api/search/businesses',
    'GET  /api/search/address',
    'GET  /api/sites/search',
    'GET  /api/sites/lookup',
    'POST /api/sites/create-from-search',
    'POST /api/sites',
    'GET  /api/slug/check',
    'GET  /api/sites/:id/workflow',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'golden-path.spec.ts',
    'ai-workflow.spec.ts',
    'business-enrichment.spec.ts',
    '_fortress/site-create/happy-path.spec.ts',
    '_fortress/site-create/adversarial.spec.ts',
  ],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [
    // CreateFromSearchBodySchema inline in routes/search.ts
    // DRIFT: should be extracted to libs/features/site-create/schemas.ts
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
    notes: 'Core golden-path funnel — always enabled. flagKey core_site_create sentinel.',
  },

  risks: [
    'AI workflow pipeline can take 15-40 min; Workflow step boundary failures leave site in "generating" forever without a stuck-build timeout.',
    'create-from-search fires the expensive 6-step AI pipeline immediately on form submit — no confirmation step.',
    'Slug collision check is racy under concurrent creates; UNIQUE constraint in D1 is the last-resort guard.',
  ],

  removalNotes: 'Core golden-path funnel — not removable without replacing the entire product.',
});
