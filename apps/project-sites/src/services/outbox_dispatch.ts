/**
 * Outbox dispatch router — fans each durable `event_bus` event to its backends.
 *
 * @remarks
 * The outbox (`event_bus.ts`) is the durable event log; this is the missing
 * dispatcher that drains it. Routing is PURE + total ({@link eventDispatchTargets}):
 *  - **Tinybird** receives EVERY event — the analytics OLAP warehouse captures all
 *    telemetry for high-cardinality per-tenant queries (`INFRA_NOTES.md`).
 *  - **Hatchet** receives only ORCHESTRATION-relevant types (build/publish/claim/
 *    billing transitions that trigger durable workflows) — not pure analytics noise.
 * Both targets are env-gated adapters that no-op when unconfigured, so on a fresh
 * deploy the dispatcher safely marks rows dispatched (nothing to deliver) rather
 * than wedging the outbox. Never throws.
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';
import type { ProjectSitesEvent, EventType } from './event_bus.js';
import { readPendingOutbox, markDispatched, markFailed, nextOutboxAction } from './event_bus.js';
import { ingestTinybirdEvent, resolveTinybird } from './tinybird.js';
import { pushHatchetEvent, resolveHatchet } from './hatchet.js';

/** Where an event is fanned. */
export type DispatchTarget = 'tinybird' | 'hatchet';

/** Tinybird datasource that receives the unified event stream. */
export const OUTBOX_TINYBIRD_DATASOURCE = 'projectsites_events';

/** Event types that trigger durable Hatchet workflows (orchestration, not analytics). */
const HATCHET_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'site.claim.started',
  'site.claim.completed',
  'site.generated',
  'site.published',
  'site.publish.failed',
  'subscription.active',
  'subscription.past_due',
  'subscription.canceled',
  'invoice.paid',
  'invoice.failed',
  'entitlement.updated',
  'lead.discovered',
  'notification.workflow.triggered',
]);

/**
 * Targets whose failure MUST retry the outbox row. Tinybird is the analytics SSOT
 * — EVERY event must land there (it feeds the activation funnel + all telemetry),
 * so a Tinybird rejection keeps the row drainable for redelivery.
 *
 * Hatchet is deliberately NOT required: it is best-effort orchestration for a
 * subset of types. A Hatchet failure is recorded as a SOFT failure (logged +
 * surfaced in drain health) but does NOT fail the row — otherwise the drain
 * re-dispatches and RE-INGESTS Tinybird on every retry (duplicate analytics rows)
 * until the row dead-letters. Incident 2026-09-06: a stale `HATCHET_API_TOKEN`
 * returned `http_error` on every push, so one `lead.discovered` ingested to
 * Tinybird 3× (and climbing) while the funnel's distinct-site count masked it.
 */
const REQUIRED_TARGETS: ReadonlySet<DispatchTarget> = new Set<DispatchTarget>(['tinybird']);

/**
 * Decide which backends an event fans to. Pure + total. Tinybird gets everything
 * (analytics); Hatchet gets orchestration types only.
 *
 * @param event - The outbox event.
 * @returns The ordered list of {@link DispatchTarget}s (Tinybird first).
 * @example eventDispatchTargets({ type:'site.published', ... }) // ['tinybird','hatchet']
 */
export function eventDispatchTargets(event: ProjectSitesEvent): DispatchTarget[] {
  const targets: DispatchTarget[] = ['tinybird'];
  if (HATCHET_EVENT_TYPES.has(event.type)) targets.push('hatchet');
  return targets;
}

/** Result of dispatching one event. */
export interface DispatchResult {
  /** True when every REQUIRED target accepted. A best-effort (soft) target's
   *  failure does NOT flip this — see {@link REQUIRED_TARGETS}. An unconfigured
   *  target is a no-op skip (never a failure). */
  ok: boolean;
  /** Targets actually attempted (configured ones only). */
  attempted: DispatchTarget[];
  /** REQUIRED-target failures (→ `markFailed`, the row retries). */
  failures: { target: DispatchTarget; reason: string }[];
  /** Best-effort target failures (Hatchet): logged + surfaced in drain health,
   *  but the row is still marked dispatched — they never strand it. */
  softFailures: { target: DispatchTarget; reason: string }[];
}

