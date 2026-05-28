/**
 * @module feature-flags/schema
 * @description Extended Zod schema for feature flags.
 *
 * **Compatibility contract**: the existing `FlagDefinition` interface in
 * `apps/project-sites/src/modules/feature_flags/registry.ts` (104 entries)
 * stays the runtime source of truth for KV+D1 lookups. This schema is the
 * AUTHORING contract for NEW flags going forward — strictly stricter than
 * the legacy shape, so any new flag is also a legal old flag.
 *
 * New required fields (vs legacy):
 *   - `featureSlug` — backlink to `libs/features/<slug>/`
 *   - `manifestPath` — git-tracked path to that manifest
 *   - `lifecycle` — flow state aligned with FeatureManifest
 *   - `testStatus` — health of the test suite proving the flag works
 *   - `e2eTests` + `unitTests` — paths to proving tests
 *   - `risks` — known abuse / scale / billing concerns
 *   - `createdAt` + `updatedAt` — audit timestamps
 *
 * Optional:
 *   - `environments` — per-env defaults (`production:false`, `dev:true`)
 *   - `owner` + `deprecatedAt` + `removalNotes`
 *
 * Cross-link: [[feature-flags]] · `feature-manifest.schema.ts`
 */
import { z } from 'zod';
import {
  FeatureLifecycleSchema,
  FeatureTestStatusSchema,
} from '../../feature-manifests/src/feature-manifest.schema.js';

export const FeatureFlagSchema = z.object({
  /** Stable key matching the legacy `FlagDefinition.key` shape. */
  key: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z][a-z0-9_]*$/, 'flag key must be lowercase snake_case ≤32 chars'),

  /** Short human-readable name (rendered in admin flag list). */
  name: z.string().min(1),

  /** Full description (≥30 chars) — appears in `/admin/feature-flags` rows. */
  description: z.string().min(30),

  /** Backlink to `libs/features/<slug>/`. */
  featureSlug: z.string().min(1),

  /** Git-tracked path to the manifest file. */
  manifestPath: z.string().min(1),

  /** Whether enabled by default in production. */
  enabledByDefault: z.boolean(),

  /** Per-environment defaults. */
  environments: z.record(z.string(), z.boolean()).default({}),

  /** Lifecycle aligned with FeatureManifest. */
  lifecycle: FeatureLifecycleSchema,

  /** Test-suite health. */
  testStatus: FeatureTestStatusSchema,

  /** Paths to Playwright spec files proving the flag-on + flag-off behavior. */
  e2eTests: z.array(z.string()).default([]),

  /** Paths to unit/integration tests. */
  unitTests: z.array(z.string()).default([]),

  /** Owner email. */
  owner: z.string().email().optional(),

  /** Known abuse / scale / billing / vendor-lock concerns. */
  risks: z.array(z.string()).default([]),

  /** ISO date strings. */
  createdAt: z.string(),
  updatedAt: z.string(),

  /** When deprecated, ISO date the deprecation was declared. */
  deprecatedAt: z.string().optional(),

  /** Removal plan + replacement notes. */
  removalNotes: z.string().optional(),
});

export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

/**
 * Authoring helper — runs Zod validation at module load time.
 *
 * @example
 *   export default defineFeatureFlag({
 *     key: 'donations_engine',
 *     name: 'Donations Engine',
 *     description: 'Donorbox-class donations: one-time + recurring + DAFpay.',
 *     featureSlug: 'donations_engine',
 *     manifestPath: 'libs/features/donations_engine/feature.manifest.ts',
 *     enabledByDefault: false,
 *     lifecycle: 'experimental',
 *     testStatus: 'partial',
 *     // ...
 *   });
 */
export function defineFeatureFlag(input: FeatureFlag): FeatureFlag {
  return FeatureFlagSchema.parse(input);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge to the legacy registry
// ─────────────────────────────────────────────────────────────────────────────

/** Legacy `FlagDefinition` interface — kept for compatibility with the 104
 *  entries in `src/modules/feature_flags/registry.ts`. */
export interface LegacyFlagDefinition {
  key: string;
  description: string;
  default_enabled: boolean;
  default_rollout_percent: number;
  stage: 'experimental' | 'beta' | 'stable' | 'deprecated' | 'killswitch';
  owner_email: string;
}

/**
 * Convert a strict `FeatureFlag` to the legacy `FlagDefinition` shape so the
 * worker's KV+D1 resolution layer keeps working unchanged.
 */
export function toLegacyFlagDefinition(flag: FeatureFlag): LegacyFlagDefinition {
  // Map lifecycle → stage. 'planned'/'in-development'/'alpha'/'beta' → 'experimental'/'beta';
  // 'stable' → 'stable'; 'deprecated' → 'deprecated'; 'removed' → 'deprecated' (KV cleanup later).
  const stage: LegacyFlagDefinition['stage'] =
    flag.lifecycle === 'stable'
      ? 'stable'
      : flag.lifecycle === 'beta'
        ? 'beta'
        : flag.lifecycle === 'deprecated' || flag.lifecycle === 'removed'
          ? 'deprecated'
          : 'experimental';

  return {
    key: flag.key,
    description: flag.description,
    default_enabled: flag.enabledByDefault,
    default_rollout_percent: flag.enabledByDefault ? 100 : 0,
    stage,
    owner_email: flag.owner ?? 'brian@megabyte.space',
  };
}
