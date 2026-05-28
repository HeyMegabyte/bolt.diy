/**
 * @module libs/features/swarm_editor
 *
 * Feature manifest for the Multi-Agent Swarm Editor (Wave 2C, feature #5).
 * Seven specialist AI agents co-edit a site via file-glob partitions with
 * SSE progress streaming and merge-conflict detection.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'swarm_editor',
  name: 'Multi-Agent Swarm Editor',
  description:
    'Wave 2C #5 — seven specialist AI agents (visual/copy/seo/a11y/motion/media/qa) co-edit a site ' +
    'simultaneously via non-overlapping file-glob partitions; SSE pushes per-specialist progress; ' +
    'merge-conflict detector fires on path overlap; admin board at /admin/swarm/:siteId.',
  lifecycle: 'alpha',
  flagKey: 'swarm_editor',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/swarm/:siteId'],
  apiRoutes: [
    'POST /api/swarm/:siteId/start',
    'GET  /api/swarm/:siteId/stream',
    'GET  /api/swarm/:siteId/runs',
    'GET  /api/swarm/:siteId/run/:runId',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'swarm/swarm.spec.ts',
    '_fortress/swarm-editor/happy-path.spec.ts',
    '_fortress/swarm-editor/adversarial.spec.ts',
  ],
  unitTests: [
    // DRIFT: no dedicated swarm unit test
    // Needs: src/__tests__/swarm.test.ts covering conflict-detector + SSE message format
  ],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [
    // SwarmStartBodySchema defined inline in routes/swarm.ts
    // DRIFT: should be extracted to libs/features/swarm_editor/schemas.ts
  ],

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
      'Beta after: unit tests + swarm_runs D1 migration file + load test showing <5s to first SSE event.',
  },

  risks: [
    'SSE connection held open per swarm run — at scale, saturates Worker connection limits.',
    'File-glob partitions are statically assigned; a site with unusual file layout may cause overlap.',
    'No swarm_runs D1 migration file — table bootstrapped on first run (schema drift risk).',
  ],

  removalNotes:
    'Remove: routes/swarm.ts, services/ide_sandbox.ts swarm paths, ' +
    'frontend swarm.component.ts + progressive-preview.component.ts, ' +
    'app.routes.ts /admin/swarm/:siteId lazy route, FLAG_REGISTRY entry.',
});
