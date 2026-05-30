/**
 * @module libs/features/visitor_events_core
 *
 * Feature manifest for Visitor Events Core — public pageview/session/click/
 * conversion ingest from published sites, aggregated per site. The traffic
 * foundation `site_analytics` was built to absorb; the published-site beacon
 * snippet + injection is a follow-up.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'visitor_events_core',
  name: 'Visitor Events Core',
  description:
    'Public beacon ingest for pageview/click/conversion events from published sites, deduped per session and aggregated ' +
    'per site over a trailing window. Origin-allow-listed + rate-limited + flag-gated; feeds the site_analytics traffic block.',
  lifecycle: 'alpha',
  flagKey: 'visitor_events_core',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: ['POST /api/v1/events'],

  // ---- governance ----
  permissions: [],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/visitor_events_core/__tests__/visitor_events.test.ts'],
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
      'Beta after: published-site beacon snippet injected by site_serving + site_analytics traffic block wired + dedicated E2E spec.',
  },

  risks: [
    'Public unauthenticated ingest — origin allow-list + per-IP rate limit are the only gates; a determined script could still inflate counts for a known slug.',
    'No bot filtering yet; pageview counts include crawlers until a UA/headless filter lands.',
    'session_id is client-supplied; unique-session counts are approximate, not authenticated.',
  ],

  removalNotes:
    'Remove: this module, migration 0532_visitor_events.sql (drop table visitor_events), the visitorEvents app.route() ' +
    'mount in src/index.ts, the visitor_events_core flag in registry.ts, and the site_analytics traffic block when wired.',
});
