/**
 * @module services/secret_rotation
 * @description AP9 — secret-rotation calendar. Load-bearing vendor secrets must
 * rotate on a ≤90-day cadence (per the vendor-risk-tiering doctrine). Pure +
 * zero-I/O: the caller supplies each secret's last-rotated timestamp (from a D1
 * registry) + the current time (no `Date.now()` inside → deterministic), and
 * this layer classifies due/overdue/ok + sorts the calendar. The actual rotation
 * is the caller's automation. Never throws.
 *
 * @packageDocumentation
 */

/** Default rotation cadence for load-bearing vendor secrets (days). */
export const DEFAULT_MAX_AGE_DAYS = 90;
/** "Due soon" lead window before the deadline (days). */
export const DUE_SOON_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One tracked secret + when it was last rotated. */
export interface SecretRecord {
  /** Secret name, e.g. `STRIPE_SECRET_KEY`. */
  readonly name: string;
  /** Owning vendor/service, e.g. `stripe`. */
  readonly vendor?: string;
  /** Last rotation instant (Unix ms or ISO string); null = never rotated. */
  readonly lastRotatedAt: number | string | null;
  /** Per-secret override of the max age in days. */
  readonly maxAgeDays?: number;
}

/** Rotation health of one secret. */
export type RotationStatus = 'ok' | 'due_soon' | 'overdue' | 'unknown';

export interface SecretRotationEntry {
  readonly name: string;
  readonly vendor: string | null;
  readonly status: RotationStatus;
  /** Whole days since last rotation (null when never/unknown). */
  readonly ageDays: number | null;
  /** Whole days until the rotation deadline (negative = overdue; null unknown). */
  readonly daysUntilDue: number | null;
  /** Deadline instant in Unix ms (null when unknown). */
  readonly dueAtMs: number | null;
}

export interface RotationReport {
  readonly entries: readonly SecretRotationEntry[];
  readonly overdue: number;
  readonly dueSoon: number;
  readonly unknown: number;
  /** True when any secret is overdue or never-rotated → needs attention. */
  readonly needsAttention: boolean;
}

/** Coerce a timestamp to finite ms, else null. */
function toMs(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Date.parse(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Classify one secret's rotation status.
 *
 * @param record - {@link SecretRecord}.
 * @param nowMs - Current instant (Unix ms or ISO string).
 * @param maxAgeDays - Default cadence; per-record `maxAgeDays` wins.
 * @returns {@link SecretRotationEntry}.
 *
 * @example
 * rotationStatus({ name: 'STRIPE_SECRET_KEY', lastRotatedAt: t }, now)
 * // → { status: 'ok', ageDays: 12, daysUntilDue: 78, ... }
 */
export function rotationStatus(
  record: SecretRecord,
  nowMs: number | string,
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): SecretRotationEntry {
  const now = toMs(nowMs);
  const last = toMs(record.lastRotatedAt);
  const vendor = record.vendor?.trim() || null;
  const maxAge =
    typeof record.maxAgeDays === 'number' && record.maxAgeDays > 0
      ? record.maxAgeDays
      : maxAgeDays > 0
        ? maxAgeDays
        : DEFAULT_MAX_AGE_DAYS;

  if (now === null || last === null) {
    return { name: record.name, vendor, status: 'unknown', ageDays: null, daysUntilDue: null, dueAtMs: null };
  }

  const ageDays = Math.floor((now - last) / DAY_MS);
  const dueAtMs = last + maxAge * DAY_MS;
  const daysUntilDue = Math.ceil((dueAtMs - now) / DAY_MS);

  let status: RotationStatus;
  if (daysUntilDue < 0) status = 'overdue';
  else if (daysUntilDue <= DUE_SOON_DAYS) status = 'due_soon';
  else status = 'ok';

  return { name: record.name, vendor, status, ageDays, daysUntilDue, dueAtMs };
}

/** Sort key: overdue first, then due_soon, then unknown, then ok; by deadline. */
const STATUS_ORDER: Readonly<Record<RotationStatus, number>> = {
  overdue: 0,
  due_soon: 1,
  unknown: 2,
  ok: 3,
};

/**
 * Build the full rotation calendar from a set of secret records, sorted most-
 * urgent first.
 *
 * @param records - The tracked secrets.
 * @param nowMs - Current instant (Unix ms or ISO string).
 * @param maxAgeDays - Default cadence; per-record override wins.
 * @returns {@link RotationReport}.
 *
 * @example
 * buildRotationReport(records, Date.now()).needsAttention
 */
export function buildRotationReport(
  records: readonly SecretRecord[],
  nowMs: number | string,
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): RotationReport {
  const entries = (Array.isArray(records) ? records : [])
    .map((r) => rotationStatus(r, nowMs, maxAgeDays))
    .sort((a, b) => {
      const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (s !== 0) return s;
      return (a.daysUntilDue ?? Infinity) - (b.daysUntilDue ?? Infinity);
    });

  const overdue = entries.filter((e) => e.status === 'overdue').length;
  const dueSoon = entries.filter((e) => e.status === 'due_soon').length;
  const unknown = entries.filter((e) => e.status === 'unknown').length;

  return {
    entries,
    overdue,
    dueSoon,
    unknown,
    needsAttention: overdue > 0 || unknown > 0,
  };
}
