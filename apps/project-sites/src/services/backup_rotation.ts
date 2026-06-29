/**
 * @module services/backup_rotation
 * @description Pure zero-I/O backup rotation calculator. Given a list of
 * existing backups and a retention policy, decides which to keep and which
 * to delete. Never throws — all invalid inputs degrade gracefully.
 *
 * @packageDocumentation
 */

/** A backup record as returned by the backing store (e.g. D1 or R2). */
export interface Backup {
  readonly id: string;
  readonly type: 'full' | 'incremental';
  readonly createdAt: string;
  readonly sizeBytes: number;
}

/**
 * Retention policy for a single store.
 *
 * - `keepFull` — max number of full backups to retain (most recent win).
 * - `keepIncremental` — max number of incremental backups to retain.
 * - `maxAgeDays` — discard any backup older than this many days regardless of count.
 */
export interface RotationPolicy {
  readonly keepFull: number;
  readonly keepIncremental: number;
  readonly maxAgeDays: number;
}

/** The result of applying a rotation policy. */
export interface RotationResult {
  /** Backups that should be kept (ordered newest-first). */
  readonly keep: readonly Backup[];
  /** Backups that should be deleted. */
  readonly delete: readonly Backup[];
}

/**
 * Default rotation policies for each data store.
 *
 * - **D1**: retain 7 full + 14 incremental, max 30 days
 * - **R2**: retain 30 full, 0 incremental (object versioning), max 90 days
 * - **Neon**: retain 14 full + 7 incremental, max 45 days
 */
export const DEFAULT_POLICIES: Readonly<Record<string, RotationPolicy>> = Object.freeze({
  d1: Object.freeze<RotationPolicy>({ keepFull: 7, keepIncremental: 14, maxAgeDays: 30 }),
  neon: Object.freeze<RotationPolicy>({ keepFull: 14, keepIncremental: 7, maxAgeDays: 45 }),
  r2: Object.freeze<RotationPolicy>({ keepFull: 30, keepIncremental: 0, maxAgeDays: 90 }),
});

/**
 * Apply a rotation policy to a set of backups, returning the subsets to keep
 * and delete. Backups beyond the age cap are always deleted; remaining backups
 * are count-capped per type (newest wins). Pure + deterministic.
 *
 * @param backups - The current set of backup records (unsorted).
 * @param policy - The {@link RotationPolicy} to apply.
 * @param nowMs - Current epoch ms for the age check (inject for determinism;
 *   defaults to `Date.now()`).
 * @returns The keep and delete subsets.
 *
 * @example
 * const backups = [
 *   { id: 'b1', type: 'full', createdAt: '2026-06-28T00:00:00.000Z', sizeBytes: 1_000_000 },
 *   { id: 'b2', type: 'full', createdAt: '2026-06-27T00:00:00.000Z', sizeBytes: 900_000 },
 * ];
 * applyRotation(backups, DEFAULT_POLICIES.d1, 1_756_800_000_000);
 */
export function applyRotation(
  backups: readonly Backup[],
  policy: RotationPolicy,
  nowMs?: number,
): RotationResult {
  const now = nowMs ?? Date.now();
  const maxAgeMs = policy.maxAgeDays * 86_400_000;

  // Separate by type, newest first.
  const sorted = [...backups].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const full = sorted.filter((b) => b.type === 'full');
  const incremental = sorted.filter((b) => b.type === 'incremental');

  const keep: Backup[] = [];
  const delete_: Backup[] = [];

  function classify(batch: Backup[], limit: number): void {
    let kept = 0;
    for (const b of batch) {
      const age = now - new Date(b.createdAt).getTime();
      if (age > maxAgeMs || isNaN(age)) {
        delete_.push(b);
      } else if (kept < limit) {
        keep.push(b);
        kept++;
      } else {
        delete_.push(b);
      }
    }
  }

  classify(full, policy.keepFull);
  classify(incremental, policy.keepIncremental);

  // Restore newest-first order.
  keep.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { delete: delete_, keep };
}

/**
 * Generate a one-line human-readable summary of a rotation result.
 *
 * @param result - The {@link RotationResult} from an {@link applyRotation} call.
 * @returns A short description of what was kept and deleted.
 *
 * @example
 * rotationSummary({ keep: [b1], delete: [b2] });
 * // → 'Kept 1, deleted 1 backup(s).'
 */
export function rotationSummary(result: RotationResult): string {
  const kept = result.keep.length;
  const deleted = result.delete.length;
  if (kept === 0 && deleted === 0) return 'No backups to rotate.';
  return `Kept ${kept}, deleted ${deleted} backup(s).`;
}
