/**
 * @module libs/features/referral_loop
 *
 * Feature manifest for the Built-In Referral Loop (idea #33).
 * Dropbox/Trello-pattern: double-sided rewards, unique invite codes,
 * `k`-coefficient dashboard. Closes the viral half of `agency_tier`
 * by giving the platform a self-served growth channel.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'referral_loop',
  name: 'Referral Loop',
  description:
    'Built-in referral loop: unique invite codes, double-sided rewards (referrer +30 days Pro, referee 30 days free), viral coefficient k dashboard.',
  lifecycle: 'alpha',
  flagKey: 'referral_loop',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  routes: ['/admin/refer'],
  apiRoutes: [
    'GET  /api/referrals/my-code',
    'GET  /api/referrals/stats',
    'GET  /api/referrals/mine',
    'POST /api/referrals/invite',
    'POST /api/referrals/claim',
    'POST /api/referrals/:id/convert',
  ],

  permissions: ['billing:read'],
  dependencies: [],

  // DRIFT: e2e/referral_loop/ specs not yet authored; unit tests live
  // colocated at libs/features/referral_loop/__tests__/ (Jest finds them
  // via discovery; validator only accepts src/__tests__/ prefix). Move on
  // next sweep per [[e2e-tdd-organization]].
  e2eTests: [],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  zodSchemas: ['libs/features/referral_loop/schemas.ts'],

  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Experimental. Promote to beta after k-coefficient dashboard is in /admin/refer and at least 10 referrals have round-tripped end-to-end.',
  },

  risks: [
    'Self-referral guard relies on user_id equality; same-person, multi-account abuse still possible — Stripe billing fraud signal needed for stable promotion.',
    'No throttling on /api/referrals/invite — a malicious user could spam invites; rate-limit in nginx/Worker tier before beta.',
    'Pro-day extensions are tracked but not yet redeemed against billing.subscriptions — settlement pass required to actually extend subs.',
  ],

  removalNotes:
    'Drop tables: referrals, referral_rewards. Remove route mount in src/index.ts. Drop FLAG_REGISTRY.referral_loop entry. Remove /admin/refer Angular section.',
});
