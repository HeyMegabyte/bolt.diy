/**
 * @module libs/features/abuse_takedown
 *
 * Feature manifest for abuse / takedown intake on published sites. Public
 * visitors report a site (DMCA, illegal, malware, phishing, spam); platform
 * super-admins review and either dismiss or uphold a takedown (which archives
 * the offending site). A hosting-platform necessity for legal + safety.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'abuse_takedown',
  name: 'Abuse & Takedown',
  description:
    'Abuse intake for published sites: public report submit (DMCA, illegal, malware, phishing, spam), ' +
    'super-admin review queue, and dismiss or uphold-takedown which archives the offending site.',
  lifecycle: 'beta',
  flagKey: 'abuse_takedown',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-07',
  updatedAt: '2026-06-07',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'POST /api/abuse/report',
    'GET /api/abuse/reports',
    'POST /api/abuse/reports/:id/resolve',
  ],

  // ---- governance ----
  permissions: ['platform:moderate'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/abuse_takedown/__tests__/abuse_takedown.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['schemas.ts'],

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
      'Ship dark; promote to stable in /admin/feature-flags so abuse intake is always reachable ' +
      '(safety/legal baseline). The destructive takedown action is super-admin gated regardless of stage.',
  },

  risks: [
    'Takedown archives the site (status=archived) — reversible via the normal site lifecycle, but a wrongful report acted on by an operator briefly takes a legitimate site offline.',
    'Public report endpoint is rate-limited (20/min) but unauthenticated, so a flood of bogus reports is possible; the operator review queue is the human gate before any takedown.',
    'reporter_email is optional + unverified — do not treat it as a trusted identity.',
  ],

  removalNotes:
    'Remove: this module, the abuseTakedown app.route() mount in src/index.ts, the abuse_takedown ' +
    'FLAG_REGISTRY entry, and migration 0536_abuse_reports.sql (drop the abuse_reports table). No other module depends on it.',
});
