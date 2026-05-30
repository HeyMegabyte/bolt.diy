/**
 * @module libs/features/contacts_core
 *
 * Feature manifest for Contacts Core (CRM) — the shared person/lead entity.
 * Every capture surface (unified_inbox, gbp_assist, review_synthesis,
 * reputation, donations_engine, referral_loop, affiliate_program) dedupes into
 * the one `contacts` table via `service.ts#recordContact`, instead of forking
 * its own contact store. This is the synchrony foundation for the de-stub wave.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'contacts_core',
  name: 'Contacts Core (CRM)',
  description:
    'Shared person/lead store with dedupe by org+email then org+phone. Capture surfaces (inbox, GBP, donations, ' +
    'referrals, affiliates, reviews, booking) call recordContact() to upsert into one contacts table instead of forking their own.',
  lifecycle: 'alpha',
  flagKey: 'contacts_core',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'GET /api/contacts',
    'POST /api/contacts',
    'GET /api/contacts/:id',
    'DELETE /api/contacts/:id',
  ],

  // ---- governance ----
  permissions: ['contacts:read', 'contacts:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/contacts_core/__tests__/contacts.test.ts'],
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
      'Beta after: ≥2 capture surfaces route through recordContact() + admin contacts list UI + dedicated E2E spec.',
  },

  risks: [
    'Dedupe key is (org, lower(email)) then (org, phone); a contact that changes email creates a second row until merged.',
    'Consent flags only flip 0→1 here — revocation must be handled by a dedicated unsubscribe path, not recordContact().',
    'JSON tags/metadata columns are parsed defensively; a malformed row degrades to empty rather than throwing.',
  ],

  removalNotes:
    'Remove: this module, migration 0531_contacts_core.sql (drop table contacts), the contactsCore app.route() ' +
    'mount in src/index.ts, the contacts_core flag in registry.ts, and any recordContact() callers in sibling modules.',
});
