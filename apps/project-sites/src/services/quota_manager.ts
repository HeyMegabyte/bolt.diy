/**
 * @module services/quota_manager
 * @description Pure per-tenant quota tracking. Checks whether a usage quota is
 * exceeded, computes usage percentage, and summarizes across all quota types.
 * Zero-I/O, deterministic, never throws.
 * @packageDocumentation
 */

/** The five quota dimensions tracked per tenant. */
export type QuotaType = 'sites' | 'builds' | 'ai_calls' | 'emails' | 'storage_mb';

/** A single quota dimension with its limit and current usage. */
export interface Quota {
  readonly type: QuotaType;
  readonly limit: number;
  readonly used: number;
}

/** Result of checking a single quota. */
export interface QuotaCheck {
  readonly exceeded: boolean;
  readonly remaining: number;
  readonly pctUsed: number;
}

/** Summary across all quota dimensions for a tenant. */
export interface QuotaSummary {
  readonly total: number;
  readonly exceeded: number;
  readonly worst: { readonly pctUsed: number; readonly type: QuotaType } | null;
}

/**
 * Default free-tier quotas. Every tenant starts here.
 * sites:1, builds:5, ai_calls:10, emails:100, storage_mb:10
 */
export const FREE_QUOTAS: readonly Quota[] = Object.freeze([
  { limit: 1, type: 'sites', used: 0 },
  { limit: 5, type: 'builds', used: 0 },
  { limit: 10, type: 'ai_calls', used: 0 },
  { limit: 100, type: 'emails', used: 0 },
  { limit: 10, type: 'storage_mb', used: 0 },
]);

/**
 * Check a single quota dimension. Returns whether usage exceeds the limit,
 * how many units remain, and the percentage consumed.
 *
 * @param quota - The quota dimension to check.
 * @returns {@link QuotaCheck} with exceeded flag, remaining count, and percentage used.
 *
 * @example
 * checkQuota({ type: 'builds', limit: 5, used: 3 });
 * // => { exceeded: false, remaining: 2, pctUsed: 60 }
 */
export function checkQuota(quota: Quota): QuotaCheck {
  const limit = Number.isFinite(quota.limit) && quota.limit >= 0 ? Math.round(quota.limit) : 0;
  const used = Number.isFinite(quota.used) && quota.used >= 0 ? Math.round(quota.used) : 0;

  const exceeded = limit > 0 ? used >= limit : false;
  const remaining = limit > 0 ? Math.max(0, limit - used) : 0;
  const pctUsed = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return { exceeded, pctUsed, remaining };
}

/**
 * Summarize multiple quota dimensions into a single report. Counts how many
 * quotas are exceeded and identifies the worst-capped dimension.
 *
 * @param quotas - All quota dimensions for the tenant.
 * @returns {@link QuotaSummary} with total/exceeded counts and worst dimension.
 *
 * @example
 * quotaSummary([
 *   { type: 'builds', limit: 5, used: 6 },
 *   { type: 'sites', limit: 1, used: 0 },
 * ]);
 * // => { total: 5, exceeded: 1, worst: { type: 'builds', pctUsed: 100 } }
 */
export function quotaSummary(quotas: readonly Quota[]): QuotaSummary {
  const qs = Array.isArray(quotas) ? quotas : [];

  let total = 0;
  let exceeded = 0;
  let worst: { pctUsed: number; type: QuotaType } | null = null;

  for (const q of qs) {
    if (
      !q ||
      typeof q.type !== 'string' ||
      typeof q.limit !== 'number' ||
      typeof q.used !== 'number'
    )
      continue;
    total++;
    const check = checkQuota(q);
    if (check.exceeded) exceeded++;
    if (check.pctUsed > 0 && (worst === null || check.pctUsed > worst.pctUsed)) {
      worst = { pctUsed: check.pctUsed, type: q.type };
    }
  }

  return { exceeded, total, worst };
}
