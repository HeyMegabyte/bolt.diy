/**
 * @module feature-manifests/schema
 * @description Zod schema for the canonical Feature Manifest contract.
 *
 * Every meaningful product capability ("feature module") declares a typed
 * manifest. The manifest is the single source of truth for: lifecycle state,
 * surfaces (routes + APIs), tests that prove it works, observability
 * coverage, rollout posture, and removal notes.
 *
 * Future AI agents MUST:
 *   1. Parse manifests via `FeatureManifestSchema.parse(...)` at lib load time.
 *   2. Cross-check the `flagKey` against `FLAG_REGISTRY`.
 *   3. Cross-check `e2eTests[]` + `unitTests[]` against the filesystem.
 *
 * Drift = build fail. See `scripts/validate-feature-manifests.mjs`.
 *
 * Cross-link: [[feature-flags]] · `docs/architecture/feature-modules.md`
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle states a feature module flows through. */
export const FeatureLifecycleSchema = z.enum([
  'planned',
  'in-development',
  'alpha',
  'beta',
  'stable',
  'deprecated',
  'removed',
]);

export type FeatureLifecycle = z.infer<typeof FeatureLifecycleSchema>;

/** Health of the test suite proving the feature works. */
export const FeatureTestStatusSchema = z.enum([
  'not-started',
  'partial',
  'passing',
  'failing',
  'blocked',
  'not-applicable',
]);

export type FeatureTestStatus = z.infer<typeof FeatureTestStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Sub-schemas
// ─────────────────────────────────────────────────────────────────────────────

export const FeatureObservabilitySchema = z.object({
  /** Sentry spans/errors captured for this feature's operations. */
  sentry: z.boolean(),
  /** Structured logs (via `src/lib/log.ts` child logger) per operation. */
  logs: z.boolean(),
  /** PostHog / GA4 events emitted per operation. */
  analytics: z.boolean(),
});

export type FeatureObservability = z.infer<typeof FeatureObservabilitySchema>;

export const FeatureRolloutSchema = z.object({
  /** Whether the feature is enabled by default in production. */
  defaultEnabled: z.boolean(),
  /** Per-environment overrides keyed by env name (`development`, `staging`, etc). */
  environments: z.record(z.string(), z.boolean()).default({}),
  /** Free-form rollout notes — promotion criteria, KPI targets, killswitch plan. */
  notes: z.string().optional(),
});

export type FeatureRollout = z.infer<typeof FeatureRolloutSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Main manifest
// ─────────────────────────────────────────────────────────────────────────────

export const FeatureManifestSchema = z.object({
  /** Stable kebab-case slug. Matches `libs/features/<slug>/`. */
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'slug must be lowercase alphanumeric + underscores, starting with a letter'),

  /** Human-readable name shown in admin UIs + reports. */
  name: z.string().min(1),

  /** Long description (≥30 chars) — appears in feature catalog + docs. */
  description: z.string().min(30),

  /** Current lifecycle state. */
  lifecycle: FeatureLifecycleSchema,

  /** Owner email. Defaults to brian@megabyte.space. */
  owner: z.string().email().optional(),

  /** ISO date strings for audit + reporting. */
  createdAt: z.string(),
  updatedAt: z.string(),

  /** Frontend routes the feature exposes. Empty array = no UI. */
  routes: z.array(z.string()).default([]),

  /** Worker API route paths (e.g. `/api/donations/process`). Empty = no backend. */
  apiRoutes: z.array(z.string()).default([]),

  /** RBAC scopes the feature gates on. */
  permissions: z.array(z.string()).default([]),

  /** Other feature slugs this one depends on. */
  dependencies: z.array(z.string()).default([]),

  /**
   * Linked flag key — MUST exist in `FLAG_REGISTRY`. Validation script
   * cross-checks this at build time.
   */
  flagKey: z.string().min(1),

  /** Paths to Playwright spec files that prove this feature works. */
  e2eTests: z.array(z.string()).default([]),

  /** Paths to unit/integration test files. */
  unitTests: z.array(z.string()).default([]),

  /** Paths to integration test files (worker-level). */
  integrationTests: z.array(z.string()).default([]),

  /** Test-suite health. */
  testStatus: FeatureTestStatusSchema,

  /** Paths to Zod schema files that validate this feature's runtime data. */
  zodSchemas: z.array(z.string()).default([]),

  /** Observability coverage matrix. */
  observability: FeatureObservabilitySchema,

  /** Rollout posture. */
  rollout: FeatureRolloutSchema,

  /** Known risks — security, perf, billing, vendor-lock, abuse, etc. */
  risks: z.array(z.string()).default([]),

  /** When deprecated: how to remove safely + replacement notes. */
  removalNotes: z.string().optional(),
});

export type FeatureManifest = z.infer<typeof FeatureManifestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helper for ergonomic declaration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authoring helper — runs Zod validation at module load time so a malformed
 * manifest fails fast instead of silently shipping.
 *
 * @example
 *   export default defineFeatureManifest({
 *     slug: 'donations_engine',
 *     name: 'Donations Engine',
 *     description: '...',
 *     lifecycle: 'experimental',
 *     flagKey: 'donations_engine',
 *     // ...
 *   });
 */
export function defineFeatureManifest(input: FeatureManifest): FeatureManifest {
  return FeatureManifestSchema.parse(input);
}