/** Injectable adapter seams (default to the real ones) for testability. */
export interface DispatchDeps {
  ingestTinybird?: typeof ingestTinybirdEvent;
  pushHatchet?: typeof pushHatchetEvent;
}

/**
 * Dispatch ONE event to its configured backends. Never throws. An unconfigured
 * backend is SKIPPED (not a failure) so the row still completes on a fresh deploy.
 * `ok` is false only when a CONFIGURED backend rejected — the row then retries.
 *
 * @param env - Worker env.
 * @param event - The outbox event.
 * @param deps - Optional injected adapters.
 * @returns A {@link DispatchResult}.
 */
export async function dispatchOutboxEvent(
  env: Env,
  event: ProjectSitesEvent,
  deps: DispatchDeps = {},
): Promise<DispatchResult> {
  const ingest = deps.ingestTinybird ?? ingestTinybirdEvent;
  const push = deps.pushHatchet ?? pushHatchetEvent;
  const targets = eventDispatchTargets(event);
  const attempted: DispatchTarget[] = [];
  const failures: { target: DispatchTarget; reason: string }[] = [];
  const softFailures: { target: DispatchTarget; reason: string }[] = [];
  // Route a failure to `failures` (retries the row) or `softFailures` (logged,
  // row still dispatched) by whether the target is REQUIRED.
  const recordFailure = (target: DispatchTarget, reason: string) =>
    (REQUIRED_TARGETS.has(target) ? failures : softFailures).push({ target, reason });

  const meta = { tenant_id: event.tenantId, ...(event.siteId ? { site_id: event.siteId } : {}) };

  if (targets.includes('tinybird') && resolveTinybird(env)) {
    attempted.push('tinybird');
    // This object is the SSOT for the projectsites_events NDJSON row — keep it in
    // lockstep with tinybird/datasources/projectsites_events.datasource. `payload`
    // carries the event `data` (JSON string) so pipes can slice by source/slug/
    // plan/leadId (high-cardinality activation analytics), not just event type.
    const r = await ingest(env, OUTBOX_TINYBIRD_DATASOURCE, {
      site_id: event.siteId ?? '',
      tenant_id: event.tenantId,
      event: event.type,
      timestamp: event.time,
      event_id: event.id,
      trace_id: event.traceId,
      producer: event.producer,
      payload: JSON.stringify(event.data ?? {}),
    });
    if (!r.ok) recordFailure('tinybird', r.reason ?? 'unknown');
  }

  if (targets.includes('hatchet') && resolveHatchet(env)) {
    attempted.push('hatchet');
    const r = await push(env, event.type, event as unknown as Record<string, unknown>, {
      metadata: meta,
    });
    if (!r.ok) recordFailure('hatchet', r.reason ?? 'unknown');
  }

  // `ok` gates ONLY on REQUIRED-target failures — a soft (Hatchet) failure is
  // surfaced but never retries the row (a retry would re-ingest Tinybird).
  return { ok: failures.length === 0, attempted, failures, softFailures };
}

/** Summary of a drain pass. */
export interface DrainSummary {
  read: number;
  dispatched: number;
  failed: number;
  /** Rows dispatched (all REQUIRED targets OK) that still had a best-effort
   *  target (Hatchet) failure. Optional so pre-existing summaries stay valid. */
  softFailed?: number;
}

/** Operator-facing health verdict for one drain pass. */
export interface DrainHealth {
  /** Log severity: `info` for a clean/empty pass, `warn` when attention is due. */
  level: 'info' | 'warn';
  /** A configured backend rejected ≥1 event (now retrying toward the dead-letter gate). */
  hasFailures: boolean;
  /** The pass read a FULL page — the outbox may be backing up faster than it drains. */
  atCapacity: boolean;
  /** One-line human summary for the structured log / alert. */
  message: string;
}

