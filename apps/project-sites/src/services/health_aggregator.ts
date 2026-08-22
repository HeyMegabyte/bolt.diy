/**
 * @module services/health_aggregator
 * @description LOOP-STATUS-001 core — normalizes raw subsystem health-check
 * responses into typed `ComponentState` records. Pure functions, zero I/O.
 * The runner (fetch loop, cron, DO alarm) lives outside this module; this
 * module only classifies + normalizes.
 *
 * Every subsystem's `/health` endpoint returns `{status, version, checks[]}`.
 * This module parses that contract and maps it to the platform's normalized
 * `ComponentState` shape — the SSOT every downstream consumer (status page,
 * SLA dashboard, incident detector, alert engine) reads from.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Status enum ───────────────────────────────────────────────────────────

/** Normalized component health status. */
export const ComponentStatus = z.enum([
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
]);
export type ComponentStatus = z.infer<typeof ComponentStatus>;

// ── ComponentState — the canonical normalized shape ────────────────────────

/** One subsystem's health snapshot, normalized from its raw `/health` response. */
export const ComponentStateSchema = z.object({
  /** Stable slug matching the subsystem registry key (e.g. `d1`, `r2`, `mail`). */
  slug: z.string().min(1).max(64),
  /** Normalized status derived from the health response (or timeout/error). */
  status: ComponentStatus,
  /** Round-trip latency in milliseconds (wall-clock from fetch start to end). */
  latencyMs: z.number().finite().nonnegative(),
  /** ISO-8601 timestamp of when the check was performed. */
  checkedAt: z.string().datetime(),
  /**
   * Human-readable detail — the subsystem's own status message, a timeout
   * note, or the error message if the check failed.
   */
  detail: z.string().max(500).default(''),
});
export type ComponentState = z.infer<typeof ComponentStateSchema>;

// ── Raw health response shape (what subsystems expose at /health) ──────────

