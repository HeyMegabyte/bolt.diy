/**
 * @module site_restore
 * @description Pure functions for building site restore plans and
 * generating restore-preview URLs from version snapshots.
 *
 * Restore plans enumerate available snapshots for a site and identify
 * the latest and oldest points. Preview URLs follow the convention
 * `{slug}-{version}.projectsites.dev` so users can inspect a frozen
 * version before committing to a restore.
 *
 * @packageDocumentation
 */

/**
 * A single restore point representing a frozen site snapshot.
 */
export interface RestorePoint {
  /** Version identifier (short SHA or sequential tag) */
  version: string;
  /** Site slug the snapshot belongs to */
  slug: string;
  /** ISO 8601 timestamp of when the snapshot was created */
  createdAt: string;
  /** Number of files in the snapshot */
  fileCount: number;
  /** Total size of all files in bytes */
  sizeBytes: number;
}

/**
 * A digest of available restore points for a site, identifying the
 * newest and oldest snapshots along with total count.
 */
export interface RestorePlan {
  /** The newest (most recent) restore point, or null if empty */
  latest: RestorePoint | null;
  /** Total number of available restore points */
  count: number;
  /** The oldest restore point, or null if empty */
  oldest: RestorePoint | null;
}

/**
 * Builds a restore plan from a list of restore points for a single site.
 *
 * The plan identifies the latest (most recent) and oldest snapshots to
 * give the caller an overview of the recovery range. Adjacent duplicate
 * versions are collapsed (only the last entry per version is kept).
 *
 * @param siteId - The site identifier (included for future provenance tracking)
 * @param slug - The site slug
 * @param points - An ordered (or unordered) list of restore points to analyse
 * @returns A `RestorePlan` with latest, oldest, and count
 *
 * @example
 * ```ts
 * const plan = buildRestorePlan('site-1', 'my-site', [
 *   { version: 'abc', slug: 'my-site', createdAt: '2026-06-28T12:00:00Z', fileCount: 10, sizeBytes: 50000 },
 *   { version: 'def', slug: 'my-site', createdAt: '2026-06-29T12:00:00Z', fileCount: 12, sizeBytes: 62000 },
 * ]);
 * // → { latest: { version: 'def', … }, count: 2, oldest: { version: 'abc', … } }
 * ```
 */
export function buildRestorePlan(
  _siteId: string,
  _slug: string,
  points: readonly RestorePoint[],
): RestorePlan {
  if (points.length === 0) {
    return { count: 0, latest: null, oldest: null };
  }

  // Collapse adjacent duplicates to the last occurrence per version.
  const seen = new Set<string>();
  const deduped: RestorePoint[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (!seen.has(p.version)) {
      seen.add(p.version);
      deduped.unshift(p);
    }
  }

  // Sort by createdAt ascending.
  const sorted = [...deduped].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return {
    count: sorted.length,
    latest: sorted[sorted.length - 1] ?? null,
    oldest: sorted[0] ?? null,
  };
}

/**
 * Generates a preview URL for a specific version snapshot of a site.
 *
 * Preview URLs follow the convention `{slug}-{version}.projectsites.dev`
 * so users can inspect a frozen version in the browser before committing
 * to a restore. The base domain can be overridden for local development
 * or custom deployment scenarios.
 *
 * @param slug - The site slug
 * @param version - The version identifier (short SHA or tag)
 * @param baseDomain - Optional base domain (defaults to `projectsites.dev`)
 * @returns A fully-qualified preview URL
 *
 * @example
 * ```ts
 * restorePreviewUrl('my-site', 'abc123');
 * // → 'https://my-site-abc123.projectsites.dev'
 *
 * restorePreviewUrl('my-site', 'abc123', 'localhost:8787');
 * // → 'http://my-site-abc123.localhost:8787'
 * ```
 */
export function restorePreviewUrl(slug: string, version: string, baseDomain?: string): string {
  const domain = baseDomain ?? 'projectsites.dev';
  const host = `${slug}-${version}.${domain}`;
  const protocol = domain.startsWith('localhost') || domain.startsWith('127.') ? 'http' : 'https';
  return `${protocol}://${host}`;
}
