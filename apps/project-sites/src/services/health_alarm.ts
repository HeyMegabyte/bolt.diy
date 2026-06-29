/**
 * @module services/health_alarm
 *
 * Pure service for monitoring health-check state machines. Each check produces an
 * {@link AlarmResult}; a batch of checks is reduced to a single {@link AlarmState}.
 * Escalation delegates the state to a caller-dispatchable action plan.
 *
 * Pure + deterministic: every function takes explicit parameters and returns
 * derived values — no I/O, no clock, no side effects.
 *
 * @example
 * const r1 = checkAlarm('api', 'ok', 45);
 * const r2 = checkAlarm('db', 'error', 2300);
 * const state = alarmState([r1, r2]); // 'down'
 * const plan = escalateAlarm(state);  // { severity: 'critical', shouldNotify: true, ... }
 */

/** Well-known health-check status values. */
export type CheckStatus = 'ok' | 'warn' | 'error';

/**
 * Result of one health check.
 *
 * `latencyMs` is the measured response time in milliseconds; `status` is the
 * health disposition assigned by the caller or probing function.
 */
export interface AlarmResult {
  service: string;
  status: CheckStatus;
  latencyMs: number;
}

/**
 * Aggregate health state across one or more checks.
 *
 * - `healthy` — every service responded `ok`.
 * - `degraded` — at least one `warn`, zero `error`.
 * - `down` — at least one `error`.
 */
export type AlarmState = 'healthy' | 'degraded' | 'down';

/** Escalation plan returned by {@link escalateAlarm}. */
export interface EscalationPlan {
  shouldNotify: boolean;
  severity: 'none' | 'info' | 'warning' | 'critical';
  summary: string;
}

// ---------------------------------------------------------------------------
// Latency thresholds (milliseconds)
// ---------------------------------------------------------------------------

/** Services responding at or below this latency are considered fast. */
export const LATENCY_OK_MS = 500;

/** Services exceeding this latency are considered slow / degrading. */
export const LATENCY_WARN_MS = 2000;

/**
 * Evaluate a single service check and produce its {@link AlarmResult}.
 *
 * `status` is the primary signal; `latencyMs` is a secondary signal that may
 * upgrade a status-only decision (e.g. `ok` → `warn` when latency exceeds
 * {@link LATENCY_WARN_MS}).
 *
 * @param service - Human-readable service identifier (e.g. `"api"`, `"db"`).
 * @param status - Raw health status from the probe.
 * @param latencyMs - Measured response latency in milliseconds.
 * @returns A resolved {@link AlarmResult}.
 *
 * @example
 * checkAlarm('api', 'ok', 45);     // { service: 'api', status: 'ok', latencyMs: 45 }
 * checkAlarm('db', 'ok', 2100);    // { service: 'db', status: 'warn', latencyMs: 2100 }
 * checkAlarm('redis', 'error', 0); // { service: 'redis', status: 'error', latencyMs: 0 }
 */
export function checkAlarm(service: string, status: CheckStatus, latencyMs: number): AlarmResult {
  // Ensure latency is non-negative.
  const clamped = Math.max(0, latencyMs);
  // Upgrade ok → warn when the service is slow even if the status says ok.
  const effectiveStatus: CheckStatus =
    status === 'ok' && clamped > LATENCY_WARN_MS ? 'warn' : status;

  return { service, latencyMs: clamped, status: effectiveStatus };
}

/**
 * Reduce a list of {@link AlarmResult}s to a single {@link AlarmState}.
 *
 * Order: if any result is `error` → `down`; else if any is `warn` → `degraded`;
 * else → `healthy`.
 *
 * @param checks - Non-empty array of alarm results.
 * @returns The aggregate {@link AlarmState}.
 * @throws {RangeError} When `checks` is empty.
 *
 * @example
 * alarmState([{ service: 'a', status: 'ok', latencyMs: 10 }]);         // 'healthy'
 * alarmState([{ service: 'a', status: 'ok', latencyMs: 10 },
 *             { service: 'b', status: 'warn', latencyMs: 1500 }]);     // 'degraded'
 * alarmState([{ service: 'a', status: 'error', latencyMs: 0 }]);       // 'down'
 */
export function alarmState(checks: readonly AlarmResult[]): AlarmState {
  if (checks.length === 0) {
    throw new RangeError('alarmState requires at least one check');
  }

  let hasWarn = false;
  for (const c of checks) {
    if (c.status === 'error') return 'down';
    if (c.status === 'warn') hasWarn = true;
  }
  return hasWarn ? 'degraded' : 'healthy';
}

/**
 * Produce an {@link EscalationPlan} for the given {@link AlarmState}.
 *
 * The plan encodes whether a notification should fire, at what severity, and
 * a one-line summary suitable for alert routing.
 *
 * @param state - The aggregate alarm state.
 * @returns An {@link EscalationPlan} with notification metadata.
 *
 * @example
 * escalateAlarm('healthy');  // { severity: 'none', shouldNotify: false, summary: 'All services healthy' }
 * escalateAlarm('down');     // { severity: 'critical', shouldNotify: true, summary: 'One or more services are down' }
 */
export function escalateAlarm(state: AlarmState): EscalationPlan {
  switch (state) {
    case 'healthy':
      return {
        severity: 'none',
        shouldNotify: false,
        summary: 'All services healthy',
      };
    case 'degraded':
      return {
        severity: 'warning',
        shouldNotify: true,
        summary: 'One or more services are degraded',
      };
    case 'down':
      return {
        severity: 'critical',
        shouldNotify: true,
        summary: 'One or more services are down',
      };
  }
}
