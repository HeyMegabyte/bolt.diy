/**
 * @module libs/features/template_marketplace
 *
 * Feature manifest for Template Marketplace v1 (IDEAS-50 #39).
 * Framer-style economics: creator keeps 100% on direct sales, 50% on
 * platform-referred conversions. Brian curates submissions; payouts via
 * Stripe Connect Express once onboarded.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'template_marketplace',
  name: 'Template Marketplace v1',
  description:
    'Framer-style template marketplace. Creators submit, Brian curates, creator keeps ' +
    '100% on direct sales + 50% on platform-referred conversions. Powered by Stripe Connect.',
  lifecycle: 'in-development',
  flagKey: 'template_marketplace',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [
    // Admin curation surface lives under existing /admin/templates Angular page.
  ],
  apiRoutes: [
    'GET  /api/template-marketplace/templates',
    'GET  /api/template-marketplace/templates/:id',
    'POST /api/template-marketplace/submissions',
    'POST /api/template-marketplace/templates/:id/purchase',
    'GET  /api/template-marketplace/my-templates',
    'GET  /api/template-marketplace/my-purchases',
  ],

  // ---- governance ----
  permissions: ['templates:read', 'templates:write', 'billing:read'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['src/__tests__/template_marketplace.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/template_marketplace/feature.schemas.ts'],

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
      'Experimental. Beta after: Stripe Connect Express platform onboarding + creator payout schedule + admin curation UI.',
  },

  risks: [
    'Requires Brian to complete Stripe Connect platform onboarding before payouts can fire.',
    'Submission curation is manual; no automated content moderation yet.',
    'Refund flow not implemented — refunded_at column exists but webhook handler is a follow-up.',
    'Revenue split is locked at 100/0 direct + 50/50 referred; per-template overrides are out of scope for v1.',
  ],

  removalNotes:
    'Remove: src/routes/template_marketplace.ts, src/services/template_marketplace.ts, ' +
    'app.route mount in src/index.ts. Drop columns added to templates table by migration 0520. ' +
    'Drop tables template_purchases, marketplace_payouts. Drop FLAG_REGISTRY entry template_marketplace.',
});
