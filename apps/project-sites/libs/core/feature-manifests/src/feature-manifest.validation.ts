/**
 * @module feature-manifests/validation
 * @description Build-time invariants the validator script enforces.
 *
 * Exported as pure functions so unit tests + CI script + admin UI all share
 * one implementation.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FeatureManifest } from './feature-manifest.schema.js';

export interface ValidationIssue {
  slug: string;
  field: string;
  message: string;
}

/** Verify every test path on the manifest resolves to a real file. */
export function findMissingTestPaths(
  manifest: FeatureManifest,
  repoRoot: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pathArrays: Array<[keyof FeatureManifest, string[]]> = [
    ['e2eTests', manifest.e2eTests],
    ['unitTests', manifest.unitTests],
    ['integrationTests', manifest.integrationTests],
    ['zodSchemas', manifest.zodSchemas],
  ];
  for (const [field, paths] of pathArrays) {
    for (const p of paths) {
      const abs = join(repoRoot, p);
      if (!existsSync(abs)) {
        issues.push({
          slug: manifest.slug,
          field: String(field),
          message: `path does not exist: ${p}`,
        });
      }
    }
  }
  return issues;
}

/** Verify lifecycle + testStatus + observability are internally consistent. */
export function findLifecycleInconsistencies(manifest: FeatureManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Stable features MUST have passing tests + full observability
  if (manifest.lifecycle === 'stable') {
    if (manifest.testStatus !== 'passing') {
      issues.push({
        slug: manifest.slug,
        field: 'testStatus',
        message: `lifecycle='stable' requires testStatus='passing', got '${manifest.testStatus}'`,
      });
    }
    if (!manifest.observability.sentry || !manifest.observability.logs) {
      issues.push({
        slug: manifest.slug,
        field: 'observability',
        message: `lifecycle='stable' requires sentry + logs observability`,
      });
    }
  }

  // Deprecated features SHOULD have removalNotes
  if (manifest.lifecycle === 'deprecated' && !manifest.removalNotes) {
    issues.push({
      slug: manifest.slug,
      field: 'removalNotes',
      message: `lifecycle='deprecated' requires removalNotes`,
    });
  }

  // Removed features should have no routes/apiRoutes (cleaned up)
  if (manifest.lifecycle === 'removed') {
    if (manifest.routes.length > 0 || manifest.apiRoutes.length > 0) {
      issues.push({
        slug: manifest.slug,
        field: 'routes',
        message: `lifecycle='removed' but routes/apiRoutes still populated — finish removal`,
      });
    }
  }

  return issues;
}
