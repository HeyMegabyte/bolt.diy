/**
 * @module libs/features/swarm-editor
 *
 * Alias manifest — resolves the TEST_NOT_LINKED drift warning for
 * e2e/_fortress/swarm-editor/.  The canonical implementation lives in
 * libs/features/swarm_editor/feature.manifest.ts.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'swarm-editor',
  name: 'Multi-Agent Swarm Editor (alias)',
  description:
    'Alias dir for _fortress/swarm-editor → canonical lib swarm_editor. ' +
    'See libs/features/swarm_editor/feature.manifest.ts for full spec.',
  lifecycle: 'alpha',
  flagKey: 'alias_swarm_editor',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [],

  // ---- governance ----
  permissions: [],
  dependencies: ['swarm_editor'],

  // ---- tests ----
  e2eTests: [
    '_fortress/swarm-editor/happy-path.spec.ts',
    '_fortress/swarm-editor/adversarial.spec.ts',
  ],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [],

  // ---- observability ----
  observability: {
    sentry: false,
    logs: false,
    analytics: false,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: false,
    environments: {},
    notes: 'Alias only — defer to swarm_editor manifest for rollout decisions.',
  },

  risks: [
    'This is an alias dir. Canonical manifest is libs/features/swarm_editor/. Keep in sync.',
  ],

  removalNotes: 'Remove when e2e/_fortress/swarm-editor/ is renamed to swarm_editor or canonical manifest is updated.',
});
