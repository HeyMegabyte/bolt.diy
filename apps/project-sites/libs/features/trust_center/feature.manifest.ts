/**
 * @module libs/features/trust_center
 *
 * Feature manifest for the Trust Center (idea #50).
 * Per-customer-org admin route /admin/trust + per-published-site public route
 * /trust. Surfaces: AI models used, content provenance, audit-log access
 * policy, data residency, fallback behavior on AI outage, custom disclosures.
 * Compliance asset for EU AI Act high-risk obligations launching Aug 2 2026.
 *
 * Registry entry only — source lives in src/services + src/routes + frontend.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'trust_center',
  name: 'Trust Center',
  description:
    'Per-org admin Trust Center + per-published-site public /trust page. AI models, content provenance, audit-log policy, data residency, AI-outage fallback. Compliance + sales asset.',
  lifecycle: 'in-development',
  flagKey: 'trust_center',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/trust', '/{slug}/trust'],
  apiRoutes: [
    'GET    /api/trust/profile',
    'PUT    /api/trust/profile',
    'POST   /api/trust/profile/publish',
    'GET    /api/trust/site/:siteId',
    'PUT    /api/trust/site/:siteId',
    'GET    /api/public/trust/:siteSlug',
  ],

  // ---- governance ----
  permissions: ['sites:read', 'sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['__tests__/trust_center.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/trust_center/feature.schemas.ts'],

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
      'Experimental. Public /trust route auto-derives from org-level profile when no per-site override exists. Promote to beta after admin UI ships, JSON-LD DigitalDocument validates in Rich Results, E2E specs land.',
  },

  risks: [
    'Public /trust page must not leak private contract terms — only customer-facing disclosures.',
    'AI-model list must stay in sync with what the build pipeline actually uses; manual edits drift.',
    'Audit-log policy claim must match enterprise_audit_exports availability for the org.',
  ],

  removalNotes:
    'Remove: src/routes/trust_center.ts, src/services/trust_center.ts, /admin/trust component, public /trust route in site_serving, migration 0520 trust_profiles table, FLAG_REGISTRY trust_center entry.',
});
