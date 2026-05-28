/**
 * @module libs/features/admin-detail
 *
 * Feature manifest for the Admin Site Detail panel (core, always-on).
 * The split-view master/detail surface where a site row expands into the
 * detail drawer showing build status, logs, hostname, billing, and bolt editor.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'admin-detail',
  name: 'Admin Site Detail',
  description:
    'Core admin surface: split-view site detail drawer with build status, ' +
    'logs, hostnames, billing, and bolt editor. Always-on.',
  lifecycle: 'beta',
  flagKey: 'core_admin_detail',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/sites/:id'],
  apiRoutes: [
    'GET  /api/sites/:id',
    'GET  /api/sites/:id/workflow',
    'GET  /api/sites/:id/logs',
    'POST /api/sites/:id/reset',
    'POST /api/sites/:id/deploy',
    'POST /api/sites/:id/publish-bolt',
    'DELETE /api/sites/:id',
  ],

  // ---- governance ----
  permissions: ['sites:read', 'sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'admin-and-billing.spec.ts',
    'admin-modals.spec.ts',
    '_fortress/admin-detail/happy-path.spec.ts',
    '_fortress/admin-detail/adversarial.spec.ts',
  ],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [],

  // ---- observability ----
  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: true,
    environments: {
      development: true,
      production: true,
    },
    notes: 'Core admin surface — always enabled. flagKey core_admin_detail sentinel.',
  },

  risks: [
    'Detail panel holds bolt.diy iframe — persistent iframe pattern means memory leaks if destroyed on navigation.',
    'publish-bolt route accepts arbitrary file paths from the bolt editor context; validate against the site slug on server.',
  ],

  removalNotes: 'Core surface — not removable independently.',
});