/** Raw shape a subsystem `/health` endpoint is expected to return. */
export const HealthCheckPayload = z.object({
  status: z.string().optional(),
  version: z.string().optional(),
  checks: z
    .array(
      z.object({
        name: z.string().optional(),
        status: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
});
export type HealthCheckPayload = z.infer<typeof HealthCheckPayload>;

// ── Normalization helpers ──────────────────────────────────────────────────

/**
 * Maps a raw `/health` HTTP response (or absence thereof) to a normalized
 * `ComponentState`. Never throws — every input path returns a valid state.
 *
 * @param slug - Subsystem identifier (e.g. `"d1"`, `"mail"`).
 * @param response - The fetch `Response` object, or `null` when the fetch
 *   threw (DNS/timeout/network error).
 * @param latencyMs - Wall-clock latency of the health check fetch.
 * @param checkedAt - ISO-8601 timestamp of when the check was performed.
 *   Defaults to `new Date().toISOString()` — deterministic callers pass their
 *   own value.
 * @returns A normalized `ComponentState`, regardless of input.
 *
 * @example
 * ```ts
 * // Successful health check
 * const state = await normalizeComponentState('d1', res, 42, '2026-06-30T00:00:00Z');
 * // { slug: 'd1', status: 'operational', latencyMs: 42, checkedAt: '...', detail: 'ok' }
 * ```
 *
 * @example
 * ```ts
 * // Timeout / network error
 * const state = normalizeComponentState('mail', null, 5001, '2026-06-30T00:00:00Z');
 * // { slug: 'mail', status: 'major_outage', latencyMs: 5001, ... }
 * ```
 */
export async function normalizeComponentState(
  slug: string,
  response: Response | null,
  latencyMs: number,
  checkedAt: string = new Date().toISOString(),
): Promise<ComponentState> {
  const base = { slug, latencyMs, checkedAt };

  // Timeout / DNS / network error → major_outage
  if (!response) {
    return ComponentStateSchema.parse({
      ...base,
      status: 'major_outage',
      detail: 'Health check failed: network error or timeout',
    });
  }

  // HTTP non-2xx → degraded or major_outage depending on severity
  if (!response.ok) {
    const status = response.status >= 500 ? 'major_outage' : 'degraded';
    let detail = `HTTP ${response.status} ${response.statusText}`.trim();
    // Try to extract a body message, but don't fail on parse errors
    try {
      const body = await parseHealthBody(response);
      if (body.status) detail = body.status;
    } catch {
      // Ignore — use the HTTP status detail above
    }
    return ComponentStateSchema.parse({ ...base, status, detail });
  }

  // 2xx — parse the health payload and derive status
  try {
    const body = await parseHealthBody(response);
    const status = deriveStatus(body);
    const detail = body.status ?? body.checks?.find((c) => c.message)?.message ?? 'ok';
    return ComponentStateSchema.parse({ ...base, status, detail });
  } catch {
    // Malformed 200 body → degraded (it's up but we can't verify)
    return ComponentStateSchema.parse({
      ...base,
      status: 'degraded',
      detail: 'Health endpoint returned 200 but body is unparseable',
    });
  }
}

/**
 * Synchronous batch normalization — classifies a set of already-completed
 * health checks in one pass. Each entry carries its own response (or null for
 * failure) + latency. Returns results in the same order.
 *
 * @param checks - Array of raw check results to normalize.
 * @returns Normalized `ComponentState` entries in the same order.
 */
export async function normalizeBatch(
  checks: Array<{
    slug: string;
    response: Response | null;
    latencyMs: number;
    checkedAt: string;
  }>,
): Promise<ComponentState[]> {
  return Promise.all(
    checks.map((c) => normalizeComponentState(c.slug, c.response, c.latencyMs, c.checkedAt)),
  );
}

/**
 * Derives a normalized `ComponentStatus` from a parsed health-check payload.
 *
 * Heuristic:
 * - Explicit `status: "ok"` or missing → `operational`
 * - `status: "degraded"` → `degraded`
 * - `status: "maintenance"` → `maintenance`
 * - Any failing check → `degraded` (one check down)
 * - Multiple failing checks → `partial_outage`
 * - No checks at all but 200 → `operational` (assume it's fine)
 *
 * @param body - Parsed health-check response body.
 * @returns Normalized `ComponentStatus`.
 */
export function deriveStatus(body: HealthCheckPayload): ComponentStatus {
  const explicit = body.status?.toLowerCase();

  // Explicit status labels from the subsystem
  if (explicit === 'maintenance') return 'maintenance';
  if (explicit === 'degraded') return 'degraded';

  // Count failing checks
  const checks = body.checks ?? [];
  const failing = checks.filter(
    (c) => c.status && c.status.toLowerCase() !== 'ok' && c.status.toLowerCase() !== 'pass',
  );

  if (failing.length >= 3) return 'partial_outage';
  if (failing.length >= 1) return 'degraded';

  // Explicit ok or no issues → operational
  return 'operational';
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Safely reads and parses the JSON body of a health-check response. Throws
 * only when the body is unreadable or unparseable.
 */
async function parseHealthBody(response: Response): Promise<HealthCheckPayload> {
  const text = await response.text();
  const raw: unknown = JSON.parse(text);
  return HealthCheckPayload.parse(raw);
}

// ── Subsystem registry types (pure — the actual URLs live in env/config) ───

/** Descriptor for one subsystem in the health registry. */
export interface SubsystemEntry {
  /** Stable identifier (e.g. `"d1"`, `"r2"`, `"mail"`). */
  readonly slug: string;
  /** Human-readable label for dashboards. */
  readonly label: string;
  /** Absolute URL of the `/health` endpoint. */
  readonly healthUrl: string;
  /**
   * Slugs of subsystems this one depends on. An outage here may be explained
   * by a parent outage — used for root-cause grouping.
   */
  readonly dependsOn: readonly string[];
}

/**
 * Validates that a subsystem registry array is well-formed (no duplicate
 * slugs, no self-referential dependsOn, all dependsOn slugs exist in the
 * registry). Pure — call before passing the registry to the runner.
 *
 * @param entries - The subsystem registry to validate.
 * @returns An array of validation error strings (empty = valid).
 */
export function validateRegistry(entries: readonly SubsystemEntry[]): string[] {
  const errors: string[] = [];
  const slugs = new Set(entries.map((e) => e.slug));

  if (slugs.size !== entries.length) {
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.slug)) errors.push(`Duplicate slug: "${e.slug}"`);
      seen.add(e.slug);
    }
  }

  for (const e of entries) {
    if (e.dependsOn.includes(e.slug)) {
      errors.push(`Self-referential dependsOn: "${e.slug}" depends on itself`);
    }
    for (const dep of e.dependsOn) {
      if (!slugs.has(dep)) {
        errors.push(
          `Unknown dependency: "${e.slug}" depends on "${dep}" which is not in the registry`,
        );
      }
    }
  }

  return errors;
}

/**
 * Builds a collective status summary from a set of normalized component
 * states. The platform-level status is the worst status across all
 * components.
 *
 * - `operational` — all components green
 * - `degraded` — at least one component degraded or in maintenance
 * - `partial_outage` — at least one component in partial outage
 * - `major_outage` — at least one component in major outage
 *
 * @param states - Normalized component states from one aggregation cycle.
 * @returns A summary with the overall status, counts, and per-status breakdown.
 */
export function summarizeAggregate(states: readonly ComponentState[]): AggregateSummary {
  const counts: Record<ComponentStatus, number> = {
    operational: 0,
    degraded: 0,
    partial_outage: 0,
    major_outage: 0,
    maintenance: 0,
  };

  let overall: ComponentStatus = 'operational';

  for (const s of states) {
    counts[s.status]++;
    if (statusSeverity(s.status) > statusSeverity(overall)) {
      overall = s.status;
    }
  }

  return {
    overall,
    total: states.length,
    counts,
    allOperational: overall === 'operational',
    checkedAt: states[0]?.checkedAt ?? new Date().toISOString(),
  };
}

/** Summary of one health-aggregation cycle. */
export interface AggregateSummary {
  /** Worst status across all components. */
  overall: ComponentStatus;
  /** Total number of components checked. */
  total: number;
  /** Breakdown by status. */
  counts: Record<ComponentStatus, number>;
  /** True when every component is operational. */
  allOperational: boolean;
  /** ISO-8601 timestamp of this aggregation cycle. */
  checkedAt: string;
}

/** Numeric severity for status comparison (higher = worse). */
function statusSeverity(s: ComponentStatus): number {
  switch (s) {
    case 'operational':
      return 0;
    case 'maintenance':
      return 1;
    case 'degraded':
      return 2;
    case 'partial_outage':
      return 3;
    case 'major_outage':
      return 4;
  }
}
