/**
 * @module libs/features/data_export
 *
 * Feature manifest for Data Export — owner data portability (CLAUDE.md ethics:
 * users own their data + can export/port anytime; no lock-in). MVP exports an
 * org's `contacts` as RFC4180 CSV with CSV-injection neutralization. 4th
 * read-consumer of contacts_core.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'data_export',
  name: 'Data Export',
  description:
    "Owner data portability — download an org's contacts as RFC4180 CSV with OWASP CSV-injection neutralization. " +
    'Org-scoped, flag-gated, reads the contacts table (4th consumer of contacts_core). Foundation for full site/data export later.',
  lifecycle: 'alpha',
  flagKey: 'data_export',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: ['GET /api/exports/contacts.csv'],

  // ---- governance ----
  permissions: ['contacts:read'],
  dependencies: ['contacts_core'],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/data_export/__tests__/data_export.test.ts'],
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
      'Beta after: a download button in the contacts admin UI + JSON export + a full site/data export (R2 assets + D1 rows) + dedicated E2E spec.',
  },

  risks: [
    'Capped at 50,000 rows per export — a larger org silently truncates; add cursor/paged export before any org exceeds it.',
    'Synchronous in-Worker CSV build; very large exports could approach the CPU limit — move to a Workflow + R2 signed URL when needed.',
    'CSV-injection guard covers the leading-char vector; it does not sanitize content for other downstream parsers.',
  ],

  removalNotes:
    'Remove: this module, the dataExport app.route() mount in src/index.ts, and the data_export flag in registry.ts. ' +
    'No migration to revert — it only reads the existing contacts table.',
});
