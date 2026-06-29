/**
 * @module services/backup_policy
 * @description Pure zero-I/O backup policy calculator. Computes retention expiry,
 * next-due dates, and human-readable schedule summaries for D1, R2, and Neon
 * backup policies. Never throws — all invalid inputs degrade gracefully.
 *
 * @packageDocumentation
 */

/** The type of backup operation. */
export type BackupType = 'full' | 'incremental' | 'snapshot';

/** Unit of time for frequency or retention windows. */
export type RetentionUnit = 'hours' | 'days' | 'weeks' | 'months';

/** One backup rule within a policy. Immutable. */
export interface BackupRule {
  readonly type: BackupType;
  /** How often the backup runs (e.g. 6 = every 6 hours). */
  readonly frequency: number;
  readonly frequencyUnit: RetentionUnit;
  /** How long to keep the backup (e.g. 7 = keep for 7 days). */
  readonly retention: number;
  readonly retentionUnit: RetentionUnit;
  readonly description: string;
}

/** A named collection of backup rules. Immutable. */
export interface BackupPolicy {
  readonly name: string;
  readonly rules: readonly BackupRule[];
}

/** The result of a retention expiry check. */
export interface RetentionCheck {
  /** ISO date the backup was taken. */
  readonly backupDate: string;
  /** ISO date when this backup expires. */
  readonly retentionDate: string;
  /** True when the backup is past its retention window. */
  readonly expired: boolean;
}

const UNIT_MS: Record<RetentionUnit, number> = {
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
  months: 2_592_000_000, // 30-day approximation
};

function msFor(value: number, unit: RetentionUnit): number {
  return Math.abs(value) * UNIT_MS[unit];
}

/**
 * Default backup policies for each data store.
 *
 * - **D1**: full-daily (7d) + incremental-6h (2d) + snapshot-1h (1d)
 * - **R2**: full-daily (30d) — versioned, minimal retention
 * - **Neon**: full-daily (14d) + snapshot-2h (1d)
 */
export const DEFAULT_POLICIES: Readonly<Record<string, BackupPolicy>> = Object.freeze({
  D1: Object.freeze({
    name: 'D1',
    rules: Object.freeze([
      Object.freeze<BackupRule>({
        type: 'full',
        frequency: 1,
        frequencyUnit: 'days',
        retention: 7,
        retentionUnit: 'days',
        description: 'Full backup every day, kept 7 days',
      }),
      Object.freeze<BackupRule>({
        type: 'incremental',
        frequency: 6,
        frequencyUnit: 'hours',
        retention: 2,
        retentionUnit: 'days',
        description: 'Incremental backup every 6 hours, kept 2 days',
      }),
      Object.freeze<BackupRule>({
        type: 'snapshot',
        frequency: 1,
        frequencyUnit: 'hours',
        retention: 1,
        retentionUnit: 'days',
        description: 'Snapshot every hour, kept 1 day',
      }),
    ]),
  }),
  R2: Object.freeze({
    name: 'R2',
    rules: Object.freeze([
      Object.freeze<BackupRule>({
        type: 'full',
        frequency: 1,
        frequencyUnit: 'days',
        retention: 30,
        retentionUnit: 'days',
        description: 'Full backup every day, kept 30 days',
      }),
    ]),
  }),
  Neon: Object.freeze({
    name: 'Neon',
    rules: Object.freeze([
      Object.freeze<BackupRule>({
        type: 'full',
        frequency: 1,
        frequencyUnit: 'days',
        retention: 14,
        retentionUnit: 'days',
        description: 'Full backup every day, kept 14 days',
      }),
      Object.freeze<BackupRule>({
        type: 'snapshot',
        frequency: 2,
        frequencyUnit: 'hours',
        retention: 1,
        retentionUnit: 'days',
        description: 'Snapshot every 2 hours, kept 1 day',
      }),
    ]),
  }),
});

/**
 * Check whether a backup has expired based on its rule's retention window.
 * Pure + deterministic; never throws. An unparseable backup date is treated as
 * expired.
 *
 * @param backupDate - ISO string of when the backup was taken.
 * @param rule - The {@link BackupRule} governing this backup's retention.
 * @param nowMs - Current epoch ms (inject for determinism; defaults to Date.now()).
 * @returns The {@link RetentionCheck} assessment.
 *
 * @example
 * isExpired('2026-06-22T00:00:00.000Z', rule, 1_756_800_000_000);
 * // → { backupDate: '2026-06-22T00:00:00.000Z', retentionDate: '2026-06-29T00:00:00.000Z', expired: false }
 */
export function isExpired(backupDate: string, rule: BackupRule, nowMs?: number): RetentionCheck {
  const now = nowMs ?? Date.now();
  const backupMs = new Date(backupDate).getTime();

  if (isNaN(backupMs)) {
    return { backupDate, retentionDate: backupDate, expired: true };
  }

  const retentionMs = msFor(rule.retention, rule.retentionUnit);
  const retentionDateMs = backupMs + retentionMs;
  const retentionDate = new Date(retentionDateMs).toISOString();

  return { backupDate, retentionDate, expired: now >= retentionDateMs };
}

/**
 * Compute the next backup due date from a rule and optional last-backup time.
 * When the next due date is in the past (overdue) or lastBackup is null,
 * returns the current time. Pure + deterministic; never throws.
 *
 * @param lastBackup - ISO string of the last backup, or null if never backed up.
 * @param rule - The {@link BackupRule} defining the backup frequency.
 * @param nowMs - Current epoch ms (inject for determinism; defaults to Date.now()).
 * @returns ISO string of the next due date.
 *
 * @example
 * nextBackupDue(null, rule, 1_756_800_000_000);
 * // → '2026-08-23T00:00:00.000Z'  (immediately due)
 */
export function nextBackupDue(lastBackup: string | null, rule: BackupRule, nowMs?: number): string {
  const now = nowMs ?? Date.now();

  if (lastBackup === null) {
    return new Date(now).toISOString();
  }

  const lastMs = new Date(lastBackup).getTime();
  if (isNaN(lastMs)) {
    return new Date(now).toISOString();
  }

  const frequencyMs = msFor(rule.frequency, rule.frequencyUnit);
  const nextMs = lastMs + frequencyMs;

  if (nextMs <= now) {
    return new Date(now).toISOString();
  }

  return new Date(nextMs).toISOString();
}

/**
 * Generate a human-readable backup schedule summary for a policy.
 *
 * @param policy - The {@link BackupPolicy} to summarise.
 * @returns A multi-line string describing each rule.
 *
 * @example
 * scheduleSummary(DEFAULT_POLICIES.D1);
 * // → 'D1 backup policy:\n- Full backup every day, kept 7 days\n...'
 */
export function scheduleSummary(policy: BackupPolicy): string {
  const lines = policy.rules.map((r) => `- ${r.description}`);
  return `${policy.name} backup policy:\n${lines.join('\n')}`;
}
