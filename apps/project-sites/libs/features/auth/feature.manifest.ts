/**
 * @module libs/features/auth
 *
 * Feature manifest for the Authentication surface (core, always-on).
 * Magic-link email flow, Google OAuth, session management, and OTP
 * verification. No feature flag gates this — it is a core platform surface.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'auth',
  name: 'Authentication',
  description:
    'Core auth surface: magic-link email + Google OAuth + session ' +
    'management + OTP verification. Always-on; not flag-gated.',
  lifecycle: 'stable',
  flagKey: 'core_auth',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/signin', '/auth/callback', '/auth/magic-link/verify'],
  apiRoutes: [
    'POST /api/auth/magic-link',
    'GET  /api/auth/magic-link/verify',
    'GET  /api/auth/google',
    'GET  /api/auth/google/callback',
    'GET  /api/auth/me',
  ],

  // ---- governance ----
  permissions: [],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'auth-and-signin.spec.ts',
    'auth/auth-flows.spec.ts',
    '_fortress/auth/happy-path.spec.ts',
    '_fortress/auth/adversarial.spec.ts',
  ],
  unitTests: [
    // auth.test.ts covers magic-link token generation + session creation + Google OAuth state
    '__tests__/auth.test.ts',
  ],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [
    // MagicLinkRequestSchema, GoogleCallbackSchema inline in routes/api.ts → services/auth.ts
    // DRIFT: should be extracted to libs/features/auth/schemas.ts
  ],

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
    notes: 'Core surface — always enabled. flagKey core_auth is a sentinel that always returns true.',
  },

  risks: [
    'Magic-link token TTL (15 min) — expired links show an unhelpful 401; should redirect to /signin?expired=1.',
    'Google OAuth state stored in D1 oauth_states — no TTL cron yet; rows accumulate.',
    'Sessions have no absolute expiry, only sliding renewal — long-lived sessions never expire.',
  ],

  removalNotes: 'This is a core surface. Removal would require a full platform rebuild.',
});
