/**
 * @module services/usage_reporter
 * @description Per-tenant usage rollup → billing report shapes. Pure functions:
 * no I/O, no fetch, no env. Takes metered counts and returns a structured
 * {@link UsageReport} + Stripe-ready meter-event payloads. Never throws.
 *
 * @packageDocumentation
 */

/** Metered dimensions available for billing. */
export type UsageMetric = 'sites' | 'builds' | 'ai_calls' | 'emails' | 'storage_gb';

/** Per-tenant usage report covering a billing period. */
export interface UsageReport {
  /** Unique tenant (org) identifier. */
  readonly tenantId: string;
  /** ISO-8601 bounded billing window. */
  readonly period: { readonly start: string; readonly end: string };
  /** Raw metric quantities keyed by dimension. Missing keys default to 0. */
  readonly metrics: Record<UsageMetric, number>;
  /** Computed cost in cents (US¢), derived from {@link METRIC_PRICING}. */
  readonly totalCostCents: number;
}

/**
 * Per-unit pricing in US cents.
 *
 * | Metric      | Unit     | Cents/unit | Example          |
 * |-------------|----------|-----------|------------------|
 * | `sites`     | site     | 50¢       | $0.50 / site     |
 * | `builds`    | build    | 10¢       | $0.10 / build    |
 * | `ai_calls`  | call     | 0.5¢      | $0.005 / call    |
 * | `emails`    | email    | 0.1¢      | $0.001 / email   |
 * | `storage_gb`| GB-month | 20¢       | $0.20 / GB-month |
 */
export const METRIC_PRICING: Record<UsageMetric, number> = Object.freeze({
  ai_calls: 0.5,
  builds: 10,
  emails: 0.1,
  sites: 50,
  storage_gb: 20,
});

/** All recognised metric keys in priority order. */
const ALL_METRICS: readonly UsageMetric[] = ['sites', 'builds', 'ai_calls', 'emails', 'storage_gb'];

/** Coerce a raw number to a non-negative integer. */
function cleanValue(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/**
 * Build a {@link UsageReport} from raw metric observations for a tenant /
 * billing period. Computes {@link UsageReport.totalCostCents} from
 * {@link METRIC_PRICING}.
 *
 * @param tenantId - Unique tenant/org identifier.
 * @param period  - ISO-8601 billing window (`{start, end}`).
 * @param metrics - Observed metric quantities; any subset of
 *   {@link UsageMetric} keys is accepted (missing = 0).
 * @returns A frozen report with a computed total.
 *
 * @example
 * buildUsageReport('org_abc', {
 *   start: '2026-06-01T00:00:00Z',
 *   end: '2026-07-01T00:00:00Z',
 * }, { sites: 3, ai_calls: 1500, emails: 200 })
 * // → {
 * //   tenantId: 'org_abc',
 * //   period: { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' },
 * //   metrics: { sites: 3, builds: 0, ai_calls: 1500, emails: 200, storage_gb: 0 },
 * //   totalCostCents: 150 + 0 + 750 + 20 + 0 = 920,
 * // }
 */
export function buildUsageReport(
  tenantId: string,
  period: { start: string; end: string },
  metrics: Partial<Record<UsageMetric, unknown>>,
): UsageReport {
  const cleaned: Record<UsageMetric, number> = {
    ai_calls: 0,
    builds: 0,
    emails: 0,
    sites: 0,
    storage_gb: 0,
  };
  let totalCostCents = 0;

  for (const metric of ALL_METRICS) {
    const raw = metrics[metric];
    const qty = cleanValue(raw);
    cleaned[metric] = qty;
    totalCostCents += qty * METRIC_PRICING[metric];
  }

  return {
    metrics: cleaned,
    period: { end: period.end, start: period.start },
    tenantId,
    totalCostCents: Math.round(totalCostCents * 100) / 100,
  };
}

/**
 * Convert a {@link UsageReport} into Stripe meter-event payloads (one per
 * non-zero metric). Each event names the metric as
 * `usage.{metric}` so Stripe invoice-item line items can differ by dimension.
 *
 * Stripe expects one event per metric per period; the consumer sends them
 * via `POST /v1/billing/meter_events`.
 *
 * @param report - A completed usage report.
 * @returns An array of strike-event objects, empty when every metric is zero.
 *
 * @example
 * stripeMeterEvent(buildUsageReport('org_abc', …, { ai_calls: 500 }))
 * // →
 * // [{
 * //   name: 'usage.ai_calls',
 * //   payload: { tenant_id: 'org_abc', metric: 'ai_calls', quantity: 500, cost_cents: 250 },
 * // }]
 */
export function stripeMeterEvent(
  report: UsageReport,
): { name: string; payload: Record<string, unknown> }[] {
  const events: { name: string; payload: Record<string, unknown> }[] = [];

  for (const metric of ALL_METRICS) {
    const qty = report.metrics[metric];
    if (qty <= 0) continue;

    events.push({
      name: `usage.${metric}`,
      payload: {
        cost_cents: qty * METRIC_PRICING[metric],
        metric,
        quantity: qty,
        tenant_id: report.tenantId,
      },
    });
  }

  return events;
}
