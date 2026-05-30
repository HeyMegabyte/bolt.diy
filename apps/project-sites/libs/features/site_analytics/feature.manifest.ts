/**
 * @module libs/features/site_analytics
 *
 * Feature manifest for Site Analytics — an owner-facing dashboard that
 * aggregates already-captured lead/engagement data (contacts, form
 * submissions, newsletter subscribers, donations) per site. Reads existing
 * tables, no new event pipeline; a `visitor_events_core` (pageviews/sessions)
 * can extend it later without changing this contract.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'site_analytics',
  name: 'Site Analytics',
  description:
    'Owner-facing per-site analytics summary aggregating contacts, form submissions, newsletter subscribers and ' +
    'donations the platform already captures. Org-scoped, reads existing tables (no new event pipeline), defensive queries degrade missing sources to 0.',
  lifecycle: 'alpha',
  flagKey: 'site_analytics',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: ['GET /api/sites/:siteId/analytics'],

  // ---- governance ----
  permissions: ['analytics:read'],
  dependencies: ['contacts_core', 'visitor_events_core'],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/site_analytics/__tests__/site_analytics.test.ts'],
  integrationTests: [],
  testStatus: 'partial',

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
      'Experimental. Enable via /admin/feature-flags. ' +
      'Beta after: owner dashboard UI consumes the summary + a visitor_events_core adds pageviews/sessions + dedicated E2E spec.',
  },

  risks: [
    'Reads sibling tables (form_submissions, newsletter_subscribers, donations) — a schema rename there silently zeroes that metric until the query is updated.',
    'No pageview/session data yet; "analytics" here means captured-lead engagement, not traffic. Set expectations in the UI.',
    'Donation totals join donation_campaigns→donations; if donations land via a different table later, the sum under-counts.',
  ],

  removalNotes:
    'Remove: this module, the siteAnalytics app.route() mount in src/index.ts, and the site_analytics flag in registry.ts. ' +
    'No migration to revert — the module only reads existing tables.',
});
