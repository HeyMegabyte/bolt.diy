/**
 * @module services/health_probe
 * @description Pure zero-I/O aggregator for health probe results.
 * Classifies probes by HTTP status and duration, never throws.
 */

// ── Types ───────────────────────────────────────────────────

export interface ProbeResult {
  readonly url: string;
  readonly label: string;
  readonly status: number | null; // HTTP status; null = timeout/DNS failure
  readonly durationMs: number;
  readonly error?: string; // undefined when healthy
}

export interface HealthSummary {
  readonly total: number;
  readonly healthy: number;
  readonly degraded: number; // non-200 but responding
  readonly down: number; // unreachable / timeout
  readonly status: 'operational' | 'degraded' | 'outage';
  readonly probes: readonly ProbeResult[];
  readonly worstProbe: ProbeResult | null; // highest duration or error
}

// ── Classifiers ─────────────────────────────────────────────

/**
 * Classify a single probe result.
 *
 * @param p - The probe result to classify.
 * @returns 'healthy' for 200-299, 'degraded' for 300-599, 'down' for null status / error.
 *
 * @example
 * classifyProbe({ url: '...', label: 'API', status: 200, durationMs: 42 })
 * // => 'healthy'
 *
 * classifyProbe({ url: '...', label: 'DB', status: 503, durationMs: 500 })
 * // => 'degraded'
 *
 * classifyProbe({ url: '...', label: 'DNS', status: null, durationMs: 5000, error: 'Timeout' })
 * // => 'down'
 */
export function classifyProbe(p: ProbeResult): 'healthy' | 'degraded' | 'down' {
  if (p.status === null || p.error !== undefined) return 'down';
  if (p.status >= 200 && p.status <= 299) return 'healthy';
  return 'degraded';
}

// ── Aggregation ─────────────────────────────────────────────

/**
 * Aggregate probe results into a health summary.
 *
 * - Empty probes return status='operational', total=0, worstProbe=null.
 * - Any down probe sets status='outage'.
 * - Any degraded with no down sets status='degraded'.
 * - All healthy sets status='operational'.
 * - worstProbe prefers errors; ties broken by highest durationMs.
 *
 * @param probes - The probe results to aggregate.
 * @returns A HealthSummary with counts and classification.
 *
 * @example
 * aggregateHealth([])
 * // => { total: 0, healthy: 0, degraded: 0, down: 0, status: 'operational', worstProbe: null }
 *
 * @remarks Pure function, never throws. Accepts empty arrays.
 */
export function aggregateHealth(probes: readonly ProbeResult[]): HealthSummary {
  let healthy = 0;
  let degraded = 0;
  let down = 0;
  let worstProbe: ProbeResult | null = null;

  for (const p of probes) {
    const classification = classifyProbe(p);

    if (classification === 'healthy') healthy++;
    else if (classification === 'degraded') degraded++;
    else down++;

    // Track worst: prefer errors, then highest durationMs
    if (worstProbe === null) {
      worstProbe = p;
    } else if (p.error !== undefined && worstProbe.error === undefined) {
      worstProbe = p;
    } else if (
      p.error === undefined &&
      worstProbe.error === undefined &&
      p.durationMs > worstProbe.durationMs
    ) {
      worstProbe = p;
    } else if (
      p.error !== undefined &&
      worstProbe.error !== undefined &&
      p.durationMs > worstProbe.durationMs
    ) {
      worstProbe = p;
    }
  }

  let status: 'operational' | 'degraded' | 'outage';
  if (down > 0) {
    status = 'outage';
  } else if (degraded > 0) {
    status = 'degraded';
  } else {
    status = 'operational';
  }

  return {
    degraded,
    down,
    healthy,
    probes,
    status,
    total: healthy + degraded + down,
    worstProbe,
  };
}

// ── Ranking ─────────────────────────────────────────────────

/**
 * Count how many probes are slower than the target.
 *
 * @param probes - Full list of probe results.
 * @param target - The probe to rank against.
 * @returns The number of probes with strictly higher durationMs.
 *
 * @example
 * const probes = [
 *   { url: '...', label: 'A', status: 200, durationMs: 100 },
 *   { url: '...', label: 'B', status: 200, durationMs: 300 },
 *   { url: '...', label: 'C', status: 200, durationMs: 50 },
 * ];
 * slowerThan(probes, probes[0]) // => 1 (only B is slower)
 *
 * @remarks Pure function, never throws. The target is not excluded from the count.
 */
export function slowerThan(probes: readonly ProbeResult[], target: ProbeResult): number {
  return probes.filter((p) => p.durationMs > target.durationMs).length;
}
