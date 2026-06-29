/**
 * @module services/rollback_point
 *
 * Pure rollback-point utility for tracking deploy versions. All exports are
 * deterministic (no I/O): the caller supplies timestamps, this module shapes
 * them into typed RollbackPoint records and provides query helpers.
 *
 * @example
 * ```ts
 * const rp = createRollbackPoint('site_abc', 'v42', 128, 'Deploy fix');
 * // → { id: '…', siteId: 'site_abc', version: 'v42', fileCount: 128, reason: 'Deploy fix', … }
 * ```
 */

// ---------------------------------------------------------------------------
// RollbackPoint — the canonical rollback record shape
// ---------------------------------------------------------------------------

/** A single deploy rollback point with metadata. */
export interface RollbackPoint {
  /** ISO 8601 UTC timestamp when the point was created. */
  createdAt: string;
  /** Number of files in this deploy version. */
  fileCount: number;
  /** Deterministic id — caller provides (UUIDv7 recommended). */
  id: string;
  /** Human-readable reason for creating this rollback point. */
  reason?: string;
  /** The site this rollback point belongs to. */
  siteId: string;
  /** Deploy version string (tag, commit SHA, semver). */
  version: string;
}

// ---------------------------------------------------------------------------
// createRollbackPoint — factory
// ---------------------------------------------------------------------------

/**
 * Builds a fully-typed RollbackPoint record.
 *
 * @param siteId   - The site this rollback point belongs to.
 * @param version  - Deploy version string.
 * @param fileCount - Number of files in this deploy version.
 * @param reason   - Optional human-readable reason for creating this point.
 * @returns A complete RollbackPoint with generated id and timestamp.
 *
 * @example
 * ```ts
 * const rp = createRollbackPoint('site_1', 'abc123', 42);
 * expect(rp.siteId).toBe('site_1');
 * expect(rp.version).toBe('abc123');
 * ```
 */
export function createRollbackPoint(
  siteId: string,
  version: string,
  fileCount: number,
  reason?: string,
): RollbackPoint {
  return {
    createdAt: new Date().toISOString(),
    fileCount,
    id: crypto.randomUUID(),
    reason,
    siteId,
    version,
  };
}

// ---------------------------------------------------------------------------
// rollbackPreview — select a target point from a list
// ---------------------------------------------------------------------------

/**
 * Returns the full list of available rollback points and, when `target` is
 * provided, the matching point whose `version` equals the target string.
 *
 * @param points - All rollback points to search.
 * @param target - The version to select, or null for no selection.
 * @returns An object with `available` (full list copy) and `selected`
 *          (matching point or null).
 *
 * @example
 * ```ts
 * const { available, selected } = rollbackPreview(points, 'v2');
 * expect(available.length).toBe(points.length);
 * expect(selected?.version).toBe('v2');
 * ```
 */
export function rollbackPreview(
  points: readonly RollbackPoint[],
  target: string | null,
): { available: RollbackPoint[]; selected: RollbackPoint | null } {
  const available = [...points];
  const selected = target ? (points.find((p) => p.version === target) ?? null) : null;
  return { available, selected };
}

// ---------------------------------------------------------------------------
// rollbackSummary — aggregate stats over a list of points
// ---------------------------------------------------------------------------

/**
 * Returns aggregate statistics over a list of rollback points: total count,
 * newest point (by createdAt), and oldest point (by createdAt).
 *
 * When the list is empty, both `newest` and `oldest` are null.
 *
 * @param points - Rollback points to summarise.
 * @returns An object with `count`, `newest`, and `oldest`.
 *
 * @example
 * ```ts
 * const { count, newest } = rollbackSummary(points);
 * expect(count).toBe(points.length);
 * expect(newest?.createdAt).toBeDefined();
 * ```
 */
export function rollbackSummary(points: readonly RollbackPoint[]): {
  count: number;
  newest: RollbackPoint | null;
  oldest: RollbackPoint | null;
} {
  if (points.length === 0) return { count: 0, newest: null, oldest: null };

  const sorted = [...points].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return {
    count: points.length,
    newest: sorted[sorted.length - 1],
    oldest: sorted[0],
  };
}