/**
 * Classify a drain pass so the cron logs at the right severity instead of burying
 * failures + backlog at `info`. `warn` fires when events failed (heading to the
 * dead-letter gate) OR the page came back full (`read === limit`, likely more
 * pending than one pass clears). Pure — no I/O.
 *
 * @param summary - The {@link DrainSummary} from {@link drainOutbox}.
 * @param limit - The page size the drain used (default 50).
 * @returns A {@link DrainHealth} verdict.
 * @example
 * const h = assessDrainHealth(summary);
 * console.warn(JSON.stringify({ level: h.level, message: h.message, ...summary }));
 */
export function assessDrainHealth(summary: DrainSummary, limit = 50): DrainHealth {
  const hasFailures = summary.failed > 0;
  const softFailed = summary.softFailed ?? 0;
  const atCapacity = summary.read >= limit;
  const level: 'info' | 'warn' =
    hasFailures || atCapacity || softFailed > 0 ? 'warn' : 'info';
  const parts: string[] = [];
  if (hasFailures)
    parts.push(`${summary.failed} event(s) failed dispatch (retrying → dead-letter)`);
  if (softFailed > 0)
    parts.push(
      `${softFailed} event(s) hit a best-effort backend failure (e.g. Hatchet) — analytics landed, orchestration skipped`,
    );
  if (atCapacity) parts.push(`drain hit its ${limit}-row page — outbox may be backing up`);
  const message =
    parts.length > 0
      ? parts.join('; ')
      : `Outbox drained cleanly (${summary.dispatched} dispatched)`;
  return { level, hasFailures, atCapacity, message };
}

/**
 * Drain pending outbox rows (FIFO): dispatch each, then `markDispatched` on
 * success or `markFailed` on a configured-backend rejection. Intended to be
 * called from a Cron Trigger / Queue consumer (off the hot path). Never throws —
 * a per-row failure marks that row failed (the dead-letter gate in
 * {@link nextOutboxAction} stops runaway retries) and the drain continues.
 *
 * @param env - Worker env (DB + adapter config).
 * @param deps - `{ limit, now, ...adapter seams }`.
 * @returns A {@link DrainSummary}.
 */
export async function drainOutbox(
  env: Env,
  deps: DispatchDeps & { limit?: number; now?: () => string } = {},
): Promise<DrainSummary> {
  const now = deps.now ?? (() => new Date().toISOString());
  let pending: ProjectSitesEvent[];
  try {
    pending = await readPendingOutbox(env, deps.limit ?? 50);
  } catch {
    return { read: 0, dispatched: 0, failed: 0 };
  }
  let dispatched = 0;
  let failed = 0;
  let softFailed = 0;
  for (const event of pending) {
    const res = await dispatchOutboxEvent(env, event, deps);
    try {
      if (res.ok) {
        await markDispatched(env, event.id, now());
        dispatched++;
        // Row delivered (every REQUIRED target accepted). A best-effort target
        // (Hatchet) still failing is surfaced but must NOT re-fail the row —
        // re-failing re-drains it and RE-INGESTS Tinybird on every retry.
        if (res.softFailures.length > 0) {
          softFailed++;
          console.warn(
            JSON.stringify({
              level: 'warn',
              msg: 'outbox soft-failure (best-effort target skipped)',
              id: event.id,
              type: event.type,
              softFailures: res.softFailures.map((f) => `${f.target}:${f.reason}`),
            }),
          );
        }
      } else {
        await markFailed(
          env,
          event.id,
          res.failures.map((f) => `${f.target}:${f.reason}`).join(','),
        );
        failed++;
      }
    } catch {
      failed++; // a DB write failure shouldn't abort the whole drain
    }
  }
  return { read: pending.length, dispatched, failed, softFailed };
}

// nextOutboxAction is re-exported for callers wiring the dead-letter view.
export { nextOutboxAction };
