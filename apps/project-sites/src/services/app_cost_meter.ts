/**
 * @module services/app_cost_meter
 * @description A2 — metered monthly-cost ESTIMATE per app instance.
 *
 * Replaces the static `estCostMonthly` catalog value with an estimate derived from
 * the instance's ACTUAL state: its running/hibernated status (compute) + which aux
 * infra it actually provisioned (Neon / Upstash / R2). This is an honest *estimate*,
 * NOT exact vendor-billing-API spend (that exact-spend reconciliation is a separate
 * [operator]-key follow-on). Pure function — no I/O, fully unit-testable.
 *
 * @packageDocumentation
 */

/** The subset of an `app_instances` row this estimate reads. */
export interface CostMeterInstance {
  readonly status: string;
  readonly neon_project_id: string | null;
  readonly upstash_database_id: string | null;
  readonly r2_bucket_name: string | null;
}

/** Per-line monthly USD estimate + the rolled-up total. */
export interface InstanceCostEstimate {
  /** Total estimated monthly USD. */
  readonly monthlyUsd: number;
  readonly breakdown: {
    readonly compute: number;
    readonly neon: number;
    readonly upstash: number;
    readonly r2: number;
  };
  /** Always `'estimate'` — this is NOT reconciled vendor billing. */
  readonly basis: 'estimate';
  /** Whether the compute line reflects a running (vs hibernated) container. */
  readonly running: boolean;
}

// ── Rate model (rough monthly USD; named so they're trivially tunable) ─────────
/** CF Container compute for a ~0.5 GB app running 24/7 (rough). */
const COMPUTE_RUNNING_USD = 2.5;
/** Idle-hibernated DOs bill ~minimally — a small floor instead of zero. */
const COMPUTE_HIBERNATED_USD = 0.25;
/** Neon Postgres project (Launch-tier-ish) when one is provisioned. */
const NEON_BASE_USD = 5;
/** Upstash Redis pay-as-you-go base when one is provisioned. */
const UPSTASH_BASE_USD = 3;
/** R2 bucket storage + modest egress when one is provisioned. */
const R2_BASE_USD = 2;

/** Round to whole cents to avoid floating-point noise in the response. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Estimate an app instance's monthly cost from its actual state.
 *
 * @param instance - The instance's status + which aux infra it provisioned.
 * @returns A typed per-line estimate + total (always `basis: 'estimate'`).
 * @example
 * estimateInstanceCost({ status: 'running', neon_project_id: 'np1', upstash_database_id: null, r2_bucket_name: null })
 * // → { monthlyUsd: 7.5, breakdown: { compute: 2.5, neon: 5, upstash: 0, r2: 0 }, basis: 'estimate', running: true }
 */
export function estimateInstanceCost(instance: CostMeterInstance): InstanceCostEstimate {
  const running = instance.status === 'running';
  const compute = running ? COMPUTE_RUNNING_USD : COMPUTE_HIBERNATED_USD;
  const neon = instance.neon_project_id ? NEON_BASE_USD : 0;
  const upstash = instance.upstash_database_id ? UPSTASH_BASE_USD : 0;
  const r2 = instance.r2_bucket_name ? R2_BASE_USD : 0;
  return {
    monthlyUsd: cents(compute + neon + upstash + r2),
    breakdown: { compute: cents(compute), neon, upstash, r2 },
    basis: 'estimate',
    running,
  };
}
