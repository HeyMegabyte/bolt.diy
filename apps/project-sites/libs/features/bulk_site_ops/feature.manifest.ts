/**
 * @module libs/features/bulk_site_ops
 *
 * Feature manifest for Bulk Site Ops (idea #17, P1) — apply a change/flag
 * across ALL your sites at once (agency leverage).
 *
 * This file is the registry entry only — source lives in
 * src/services/bulk_site_ops.ts (pure planner) + src/routes/bulk_site_ops.ts
 * (the POST /api/sites/bulk preview endpoint). The mutating executor is a
 * later slice.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'bulk_site_ops',
  name: 'Bulk Site Ops',
  description:
    'Plan and apply bulk ops (set_flag, republish, archive) across owned sites. Ownership-filtered, per-op validity, capped at 100. Archive, set_flag and republish executors all apply.',
  lifecycle: 'in-development',
  flagKey: 'bulk_site_ops',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-02',
  updatedAt: '2026-06-02',

  // ---- surfaces ----
  routes: [],
  apiRoutes: ['POST /api/sites/bulk'],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['__tests__/bulk_site_ops.test.ts'],
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
      'Experimental. Flag-gated POST returns 404 when off. dryRun (default true) ' +
      'returns the validated plan. dryRun:false applies archive (reversible ' +
      'status-only write, never the soft-delete path) and set_flag (tenant-scoped ' +
      'flag_overrides upsert; flagKey must be a known, non-core registry key) and ' +
      'republish (re-asserts published status + busts the host KV cache for each ' +
      'already-published site — NOT a full AI rebuild, never touches deleted_at). ' +
      'Each applied op writes an audit log (bulk_site_ops.archive / .set_flag / ' +
      '.republish). Beta after: an Angular admin surface + E2E.',
  },

  risks: [
    'A bulk apply touches many sites at once — the planner caps the batch at 100 and only ever acts on owned, eligible sites; the preview slice mutates nothing.',
    'archive must NOT reuse the soft-delete path (which sets deleted_at) — the executor slice uses a reversible status-only archive.',
  ],

  removalNotes:
    'Remove: routes/bulk_site_ops.ts, services/bulk_site_ops.ts, ' +
    'libs/features/bulk_site_ops/, the bulk_site_ops FLAG_REGISTRY entry, ' +
    "and the app.route('/', bulkSiteOps) mount in src/index.ts.",
});
