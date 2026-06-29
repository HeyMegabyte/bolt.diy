/**
 * @module services/workflow_schedule
 * @description Pure schedule helpers for workflow cron triggers. Computes
 * due-next windows from a `WorkflowTrigger` record without external deps —
 * Workers-native, no cron-parser library.
 *
 * @example
 * ```ts
 * const t = buildTrigger('site_cleanup', 'weekly');
 * t.nextRun // null (never run)
 * isDue(t)  // true
 *
 * const t2 = scheduleNext(t);
 * t2.lastRun // now
 * t2.nextRun // now + 7d
 * isDue(t2)  // false
 * ```
 */

/**
 * A single workflow trigger record.
 *
 * - `nextRun` — epoch-ms timestamp of the next scheduled execution; `null` means
 *   "not yet scheduled" (immediately due).
 * - `lastRun` — epoch-ms timestamp of the most recent execution; `null` means
 *   "never executed".
 */
export interface WorkflowTrigger {
  /** Logical workflow key, e.g. `"site_cleanup"`. */
  workflow: string;
  /** Cron-like interval descriptor: `"daily"` / `"weekly"` / `"hourly"` or a
   *  standard 5-field cron expression (`"0 3 * * *"`). */
  cron: string;
  /** Epoch-ms of the next scheduled execution, or `null` if unscheduled. */
  nextRun: string | null;
  /** Epoch-ms of the last execution, or `null` if never run. */
  lastRun: string | null;
  /** Whether this trigger is active. */
  enabled: boolean;
}

/**
 * Named-interval map for the most common workflow cadences. Each value is a
 * duration in milliseconds.
 */
const NAMED_INTERVALS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  hourly: 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Pre-defined workflow triggers with their friendly-name cron strings.
 * Every entry maps a workflow key to an interval name resolvable by
 * `intervalMs`.
 *
 * Keys: `site_cleanup` (weekly), `analytics_rollup` (daily),
 * `backup_rotation` (daily).
 */
export const WORKFLOW_TRIGGERS: Record<string, string> = {
  analytics_rollup: 'daily',
  backup_rotation: 'daily',
  site_cleanup: 'weekly',
};

/**
 * Parse a cron expression (5-field standard syntax) into a per-run
 * interval in milliseconds. Only non-positional fields handled —
 * complex schedules (day-of-week combos) return `null`.
 *
 * @param cron - A 5-field cron string, e.g. `"0 3 * * *"`.
 * @returns The interval in ms if parseable, or `null`.
 *
 * @example
 * ```ts
 * parseCronExpr('0 3 * * *')  // 86_400_000 (daily at 03:00)
 * parseCronExpr('0 3 * * 0')  // 604_800_000 (weekly on Sunday)
 * parseCronExpr('30 * * * *') // null (sub-hour not supported)
 * ```
 */
export function parseCronExpr(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [min, hour, dom, month, dow] = parts;

  // Daily: "0 3 * * *" → 24h (we treat positional daily as rough interval)
  if (min === '0' && hour !== '*' && dom === '*' && month === '*' && dow === '*') {
    return NAMED_INTERVALS.daily;
  }

  // Weekly: "0 3 * * 0" or "0 3 * * 6"  → 7d
  if (min === '0' && hour !== '*' && dom === '*' && month === '*' && dow !== '*') {
    return NAMED_INTERVALS.weekly;
  }

  // Hourly: "0 * * * *" or "* * * * *"
  if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return NAMED_INTERVALS.hourly;
  }

  // Complex / sub-hour intervals are not supported
  return null;
}

/**
 * Resolve a cron string (named like `"daily"` or 5-field standard) to an
 * interval in milliseconds.
 *
 * @param cron - A cron descriptor.
 * @returns The interval in ms.
 * @throws {RangeError} When the cron descriptor cannot be resolved.
 *
 * @example
 * ```ts
 * intervalMs('daily')    // 86_400_000
 * intervalMs('weekly')   // 604_800_000
 * intervalMs('0 3 * * *') // 86_400_000
 * ```
 */
export function intervalMs(cron: string): number {
  const named = NAMED_INTERVALS[cron];
  if (named !== undefined) return named;

  const parsed = parseCronExpr(cron);
  if (parsed !== null) return parsed;

  throw new RangeError(`Unrecognised cron descriptor: "${cron}"`);
}

/**
 * Build a new `WorkflowTrigger` from its workflow name and cron descriptor.
 * `nextRun` and `lastRun` start `null` — the trigger is immediately due.
 *
 * @param workflow - Logical workflow key.
 * @param cron - Cron or named-interval descriptor.
 * @returns A fresh trigger with no run history.
 *
 * @example
 * ```ts
 * const t = buildTrigger('site_cleanup', 'weekly');
 * // { workflow: 'site_cleanup', cron: 'weekly', nextRun: null,
 * //   lastRun: null, enabled: true }
 * ```
 */
export function buildTrigger(workflow: string, cron: string): WorkflowTrigger {
  return {
    cron,
    enabled: true,
    lastRun: null,
    nextRun: null,
    workflow,
  };
}

/**
 * Determine whether a trigger is due to execute.
 *
 * A trigger is due when:
 * 1. It is disabled → never due.
 * 2. `nextRun` is `null` (never scheduled) → due immediately.
 * 3. `nextRun` ≤ `now` → past the scheduled time.
 * 4. Otherwise → not yet due.
 *
 * @param trigger - The trigger to check.
 * @param nowMs - Current time in ms (defaults to `Date.now()`).
 * @returns `true` if the trigger should fire now.
 *
 * @example
 * ```ts
 * isDue(buildTrigger('cleanup', 'weekly'))       // true (never run)
 *
 * const t = scheduleNext(buildTrigger('cleanup', 'weekly'));
 * isDue(t)                                       // false
 * ```
 */
export function isDue(trigger: WorkflowTrigger, nowMs: number = Date.now()): boolean {
  if (!trigger.enabled) return false;
  if (trigger.nextRun === null) return true;
  return Number(trigger.nextRun) <= nowMs;
}

/**
 * Advance a trigger to its next cycle: record `lastRun` at `now` and compute
 * `nextRun` = `now + intervalMs(cron)`.
 *
 * @param trigger - The trigger to advance.
 * @param nowMs - Current time in ms (defaults to `Date.now()`).
 * @returns A new `WorkflowTrigger` with updated `lastRun` / `nextRun`.
 * @throws {RangeError} When `trigger.cron` cannot be parsed by `intervalMs`.
 *
 * @example
 * ```ts
 * const t = scheduleNext(buildTrigger('cleanup', 'daily'));
 * t.lastRun  // now
 * t.nextRun  // now + 86_400_000
 * ```
 */
export function scheduleNext(
  trigger: WorkflowTrigger,
  nowMs: number = Date.now(),
): WorkflowTrigger {
  const ms = intervalMs(trigger.cron);
  return {
    ...trigger,
    lastRun: String(nowMs),
    nextRun: String(nowMs + ms),
  };
}
