/**
 * Outbound-webhook dispatch orchestrator (#10 / reused by #11 automation_builder).
 *
 * This is the GLUE that ties the already-tested primitives in
 * {@link ./outbound_webhooks} into a single per-event run:
 *
 *   event → planDeliveries → (per matched endpoint) decrypt secret → HMAC sign
 *         → attemptDelivery → recordDelivery → retry via shouldRetry/nextRetryDelayMs
 *
 * Every effect is INJECTED ({@link DispatchDeps}) so the full orchestration —
 * including the retry/backoff loop — is unit-testable with zero real crypto, no
 * D1, and no wall-clock sleeping. The thin Workflow wrapper (slice 2, ships on
 * push — CF Queues are off so retries run on Cloudflare Workflows / `ctx.waitUntil`)
 * supplies the real deps: `decrypt` from `ai_crypto`, `sign` = `hmacSha256` from
 * `@project-sites/shared`, `fetchFn` = global `fetch`, `record` = `recordDelivery`,
 * and `sleep` = `step.sleep` (durable) or a `setTimeout`-backed delay.
 *
 * @remarks SSRF safety is enforced twice: `planDeliveries` skips unsafe URLs, and
 * `attemptDelivery` re-checks at fetch time. An `unsafe_url` outcome is a PERMANENT
 * block — never retried (even though its `statusCode` is `0`, which would otherwise
 * look like a transient network error to `shouldRetry`).
 */
import {
  type DeliveryRecord,
  type EndpointForDispatch,
  attemptDelivery,
  nextRetryDelayMs,
  planDeliveries,
  shouldRetry,
} from './outbound_webhooks';
import { dbQuery } from './db';
import type { Env } from '../types/env';

/** A site endpoint plus its at-rest encrypted signing secret (decrypted lazily, only when matched). */
export interface DispatchEndpoint extends EndpointForDispatch {
  /** AES-GCM blob from `webhook_endpoints.secret_encrypted`. */
  secretEncrypted: string;
}

/**
 * Load a site's ENABLED endpoints WITH their at-rest encrypted secrets, for the
 * dispatch path only. Distinct from `listWebhookEndpoints` (the admin list),
 * which deliberately NEVER returns secrets — this loader is internal-only
 * (system-initiated dispatch), so it includes `secret_encrypted` for signing.
 *
 * @remarks Per-row JSON parse is guarded: one poisoned `event_types` row can't
 * crash dispatch for the whole site — a malformed row degrades to no
 * subscriptions (skipped by `planDeliveries`) rather than throwing.
 *
 * @param siteId - the site the event fired for.
 * @returns enabled, non-deleted endpoints mapped to {@link DispatchEndpoint}.
 */
export async function loadDispatchEndpoints(env: Env, siteId: string): Promise<DispatchEndpoint[]> {
  const { data } = await dbQuery<{ id: string; url: string; event_types: string; secret_encrypted: string }>(
    env.DB,
    `SELECT id, url, event_types, secret_encrypted FROM webhook_endpoints
     WHERE site_id = ? AND enabled = 1 AND deleted_at IS NULL`,
    [siteId],
  );
  return data.map((r) => {
    let eventTypes: string[] = [];
    try {
      const parsed = JSON.parse(r.event_types);
      if (Array.isArray(parsed)) eventTypes = parsed as string[];
    } catch {
      /* malformed row — degrade to no subscriptions rather than crash dispatch */
    }
    return { id: r.id, url: r.url, eventTypes, enabled: true, secretEncrypted: r.secret_encrypted };
  });
}

/** All side effects the orchestrator needs, injected for testability + Workflow-vs-inline portability. */
export interface DispatchDeps {
  fetchFn: typeof fetch;
  /** Decrypt an endpoint's at-rest signing secret (real impl: `ai_crypto.decrypt`). */
  decrypt: (secretEncrypted: string) => Promise<string>;
  /** HMAC the `signatureBase` with the endpoint secret (real impl: `hmacSha256`). */
  sign: (secret: string, signatureBase: string) => Promise<string>;
  /** Persist one delivery attempt (real impl: `recordDelivery`). */
  record: (rec: DeliveryRecord) => Promise<void>;
  /** Backoff between retries — instant in tests; `step.sleep` (durable) or `setTimeout` in prod. */
  sleep: (ms: number) => Promise<void>;
}

export interface DispatchOutcome {
  /** Endpoints that returned 2xx (after any retries). */
  delivered: number;
  /** Endpoints that exhausted retries or hit a permanent failure. */
  failed: number;
  /** Endpoints skipped by the planner (disabled / not subscribed / unsafe URL). */
  skipped: number;
  /** Total HTTP attempts made across all endpoints (≥ delivered+failed when retries fired). */
  attempts: number;
}

/**
 * Dispatch ONE event to all of a site's subscribed endpoints, with bounded retry.
 *
 * @param deps - injected effects (fetch / decrypt / sign / record / sleep).
 * @param event - the platform event `{ type, payload }`.
 * @param endpoints - the site's endpoints WITH their encrypted secrets.
 * @param siteId - owning site (recorded on every delivery row).
 * @param timestamp - signing timestamp (injected so the signature base is deterministic).
 * @returns counts of delivered / failed / skipped endpoints + total attempts.
 *
 * @example
 * const outcome = await dispatchEvent(deps, { type: 'site.published', payload: { siteId } }, endpoints, siteId, new Date().toISOString());
 */
export async function dispatchEvent(
  deps: DispatchDeps,
  event: { type: string; payload: unknown },
  endpoints: DispatchEndpoint[],
  siteId: string,
  timestamp: string,
): Promise<DispatchOutcome> {
  const plan = planDeliveries(event, endpoints, timestamp);
  const secretById = new Map(endpoints.map((e) => [e.id, e.secretEncrypted]));

  let delivered = 0;
  let failed = 0;
  let attempts = 0;

  for (const delivery of plan.deliveries) {
    const enc = secretById.get(delivery.endpointId);
    if (!enc) {
      // Planner matched an endpoint with no stored secret — treat as a failed
      // attempt so it surfaces in the delivery log, never silently dropped.
      attempts++;
      failed++;
      await deps.record({
        endpointId: delivery.endpointId,
        siteId,
        eventType: event.type,
        statusCode: 0,
        ok: false,
        attempt: 1,
        error: 'missing_secret',
      });
      continue;
    }

    let signature: string;
    try {
      const secret = await deps.decrypt(enc);
      signature = await deps.sign(secret, delivery.signatureBase);
    } catch {
      attempts++;
      failed++;
      await deps.record({
        endpointId: delivery.endpointId,
        siteId,
        eventType: event.type,
        statusCode: 0,
        ok: false,
        attempt: 1,
        error: 'sign_error',
      });
      continue;
    }

    let attempt = 1;
    for (;;) {
      attempts++;
      const res = await attemptDelivery(deps.fetchFn, delivery, signature);
      await deps.record({
        endpointId: delivery.endpointId,
        siteId,
        eventType: event.type,
        statusCode: res.statusCode,
        ok: res.ok,
        attempt,
        error: res.error,
      });

      if (res.ok) {
        delivered++;
        break;
      }
      // An unsafe_url outcome is a PERMANENT SSRF block (statusCode 0 but NOT a
      // transient network error) — never retry it.
      if (res.error === 'unsafe_url' || !shouldRetry(attempt, res.statusCode)) {
        failed++;
        break;
      }
      await deps.sleep(nextRetryDelayMs(attempt));
      attempt++;
    }
  }

  return { delivered, failed, skipped: plan.skipped.length, attempts };
}
