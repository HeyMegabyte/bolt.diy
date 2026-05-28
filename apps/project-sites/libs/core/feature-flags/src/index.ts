/**
 * @projectsites/feature-flags
 *
 * Strict typed Feature Flag contract (Zod-validated) that extends the legacy
 * 104-entry `FLAG_REGISTRY` in `apps/project-sites/src/modules/feature_flags/registry.ts`
 * with manifest-awareness + lifecycle + test linkage.
 *
 * Existing flags keep working unchanged. New flags MUST use
 * `defineFeatureFlag(...)` and live in `libs/features/<slug>/feature.flag.ts`.
 *
 * Cross-link: [[feature-flags]] · `feature-manifest.schema.ts`
 */
export {
  FeatureFlagSchema,
  defineFeatureFlag,
  toLegacyFlagDefinition,
} from './feature-flag.schema.js';

export type { FeatureFlag, LegacyFlagDefinition } from './feature-flag.schema.js';
