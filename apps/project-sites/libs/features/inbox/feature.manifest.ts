/**
 * @module libs/features/inbox
 *
 * Alias manifest — resolves the TEST_NOT_LINKED drift warning for
 * e2e/_fortress/inbox/.  The canonical implementation lives in
 * libs/features/unified_inbox/feature.manifest.ts.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'inbox',
  name: 'Unified Visitor Inbox (alias)',
  description:
    'Alias dir for _fortress/inbox → canonical lib unified_inbox. ' +
    'See libs/features/unified_inbox/feature.manifest.ts for full spec.',
  lifecycle: 'alpha',
  flagKey: 'alias_inbox',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [],

  // ---- governance ----
  permissions: [],
  dependencies: ['unified_inbox'],

  // ---- tests ----
  e2eTests: [
    '_fortress/inbox/happy-path.spec.ts',
    '_fortress/inbox/adversarial.spec.ts',
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
    notes: 'Alias only — defer to unified_inbox manifest for rollout decisions.',
  },

  risks: [
    'This is an alias dir. Canonical manifest is libs/features/unified_inbox/. Keep in sync.',
  ],

  removalNotes: 'Remove when e2e/_fortress/inbox/ is renamed to unified_inbox or canonical manifest is updated.',
});
