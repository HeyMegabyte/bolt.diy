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
  /** True when every CONFIGURED target accepted (an unconfigured target is a no-op skip). */
  ok: boolean;
  /** Targets actually attempted (configured ones only). */
  attempted: DispatchTarget[];
  /** Per-target failures (target → reason) for `markFailed` / structured logging. */
  failures: { target: DispatchTarget; reason: string }[];
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
    if (!r.ok) failures.push({ target: 'tinybird', reason: r.reason ?? 'unknown' });
  }

  if (targets.includes('hatchet') && resolveHatchet(env)) {
    attempted.push('hatchet');
    const r = await push(env, event.type, event as unknown as Record<string, unknown>, {
      metadata: meta,
    });
    if (!r.ok) failures.push({ target: 'hatchet', reason: r.reason ?? 'unknown' });
  }

  return { ok: failures.length === 0, attempted, failures };
}

/** Summary of a drain pass. */
export interface DrainSummary {
  read: number;
  dispatched: number;
  failed: number;
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
  for (const event of pending) {
    const res = await dispatchOutboxEvent(env, event, deps);
    try {
      if (res.ok) {
        await markDispatched(env, event.id, now());
        dispatched++;
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
  return { read: pending.length, dispatched, failed };
}

// nextOutboxAction is re-exported for callers wiring the dead-letter view.
export { nextOutboxAction };
