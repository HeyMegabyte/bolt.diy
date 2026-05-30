/**
 * @module libs/features/donations_engine
 *
 * Feature manifest for the Donations Engine — the campaign + donor-CRM layer.
 *
 * Scope of THIS module: fundraising campaigns (goal/raised/donor-count progress)
 * on the existing `donation_campaigns`/`donations` tables, plus `recordDonation`
 * which captures the donor into `contacts_core` (5th consumer).
 *
 * Relationship to the legacy path: a one-shot Stripe checkout `POST /api/donate`
 * already lives in `routes/search.ts` (no campaigns, no donor-CRM). This module
 * does NOT replace it — it adds the campaign/progress + donor-capture layer that
 * path lacks. Payment capture should converge on Square (per payments-routing)
 * whose verified webhook calls `recordDonation`.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'donations_engine',
  name: 'Donations Engine',
  description:
    'Fundraising campaigns (goal/raised/donor-count) on the donation_campaigns/donations tables + recordDonation which ' +
    'captures the donor into contacts_core (5th consumer). Complements the legacy one-shot Stripe /api/donate; payment capture converges on Square via webhook.',
  lifecycle: 'alpha',
  flagKey: 'donations_engine',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'POST /api/donations/campaigns',
    'GET /api/donations/campaigns',
    'GET /api/donations/campaigns/:id',
  ],

  // ---- governance ----
  permissions: ['billing:read', 'billing:write'],
  dependencies: ['contacts_core'],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/donations_engine/__tests__/donations_engine.test.ts'],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: ['schemas.ts'],

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
      'Beta after: Square Web Payments capture → webhook calls recordDonation + admin campaign UI + dedicated E2E spec.',
  },

  risks: [
    'recordDonation must ONLY be called post-capture by a verified payment webhook — it is intentionally NOT a public route (no fabricated donations).',
    'Coexists with the legacy Stripe /api/donate path; reconcile onto one rail (Square per payments-routing) before beta to avoid two donation systems.',
    'D1 has no multi-statement transaction — donation insert + campaign-total bump are two statements; a crash between them under-counts a campaign total (rare; reconcilable from the donations rows).',
  ],

  removalNotes:
    'Remove: this module, the donationsEngine app.route() mount in src/index.ts, and the donations_engine flag in registry.ts. ' +
    'Legacy /api/donate (routes/search.ts) is separate. No migration to revert — uses existing donation_campaigns/donations tables.',
});
