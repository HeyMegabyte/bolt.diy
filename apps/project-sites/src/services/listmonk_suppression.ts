/**
 * @module services/listmonk_suppression
 * @description Merge + normalize suppression lists across SES, Listmonk, and
 * manual entries. Dedup by email, prefer the most severe reason, produce the
 * canonical set that gets synced to Listmonk's blocklist API.
 *
 * Pure zero-I/O. Never throws.
 */

export type SuppressionSource = 'ses' | 'listmonk' | 'manual' | 'import';

/** complaint(4) > permanent_bounce(3) > transient_bounce(2) > manual(1) */
export type SuppressionSeverity = 1 | 2 | 3 | 4;

export interface SuppressionEntry {
  readonly email: string;
  readonly reason: string; // e.g. 'complaint', 'bounce_permanent', 'manual'
  readonly source: SuppressionSource;
  readonly severity: SuppressionSeverity;
  readonly createdAt: string; // ISO
}

const SEVERITY_MAP: Record<string, SuppressionSeverity> = {
  bounce_permanent: 3,
  bounce_transient: 2,
  complaint: 4,
  permanent: 3,
  transient: 2,
};

/** Rank a reason by severity (higher = more severe). */
export function severityRank(reason: string): SuppressionSeverity {
  const lower = (reason ?? '').toLowerCase().trim();
  return SEVERITY_MAP[lower] ?? 1;
}

/**
 * Normalize an email for dedup: lowercase, strip +alias, trim.
 *
 * @example
 * normalizeEmail('  Alice+spam@Example.COM ') // → 'alice@example.com'
 */
export function normalizeEmail(email: string): string {
  const trimmed = (email ?? '').trim().toLowerCase();
  const plusIdx = trimmed.indexOf('+');
  if (plusIdx === -1) return trimmed;
  const atIdx = trimmed.indexOf('@');
  // Strip +alias only when the + is before the @
  if (plusIdx < atIdx) return trimmed.slice(0, plusIdx) + trimmed.slice(atIdx);
  return trimmed;
}

/**
 * Merge multiple suppression lists, deduping by email (most severe reason
 * wins). Ties broken by most recent `createdAt`.
 *
 * @example
 * const merged = mergeSuppressions([sesList, listmonkList, manualList]);
 */
export function mergeSuppressions(
  lists: readonly (readonly SuppressionEntry[])[],
): readonly SuppressionEntry[] {
  const byEmail = new Map<string, SuppressionEntry>();

  for (const list of lists ?? []) {
    for (const entry of list ?? []) {
      const key = normalizeEmail(entry.email);
      const existing = byEmail.get(key);
      if (!existing) {
        byEmail.set(key, entry);
        continue;
      }
      if (entry.severity > existing.severity) {
        byEmail.set(key, entry);
      } else if (entry.severity === existing.severity && entry.createdAt > existing.createdAt) {
        byEmail.set(key, entry);
      }
    }
  }

  return [...byEmail.values()];
}

/**
 * Convert merged suppressions to Listmonk's blocklist import format (CSV).
 * Only includes entries with severity >= 2 (skips manual-only).
 *
 * @example
 * const csv = toBlocklistFormat(merged);
 * // → 'email,reason\nalice@example.com,complaint\nbob@example.com,bounce_permanent\n'
 */
export function toBlocklistFormat(entries: readonly SuppressionEntry[]): string {
  const rows = (entries ?? []).filter((e) => e.severity >= 2).map((e) => `${e.email},${e.reason}`);

  return ['email,reason', ...rows].join('\n');
}
