/**
 * @module libs/features/email_deliverability_wizard
 *
 * Feature manifest for the Email Deliverability Wizard (idea #12, P1).
 * Checks a sending domain's SPF, DKIM and DMARC DNS records via
 * DNS-over-HTTPS and returns a 0-100 deliverability score plus concrete DNS
 * fixes. Read-only — performs lookups only, persists nothing, no migration.
 *
 * This file is the registry entry only — source lives in
 * src/services/email_deliverability.ts + src/routes/email_deliverability.ts.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'email_deliverability_wizard',
  name: 'Email Deliverability Wizard',
  description:
    'Checks a sending domain SPF, DKIM and DMARC records via DNS-over-HTTPS and returns a 0-100 deliverability score with concrete DNS fixes. Read-only, persists nothing.',
  lifecycle: 'in-development',
  flagKey: 'email_deliverability_wizard',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-02',
  updatedAt: '2026-06-02',

  // ---- surfaces ----
  routes: [],
  apiRoutes: ['GET /api/sites/:siteId/deliverability'],

  // ---- governance ----
  permissions: ['sites:read'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['__tests__/email_deliverability.test.ts'],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [],

  // ---- observability ----
  observability: {
    sentry: true,
    logs: true,
    analytics: false,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Experimental. Flag-gated GET route returns 404 when off. ' +
      'Beta after: an Angular admin surface to display the score + fixes, and a D1 seed migration for the flag row.',
  },

  risks: [
    'DNS-over-HTTPS lookups can be slow or rate-limited — failures degrade gracefully to score 0 plus fixes, never throw.',
    'DKIM is selector-specific — only common selectors are probed, so a custom selector may read as missing (the fix copy says so).',
    'Score is a heuristic (SPF 35 + DMARC 35 + policy 10 + DKIM 20), not an inbox-placement guarantee.',
  ],

  removalNotes:
    'Remove: routes/email_deliverability.ts, services/email_deliverability.ts, ' +
    'libs/features/email_deliverability_wizard/, the email_deliverability_wizard FLAG_REGISTRY entry, ' +
    "and the app.route('/', emailDeliverabilityRoutes) mount in src/index.ts.",
});
