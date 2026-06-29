/**
 * @module services/listmonk_segments
 * @description LM10 — D1 → Listmonk lifecycle cohorts. Classify each subscriber
 * into a lifecycle stage (new / trial / active / dormant / churned) so targeted
 * campaigns sync to the right Listmonk segment. Pure + zero-I/O: the caller
 * resolves subscriber rows from D1 + the current time (no `Date.now()` inside →
 * deterministic), and pushes the bucketed ids to Listmonk. This layer is the
 * deterministic classification + bucketing brain. Never throws.
 *
 * @packageDocumentation
 */

/** Lifecycle stage a subscriber falls into. */
export type LifecycleCohort = 'new' | 'trial' | 'active' | 'dormant' | 'churned';

/** All cohorts, stable order (used to seed empty buckets). */
export const LIFECYCLE_COHORTS: readonly LifecycleCohort[] = [
  'new',
  'trial',
  'active',
  'dormant',
  'churned',
];

/** Signals needed to place a subscriber on the lifecycle. */
export interface SubscriberSignals {
  readonly id: string;
  /** Account creation instant (Unix ms or ISO string). */
  readonly createdAtMs: number | string;
  /** Last activity instant; falls back to createdAt when absent. */
  readonly lastActiveAtMs?: number | string | null;
  /** Plan tier, e.g. `free` / `trial` / `pro`. */
  readonly plan?: string;
  /** Billing status, e.g. `active` / `trialing` / `canceled` / `past_due`. */
  readonly subscriptionStatus?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A subscriber is "new" within this many days of signup. */
export const NEW_WINDOW_DAYS = 7;
/** Active if seen within this window. */
export const ACTIVE_WINDOW_DAYS = 30;
/** Dormant (not yet churned) up to this window. */
export const DORMANT_WINDOW_DAYS = 90;

const CHURN_STATUSES: ReadonlySet<string> = new Set([
  'canceled',
  'cancelled',
  'past_due',
  'unpaid',
]);
const TRIAL_STATUSES: ReadonlySet<string> = new Set(['trialing', 'trial']);

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
 * Classify one subscriber into a {@link LifecycleCohort}.
 *
 * Precedence: explicit churn (canceled/past_due) → new (≤7d) → trial
 * (trialing status or trial plan) → active (seen ≤30d) → dormant (≤90d) →
 * churned (inactive >90d).
 *
 * @param sub - {@link SubscriberSignals}.
 * @param nowMs - Current instant (Unix ms or ISO string).
 * @returns The lifecycle cohort.
 *
 * @example
 * classifyCohort({ id:'u1', createdAtMs: t, subscriptionStatus:'canceled' }, now) // → 'churned'
 */
export function classifyCohort(sub: SubscriberSignals, nowMs: number | string): LifecycleCohort {
  const now = toMs(nowMs) ?? 0;
  const created = toMs(sub.createdAtMs);
  const lastActive = toMs(sub.lastActiveAtMs) ?? created;
  const status = (sub.subscriptionStatus ?? '').toLowerCase().trim();
  const plan = (sub.plan ?? '').toLowerCase().trim();

  if (CHURN_STATUSES.has(status)) return 'churned';

  const ageDays = created !== null ? (now - created) / DAY_MS : Infinity;
  if (ageDays <= NEW_WINDOW_DAYS && ageDays >= 0) return 'new';

  if (TRIAL_STATUSES.has(status) || plan === 'trial') return 'trial';

  const idleDays = lastActive !== null ? (now - lastActive) / DAY_MS : Infinity;
  if (idleDays <= ACTIVE_WINDOW_DAYS) return 'active';
  if (idleDays <= DORMANT_WINDOW_DAYS) return 'dormant';
  return 'churned';
}

/** Bucketed subscriber ids per cohort + per-cohort counts. */
export interface CohortBuckets {
  readonly byCohort: Readonly<Record<LifecycleCohort, readonly string[]>>;
  readonly counts: Readonly<Record<LifecycleCohort, number>>;
  readonly total: number;
}

/**
 * Bucket a set of subscribers by lifecycle cohort. Every cohort key is present
 * (empty array when none) so a downstream Listmonk sync can clear emptied
 * segments.
 *
 * @param subs - Subscriber rows.
 * @param nowMs - Current instant.
 * @returns {@link CohortBuckets}.
 *
 * @example
 * bucketByCohort(rows, Date.now()).counts.churned
 */
export function bucketByCohort(
  subs: readonly SubscriberSignals[],
  nowMs: number | string,
): CohortBuckets {
  const byCohort: Record<LifecycleCohort, string[]> = {
    new: [],
    trial: [],
    active: [],
    dormant: [],
    churned: [],
  };
  for (const s of Array.isArray(subs) ? subs : []) {
    if (!s || typeof s.id !== 'string' || !s.id) continue;
    byCohort[classifyCohort(s, nowMs)].push(s.id);
  }
  const counts: Record<LifecycleCohort, number> = {
    new: byCohort.new.length,
    trial: byCohort.trial.length,
    active: byCohort.active.length,
    dormant: byCohort.dormant.length,
    churned: byCohort.churned.length,
  };
  const total = LIFECYCLE_COHORTS.reduce((sum, c) => sum + counts[c], 0);
  return { byCohort, counts, total };
}
