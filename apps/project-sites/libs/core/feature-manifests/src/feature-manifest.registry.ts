/**
 * @module feature-manifests/registry
 * @description Runtime registry of all loaded feature manifests.
 *
 * Manifests register themselves at module-import time. The registry exposes
 * lookup + invariant validation (no duplicate slugs, no broken flag links).
 *
 * Cross-link: `feature-manifest.schema.ts` · [[feature-flags]]
 */
import type { FeatureManifest } from './feature-manifest.schema.js';

const MANIFESTS = new Map<string, FeatureManifest>();

/**
 * Register a feature manifest. Throws on duplicate slug.
 *
 * Called at module load by every `libs/features/<slug>/feature.manifest.ts`.
 */
export function registerFeatureManifest(manifest: FeatureManifest): void {
  if (MANIFESTS.has(manifest.slug)) {
    throw new Error(
      `Duplicate feature manifest slug: '${manifest.slug}'. ` +
        `Each feature module must have a unique slug.`,
    );
  }
  MANIFESTS.set(manifest.slug, manifest);
}

/** Look up a manifest by slug. */
export function getFeatureManifest(slug: string): FeatureManifest | undefined {
  return MANIFESTS.get(slug);
}

/** All registered manifests as a snapshot array. */
export function listFeatureManifests(): FeatureManifest[] {
  return Array.from(MANIFESTS.values());
}

/** All registered slugs. */
export function listFeatureSlugs(): string[] {
  return Array.from(MANIFESTS.keys());
}

/**
 * Cross-check every registered manifest's `flagKey` exists in the provided
 * flag registry. Returns the slugs whose flag is missing.
 */
export function findManifestsWithMissingFlags(
  flagKeys: Set<string>,
): Array<{ slug: string; flagKey: string }> {
  const missing: Array<{ slug: string; flagKey: string }> = [];
  for (const m of MANIFESTS.values()) {
    if (!flagKeys.has(m.flagKey)) {
      missing.push({ slug: m.slug, flagKey: m.flagKey });
    }
  }
  return missing;
}

/**
 * Resets the registry. Test-only — production callers should never invoke
 * this. Kept exported for unit tests of the registry itself.
 */
export function _resetManifestRegistry(): void {
  MANIFESTS.clear();
}
