/**
 * @module services/fleet_benchmark
 * @description AN50 — benchmark an owner's metric against the fleet (category)
 * distribution: "your contact form converts at 1.2% vs a 3.4% category median —
 * bottom quartile". Pure + zero-I/O: the caller aggregates the fleet stats
 * (median + quartiles + sample size) from the analytics rollup and renders the
 * returned verdict; this layer is the deterministic comparison + phrasing brain,
 * so it unit-tests with no DB. Never throws.
 *
 * @packageDocumentation
 */

/** Fleet distribution for one metric within a category cohort. */
export interface FleetStats {
  /** Median (p50) value across the cohort. */
  readonly median: number;
  /** 25th percentile, if known. */
  readonly p25?: number;
  /** 75th percentile, if known. */
  readonly p75?: number;
  /** Number of sites in the cohort (drives confidence). */
  readonly sampleSize: number;
}

/** Where the owner's value sits relative to the fleet. */
export type BenchmarkVerdict = 'above' | 'at' | 'below';

/** Quartile band an owner's value falls into (when p25/p75 are known). */
export type QuartileBand = 'top' | 'upper-middle' | 'lower-middle' | 'bottom' | null;

export interface BenchmarkResult {
  /** Owner value − median. */
  readonly delta: number;
  /** Owner value ÷ median (1 = at median); null when median is 0. */
  readonly ratio: number | null;
  readonly verdict: BenchmarkVerdict;
  readonly band: QuartileBand;
  /** True when sampleSize is too small to trust (<20). */
  readonly lowConfidence: boolean;
  /** One human sentence summarizing the comparison. */
  readonly sentence: string;
}

/** Minimum cohort size before a benchmark is considered trustworthy. */
const MIN_CONFIDENT_SAMPLE = 20;
/** Values within ±3% of the median count as "at" the median (relative band). */
const AT_BAND = 0.03;

/** Format a rate-like number as a percentage string with one decimal. */
export function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

/** Classify the owner value into a quartile band when p25/p75 are present. */
function classifyBand(value: number, fleet: FleetStats): QuartileBand {
  const { p25, p75, median } = fleet;
  if (typeof p75 === 'number' && value >= p75) return 'top';
  if (value >= median) return 'upper-middle';
  if (typeof p25 === 'number' && value <= p25) return 'bottom';
  if (value < median) return 'lower-middle';
  return null;
}

/**
 * Benchmark an owner's metric value against fleet stats. Higher-is-better by
 * default (conversion rate, etc.); pass `higherIsBetter:false` for metrics where
 * lower wins (e.g. bounce rate) to flip the verdict wording.
 *
 * @param value - The owner's metric value (e.g. a conversion rate 0–100).
 * @param fleet - {@link FleetStats} for the cohort.
 * @param opts - `metricLabel` for the sentence; `higherIsBetter` (default true).
 * @returns {@link BenchmarkResult}.
 *
 * @example
 * benchmarkMetric(1.2, { median: 3.4, p25: 2, p75: 5, sampleSize: 120 },
 *   { metricLabel: 'form conversion' })
 * // → { verdict: 'below', band: 'bottom', sentence: 'Your form conversion is 1.2% — below the 3.4% category median ...' }
 */
export function benchmarkMetric(
  value: number,
  fleet: FleetStats,
  opts: { metricLabel?: string; higherIsBetter?: boolean } = {},
): BenchmarkResult {
  const metricLabel = opts.metricLabel?.trim() || 'this metric';
  const higherIsBetter = opts.higherIsBetter !== false;
  const median = Number.isFinite(fleet.median) ? fleet.median : 0;
  const v = Number.isFinite(value) ? value : 0;

  const delta = Math.round((v - median) * 100) / 100;
  const ratio = median !== 0 ? Math.round((v / median) * 100) / 100 : null;

  // "At" band is relative to the median so small absolute gaps don't over-claim.
  const tolerance = Math.abs(median) * AT_BAND;
  let verdict: BenchmarkVerdict;
  if (Math.abs(delta) <= tolerance) verdict = 'at';
  else verdict = delta > 0 ? 'above' : 'below';

  const band = classifyBand(v, fleet);
  const lowConfidence = fleet.sampleSize < MIN_CONFIDENT_SAMPLE;

  // Whether the verdict is "good" depends on metric direction.
  const doingWell = verdict === 'at' ? null : (verdict === 'above') === higherIsBetter;
  const comparator = verdict === 'at' ? 'in line with' : verdict === 'above' ? 'above' : 'below';
  const bandPhrase =
    band === 'top'
      ? ' — top quartile'
      : band === 'bottom'
        ? ' — bottom quartile'
        : '';
  const tone =
    doingWell === null
      ? ''
      : doingWell
        ? ' Nice work.'
        : ' Room to improve.';
  const confidenceNote = lowConfidence
    ? ` (based on only ${fleet.sampleSize} comparable sites — treat as directional)`
    : '';

  const sentence =
    `Your ${metricLabel} is ${formatRate(v)} — ${comparator} the ${formatRate(median)} ` +
    `category median${bandPhrase}.${tone}${confidenceNote}`.replace(/\s+/g, ' ').trim();

  return { delta, ratio, verdict, band, lowConfidence, sentence };
}
