/**
 * Billing metering — pure zero-I/O service module.
 *
 * Aggregates per-app usage counters into billing meter summaries,
 * applies per-metric pricing, and filters billable lines.
 *
 * @remarks Zero-I/O: pure functions only. No imports from services/db/worker.
 */

// ─── Interfaces ───────────────────────────────────────────────────────

export interface UsageCounter {
  readonly app: string;
  readonly metric: string;
  readonly count: number;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
}

export interface MeteredLine {
  readonly app: string;
  readonly metric: string;
  readonly count: number;
  readonly estimatedCents: number;
  readonly meterEventName: string;
  readonly stripePayload: Record<string, unknown>;
}

export interface BillingMeter {
  readonly lines: readonly MeteredLine[];
  readonly totalCents: number;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
}

// ─── Pricing ──────────────────────────────────────────────────────────

/** Known per-metric unit pricing in cents (0 = free tier). */
const METRIC_PRICING: Record<string, number> = {
  sites: 0,
  builds: 5,
  ai_calls: 1,
  emails: 0.05,
  contacts: 0,
  projects: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────

/** Clamp a value to ≥ 0. */
function clampToZero(n: number): number {
  return n < 0 ? 0 : n;
}

/** Build a stripe meter event name for the given app and metric. */
function buildMeterEventName(app: string, metric: string): string {
  return `${app}_${metric}`;
}

/** Build the stripe payload object for a metered line. */
function buildStripePayload(
  app: string,
  metric: string,
  count: number,
  periodEndMs: number,
): Record<string, unknown> {
  return { app, metric, count, timestamp_ms: periodEndMs };
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Aggregate per-app usage counters into a billing meter summary.
 *
 * Merges counters matching the same app+metric by summing counts.
 * Applies METRIC_PRICING per metric to compute estimatedCents.
 * If a counter has an unknown metric, estimatedCents = 0.
 * Negative counts are clamped to 0.
 *
 * @param counters - Usage counter entries to aggregate.
 * @returns A billing meter with aggregated lines, total cost, and period bounds.
 */
export function aggregateMeter(counters: readonly UsageCounter[]): BillingMeter {
  if (counters.length === 0) {
    return {
      lines: [],
      totalCents: 0,
      periodStartMs: 0,
      periodEndMs: 0,
    };
  }

  // Period bounds from the first counter (assume all share the same period).
  const periodStartMs = counters[0].periodStartMs;
  const periodEndMs = counters[0].periodEndMs;

  // Aggregate: merge matching app+metric by summing counts.
  const merged = new Map<string, { count: number; app: string; metric: string }>();
  for (const c of counters) {
    const key = `${c.app}::${c.metric}`;
    const existing = merged.get(key);
    const clamped = clampToZero(c.count);
    if (existing) {
      existing.count += clamped;
    } else {
      merged.set(key, { count: clamped, app: c.app, metric: c.metric });
    }
  }

  // Build metered lines.
  const lines: MeteredLine[] = [];
  for (const { app, metric, count } of merged.values()) {
    const pricePerUnit = METRIC_PRICING[metric] ?? 0;
    const estimatedCents = count * pricePerUnit;
    lines.push({
      app,
      metric,
      count,
      estimatedCents,
      meterEventName: buildMeterEventName(app, metric),
      stripePayload: buildStripePayload(app, metric, count, periodEndMs),
    });
  }

  const totalCents = lines.reduce((sum, l) => sum + l.estimatedCents, 0);

  return { lines, totalCents, periodStartMs, periodEndMs };
}

/**
 * Filter out zero-count lines (nothing to bill).
 *
 * @param lines - Metered lines to filter.
 * @returns Lines with count > 0 only.
 */
export function billableOnly(lines: readonly MeteredLine[]): readonly MeteredLine[] {
  return lines.filter((l) => l.count > 0);
}
