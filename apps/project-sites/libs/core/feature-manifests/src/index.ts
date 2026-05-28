/**
 * @projectsites/feature-manifests
 *
 * Public entry point for the feature-manifest library.
 *
 * Usage in a feature module:
 *
 *   // libs/features/donations_engine/feature.manifest.ts
 *   import { defineFeatureManifest } from '@projectsites/feature-manifests';
 *
 *   export default defineFeatureManifest({
 *     slug: 'donations_engine',
 *     name: 'Donations Engine',
 *     description: 'Donorbox-class donations: one-time + recurring + DAFpay + matching.',
 *     lifecycle: 'experimental',
 *     flagKey: 'donations_engine',
 *     routes: ['/admin/donations'],
 *     apiRoutes: ['/api/donations/campaigns', '/api/donations/process'],
 *     e2eTests: ['e2e/_fortress/donations/happy-path.spec.ts'],
 *     unitTests: ['src/services/__tests__/big_bets.donations.test.ts'],
 *     integrationTests: [],
 *     testStatus: 'partial',
 *     zodSchemas: [],
 *     observability: { sentry: true, logs: true, analytics: true },
 *     rollout: { defaultEnabled: false, environments: {}, notes: 'Beta after 1mo' },
 *     risks: ['Stripe API rate limits at scale'],
 *     createdAt: '2026-05-27',
 *     updatedAt: '2026-05-28',
 *   });
 *
 * Cross-link: [[feature-flags]] · `docs/architecture/feature-modules.md`
 */
export {
  FeatureManifestSchema,
  FeatureLifecycleSchema,
  FeatureTestStatusSchema,
  FeatureObservabilitySchema,
  FeatureRolloutSchema,
  defineFeatureManifest,
} from './feature-manifest.schema.js';

export type {
  FeatureManifest,
  FeatureLifecycle,
  FeatureTestStatus,
  FeatureObservability,
  FeatureRollout,
} from './feature-manifest.schema.js';

export {
  registerFeatureManifest,
  getFeatureManifest,
  listFeatureManifests,
  listFeatureSlugs,
  findManifestsWithMissingFlags,
  _resetManifestRegistry,
} from './feature-manifest.registry.js';

export {
  findMissingTestPaths,
  findLifecycleInconsistencies,
} from './feature-manifest.validation.js';

export type { ValidationIssue } from './feature-manifest.validation.js';
