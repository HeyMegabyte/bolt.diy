/**
 * @module libs/features/marketplace
 *
 * Feature manifest for the Vertical Section Marketplace (Wave 2C feature #8).
 * Curated bento sections per industry (nonprofit/restaurant/lawyer/salon/medical),
 * 30 seed entries, admin UI at /admin/marketplace.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'marketplace',
  name: 'Section Marketplace',
  description:
    'Vertical bento section marketplace: 30 seed sections per industry, ' +
    'install-to-site flow, admin UI at /admin/marketplace.',
  lifecycle: 'alpha',
  flagKey: 'section_marketplace',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/marketplace'],
  apiRoutes: [
    'GET  /api/marketplace/sections',
    'GET  /api/marketplace/sections/:id',
    'POST /api/marketplace/sections/:id/install',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'marketplace/marketplace.spec.ts',
    '_fortress/marketplace/happy-path.spec.ts',
  ],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [],

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
      'Alpha. Enable via /admin/feature-flags. ' +
      'Beta after: 30 seed entries in D1 + install-to-site bolt.diy integration + unit tests. ' +
      'Note: no adversarial.spec.ts in _fortress/marketplace/ — add before promoting to beta.',
  },

  risks: [
    'No adversarial E2E coverage yet — _fortress/marketplace/ has only happy-path.spec.ts.',
    'Section install mutates site files via bolt.diy iframe; no conflict detection if site is mid-edit.',
    'Marketplace content seeding requires a D1 migration — ensure idempotent on re-run.',
  ],

  removalNotes:
    'Remove: marketplace routes in src/index.ts, frontend marketplace.component.ts + /admin/marketplace. ' +
    'Drop D1 tables: marketplace_sections, marketplace_installs. Drop FLAG_REGISTRY entry section_marketplace.',
});
