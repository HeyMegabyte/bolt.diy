/**
 * @module libs/features/build_progress
 *
 * Feature manifest for Event-Sourced Build Progress (idea #10).
 * Replaces 30s KV polling with a typed, Zod-validated, durable, replayable
 * build-event stream + an SSE endpoint the cockpit subscribes to.
 *
 * Registry entry only — implementation lives in services/build_events.ts
 * (emitter + replay) and this module's handlers.ts (SSE + JSON replay).
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'build_progress',
  name: 'Event-Sourced Build Progress',
  description:
    'Typed, Zod-validated, durable, replayable AI build-event stream with an SSE endpoint the cockpit subscribes to, ' +
    'replacing opaque 30-second KV polling with live build.started through publish.completed progress.',
  lifecycle: 'alpha',
  flagKey: 'streaming_generation',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'GET /api/sites/:id/build/stream',
    'GET /api/sites/:id/build/events',
  ],

  // ---- governance ----
  permissions: ['sites:read'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/build_progress/__tests__/build_events.test.ts'],
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
      'Experimental. Reuses the streaming_generation flag. ' +
      'Beta after: cockpit subscribes to SSE in admin site-detail + dedicated E2E spec.',
  },

  risks: [
    'KV event log is best-effort durable; a KV outage drops events without failing the build.',
    'SSE poll interval (2s) trades latency for KV read volume on long builds.',
  ],

  removalNotes:
    'Remove: this module, services/build_events.ts, the buildProgress app.route() mount in src/index.ts, ' +
    'and the appendBuildEvent calls in workflows/site-generation.ts. The streaming_generation flag stays (shared).',
});
