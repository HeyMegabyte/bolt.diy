/**
 * @module libs/features/logs-explorer
 *
 * Feature manifest for the Worker Tail Log Explorer (Wave 2B feature #14).
 * 30-day FTS + DSL search over worker_logs D1 table, cost attribution per
 * route, and live tail streaming. Gated behind log_explorer flag.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'logs-explorer',
  name: 'Log Explorer',
  description:
    'Worker tail log explorer: 30-day FTS + DSL search + cost attribution ' +
    'per route. Backed by worker_logs D1 table.',
  lifecycle: 'alpha',
  flagKey: 'log_explorer',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/logs'],
  apiRoutes: [
    'GET  /api/admin/logs',
    'GET  /api/admin/logs/search',
    'GET  /api/sites/:id/logs',
  ],

  // ---- governance ----
  permissions: ['admin'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'audit-logs.spec.ts',
    'logs-and-delete.spec.ts',
    'logs/logs-explorer.spec.ts',
    '_fortress/logs-explorer/happy-path.spec.ts',
    '_fortress/logs-explorer/adversarial.spec.ts',
  ],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [],

  // ---- observability ----
  observability: {
    sentry: false,
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
      'Alpha. Enable via /admin/feature-flags. ' +
      'Beta after: DSL parser unit tests + cost attribution D1 aggregation + live tail SSE endpoint.',
  },

  risks: [
    'worker_logs D1 table can grow unbounded — no TTL or archival cron yet.',
    'FTS on D1 is limited to LIKE-based search; complex DSL queries may be slow at high volume.',
    'Log tail streaming via SSE keeps a Worker connection open; scale considerations apply.',
  ],

  removalNotes:
    'Remove: logs routes in src/index.ts, frontend logs.component.ts + /admin/logs lazy route. ' +
    'Drop D1 table worker_logs (migration cleanup). Drop FLAG_REGISTRY entry log_explorer.',
});
