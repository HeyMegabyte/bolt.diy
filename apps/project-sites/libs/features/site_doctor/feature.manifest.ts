import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'site_doctor',
  name: 'Site Doctor — Owner Health Report',
  description:
    'Owner-facing A–F health report with prioritized, plain-English, one-tap ' +
    'fixes. Translates the production-readiness signals (published, custom ' +
    'domain, performance, sitemap) into language a non-technical owner acts on. ' +
    'Generous-free: the free plan sees the top issue; the rest are locked behind ' +
    'a paid power-up. Voice is sharp and professional. Pure scoring + lock core.',
  lifecycle: 'alpha',
  flagKey: 'site_doctor',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-28',
  updatedAt: '2026-06-28',
  routes: [],
  apiRoutes: ['GET /api/sites/:siteId/doctor'],
  permissions: ['sites:read'],
  dependencies: ['prod_readiness_score'],
  e2eTests: [],
  unitTests: ['../libs/features/site_doctor/__tests__/site_doctor.test.ts'],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: {
    axiom: true,
    logs: true,
    analytics: false,
  },
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Experimental. Enable via /admin/feature-flags. ' +
      'Beta after: the report renders on the owner dashboard with the free-lock + ' +
      'an upsell to the paid power-up, and grade matches readiness end-to-end.',
  },
  risks: [
    'Reuses prod_readiness_score computeReadiness — if that module changes its check names, the owner-facing copy map falls back to a generic low-severity issue (degrades, never throws).',
    'The free/paid lock keys solely on the plan query param; a spoofed plan=pro only UNLOCKS advisory fix text (no data/privilege gain), so it is low-risk.',
    'Readiness signals are point-in-time; a stale lighthouse_score shows an out-of-date grade until the next build refreshes it.',
  ],
  removalNotes:
    'Remove this module, the app.route() mount in src/index.ts, and the ' +
    'site_doctor entry in src/modules/feature_flags/registry.ts. No tables owned.',
});
