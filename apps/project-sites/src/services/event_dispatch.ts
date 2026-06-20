/**
 * @module services/event_dispatch
 *
 * The fan-out core of the Unified Analytics ingestion plane (Plane H of
 * `_CONVERGENCE_BACKLOG.md`). Pure + dependency-injected so it is fully unit-
 * testable WITHOUT the Durable Object runtime: the `EventDispatcher` DO supplies
 * the real `forward` (HTTP), the per-provider {@link CircuitBreaker} map, and
 * `now`; this function decides, per provider, whether to forward, runs the
 * configured+closed providers CONCURRENTLY (never block on a slow vendor), and
 * records success/failure on each breaker.
 *
 * Doctrine: **Sentry is the critical path and is listed first** ({@link FORWARD_ORDER});
 * an open breaker fails fast (`skipped_open`) so one degraded vendor never stalls
 * the batch. Outcomes preserve provider order for the `/api/analytics-debug` view.
 *
 * @example
 * const outcomes = await dispatchBatch(batch, {
 *   forward: (p, evs) => providerHttp[p](evs),
 *   breakers,
 *   configured: (p) => Boolean(creds[p]),
 * }, now);
 */

import type { IncomingEvent } from './analytics_events.js';
import type { CircuitBreaker } from './circuit_breaker.js';

/** The downstream sinks, in forward-priority order (Sentry first). */
export type ProviderId = 'sentry' | 'posthog' | 'ga4' | 'gtm';

/** Canonical forward order — Sentry (error-critical) leads. */
export const FORWARD_ORDER: readonly ProviderId[] = ['sentry', 'posthog', 'ga4', 'gtm'] as const;

/** Per-provider result of one batch dispatch. */
export interface ProviderOutcome {
  provider: ProviderId;
  status: 'forwarded' | 'skipped_open' | 'failed' | 'not_configured';
  /** True for the critical (Sentry) path. */
  critical: boolean;
  /** Failure detail when `status === 'failed'`. */
  error?: string;
}

/** Injected dependencies — the DO wires real implementations; tests wire mocks. */
export interface DispatchDeps {
  /** Forward a batch to one provider; resolves on success, REJECTS on failure. */
  forward: (provider: ProviderId, batch: readonly IncomingEvent[]) => Promise<void>;
  /** Per-provider breaker (created lazily by the caller; absent → treated closed). */
  breakers: Map<ProviderId, CircuitBreaker>;
  /** Whether the provider has stored credentials for this site. */
  configured: (provider: ProviderId) => boolean;
}

/**
 * Dispatch one batch to every provider concurrently, honoring each breaker.
 * Never throws — every provider resolves to a {@link ProviderOutcome}.
 *
 * @param batch - The events to forward (already deduped + validated).
 * @param deps - Injected forward / breakers / configured.
 * @param now - Current epoch ms (drives breaker time transitions).
 * @returns Outcomes in {@link FORWARD_ORDER}.
 */
export async function dispatchBatch(
  batch: readonly IncomingEvent[],
  deps: DispatchDeps,
  now: number,
): Promise<ProviderOutcome[]> {
  const tasks = FORWARD_ORDER.map(async (provider): Promise<ProviderOutcome> => {
    const critical = provider === 'sentry';

    if (!deps.configured(provider)) {
      return { provider, status: 'not_configured', critical };
    }

    const breaker = deps.breakers.get(provider);
    // Absent breaker == treated as closed (allow).
    if (breaker && !breaker.allowRequest(now)) {
      return { provider, status: 'skipped_open', critical };
    }

    try {
      await deps.forward(provider, batch);
      breaker?.recordSuccess(now);
      return { provider, status: 'forwarded', critical };
    } catch (err) {
      breaker?.recordFailure(now);
      return {
        provider,
        status: 'failed',
        critical,
        error: (err as Error)?.message ?? String(err),
      };
    }
  });

  // Concurrent + non-blocking; tasks never reject, so allSettled == all fulfilled.
  return Promise.all(tasks);
}

/**
 * Did the critical (Sentry) path succeed? The DO marks the batch a critical-path
 * success when Sentry forwarded even if a non-critical sink timed out.
 */
export function criticalSucceeded(outcomes: readonly ProviderOutcome[]): boolean {
  const sentry = outcomes.find((o) => o.provider === 'sentry');
  // Critical success = Sentry forwarded, OR Sentry simply isn't configured for this site.
  return (
    sentry === undefined || sentry.status === 'forwarded' || sentry.status === 'not_configured'
  );
}
