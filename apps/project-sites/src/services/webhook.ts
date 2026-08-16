/**
 * @module webhook
 * @description Generic webhook ingestion framework for Cloudflare D1 (SQLite).
 *
 * Provides signature verification, idempotency checking, event storage, and
 * status tracking for inbound webhooks from multiple providers (Stripe, Dub,
 * Chatwoot, Novu, Lago).
 *
 * ## Processing pipeline
 *
 * 1. **Verify signature** - cryptographic proof the payload is authentic
 * 2. **Check idempotency** - prevent duplicate processing via `provider + event_id`
 * 3. **Store event** - persist raw metadata for replay / debugging
 * 4. **Process** - execute business logic (handled by the caller)
 * 5. **Mark processed** - update status to `processed` or `failed`
 *
 * ## Usage
 *
 * ```ts
 * import {
 *   verifyStripeSignature,
 *   checkWebhookIdempotency,
 *   storeWebhookEvent,
 *   markWebhookProcessed,
 * } from '../services/webhook.js';
 *
 * const verification = await verifyStripeSignature(rawBody, sigHeader, secret);
 * if (!verification.valid) return c.json({ error: verification.reason }, 401);
 *
 * const { isDuplicate } = await checkWebhookIdempotency(env.DB, 'stripe', eventId);
 * if (isDuplicate) return c.json({ status: 'duplicate' }, 200);
 *
 * const { id, error } = await storeWebhookEvent(env.DB, {
 *   provider: 'stripe',
 *   event_id: eventId,
 *   event_type: 'invoice.paid',
 * });
 *
 * // ... process event ...
 *
 * await markWebhookProcessed(env.DB, id!, 'processed');
 * ```
 *
 * @packageDocumentation
 */

import { type WebhookProvider, hmacSha256, timingSafeEqual } from '@project-sites/shared';
import { dbQueryOne, dbInsert, dbUpdate, dbExecute } from './db.js';

/**
 * Terminal `webhook_events.status` values — an event in one of these states must NOT be
 * reprocessed. `processed` = successfully handled; `quarantined` = deliberately
 * dead-lettered (a poison pill that exhausted its retry budget). Every OTHER stored
 * status (`received` / `processing` / `failed`) is retry-eligible on redelivery.
 */
const TERMINAL_WEBHOOK_STATUSES = new Set(['processed', 'quarantined']);

/**
 * Result of a webhook signature verification attempt.
 *
 * @property valid  - `true` when the cryptographic signature matches.
 * @property reason - Human-readable explanation when `valid` is `false`.
 *
 * @example
 * ```ts
 * const result: WebhookVerificationResult = { valid: false, reason: 'Signature mismatch' };
 * ```
 */
export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a Stripe webhook signature (`Stripe-Signature` header).
 *
 * Stripe signs every webhook payload with HMAC-SHA256 using a per-endpoint
 * secret. The signature header contains a UNIX timestamp (`t`) and one or more
 * versioned signatures (`v1`). This function recomputes the expected `v1`
 * signature and performs a timing-safe comparison.
 *
 * @param rawBody           - The raw request body string (must not be parsed/modified).
 * @param signatureHeader   - Value of the `Stripe-Signature` HTTP header.
 * @param secret            - Webhook signing secret (starts with `whsec_`).
 * @param toleranceSeconds  - Maximum allowed age of the timestamp in seconds (default 300 = 5 min).
 * @returns Verification result indicating whether the signature is valid.
 *
 * @example
 * ```ts
 * const result = await verifyStripeSignature(
 *   rawBody,
 *   request.headers.get('Stripe-Signature') ?? '',
 *   env.STRIPE_WEBHOOK_SECRET,
 * );
 * if (!result.valid) {
 *   return c.json({ error: result.reason }, 401);
 * }
 * ```
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds: number = 300,
): Promise<WebhookVerificationResult> {
  if (!signatureHeader || !secret) {
    return { valid: false, reason: 'Missing signature or secret' };
  }

  const parts = signatureHeader.split(',').reduce(
    (acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  const timestamp = parts['t'];
  const v1Signature = parts['v1'];

  if (!timestamp || !v1Signature) {
    return { valid: false, reason: 'Invalid signature format' };
  }

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (Number.isNaN(ts) || Math.abs(now - ts) > toleranceSeconds) {
    return { valid: false, reason: 'Timestamp outside tolerance' };
  }

  // Compute expected signature
  const payload = `${timestamp}.${rawBody}`;
  const expectedSignature = await hmacSha256(secret, payload);

  if (!timingSafeEqual(v1Signature, expectedSignature)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}

/**
 * Verify a generic HMAC-SHA256 webhook signature.
 *
 * Used by providers that sign payloads with a simple `HMAC-SHA256(secret, body)`
 * and send the hex digest in a header (e.g. Dub, Chatwoot).
 *
 * @param rawBody   - The raw request body string.
 * @param signature - The hex-encoded HMAC signature from the request header.
 * @param secret    - The shared secret configured for this webhook endpoint.
 * @returns Verification result indicating whether the signature is valid.
 *
 * @example
 * ```ts
 * const result = await verifyHmacSignature(
 *   rawBody,
 *   request.headers.get('X-Webhook-Signature') ?? '',
 *   env.DUB_WEBHOOK_SECRET,
 * );
 * if (!result.valid) {
 *   return c.json({ error: result.reason }, 401);
 * }
 * ```
 */
export async function verifyHmacSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<WebhookVerificationResult> {
  if (!signature || !secret) {
    return { valid: false, reason: 'Missing signature or secret' };
  }

  const expected = await hmacSha256(secret, rawBody);

  if (!timingSafeEqual(signature, expected)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}

/**
 * Idempotency guard: is this event ALREADY TERMINALLY HANDLED, or is it retry-eligible?
 *
 * Queries `webhook_events` for the `provider + event_id` pair and classifies by status:
 * - No row → `{ isDuplicate: false }` (first delivery — store + process it).
 * - Terminal row (`processed` / `quarantined`) → `{ isDuplicate: true, existingId }`
 *   (already handled — the caller acks 200 and does NOT reprocess).
 * - Non-terminal row (`received` / `processing` / `failed`) → `{ isDuplicate: false,
 *   existingId, existingStatus, existingAttempts }` — a stored-but-unfinished event that
 *   MUST reprocess on redelivery. The caller reuses `existingId` (via
 *   {@link resetWebhookForRetry}, since `webhook_events` is UNIQUE per provider+event_id)
 *   so a transient processing failure recovers instead of being stranded forever.
 *
 * @remarks A plain "any row = duplicate" check silently strands failed webhooks: a
 *   `checkout.session.completed` that fails processing once would be skipped on every
 *   redelivery, so the customer is charged but never upgraded.
 *
 * @param db       - The D1Database binding from `env.DB`.
 * @param provider - Webhook provider name (e.g. `'stripe'`, `'dub'`).
 * @param eventId  - Provider-specific event identifier (e.g. `evt_1abc...`).
 * @returns `isDuplicate` (terminal only), plus `existingId` / `existingStatus` /
 *   `existingAttempts` when a row exists.
 *
 * @example
 * ```ts
 * const idem = await checkWebhookIdempotency(env.DB, 'stripe', event.id);
 * if (idem.isDuplicate) return c.json({ received: true, duplicate: true }, 200);
 * ```
 */
export async function checkWebhookIdempotency(
  db: D1Database,
  provider: WebhookProvider,
  eventId: string,
): Promise<{
  isDuplicate: boolean;
  existingId?: string;
  existingStatus?: string;
  existingAttempts?: number;
}> {
  const row = await dbQueryOne<{ id: string; status: string; attempts: number }>(
    db,
    'SELECT id, status, attempts FROM webhook_events WHERE provider = ? AND event_id = ?',
    [provider, eventId],
  );

  if (!row) {
    return { isDuplicate: false };
  }

  if (TERMINAL_WEBHOOK_STATUSES.has(row.status)) {
    return { isDuplicate: true, existingId: row.id };
  }

  // Stored but not terminally handled — reprocess on redelivery.
  return {
    isDuplicate: false,
    existingId: row.id,
    existingStatus: row.status,
    existingAttempts: row.attempts,
  };
}

/**
 * Persist a webhook event record for auditing, replay, and debugging.
 *
 * Inserts a new row into the `webhook_events` table with a pre-generated UUID.
 * The returned `id` can be passed to {@link markWebhookProcessed} after the
 * event has been handled.
 *
 * @param db    - The D1Database binding from `env.DB`.
 * @param event - Webhook event metadata to store.
 * @param event.provider      - Webhook provider name.
 * @param event.event_id      - Provider-specific event identifier.
 * @param event.event_type    - Event type string (e.g. `'invoice.paid'`).
 * @param event.org_id        - Optional organization ID this event belongs to.
 * @param event.payload_hash  - Optional SHA-256 hash of the raw payload body.
 * @param event.status        - Initial status (defaults to `'received'`).
 * @returns Object with the generated `id` (or `null` on error) and an `error` string.
 *
 * @example
 * ```ts
 * const { id, error } = await storeWebhookEvent(env.DB, {
 *   provider: 'stripe',
 *   event_id: 'evt_1NqR3z2eZv...',
 *   event_type: 'invoice.paid',
 *   org_id: orgId,
 * });
 * if (error) {
 *   console.warn('[webhook] failed to store event', { error });
 *   return c.json({ error: 'storage_failed' }, 500);
 * }
 * ```
 */
export async function storeWebhookEvent(
  db: D1Database,
  event: {
    provider: WebhookProvider;
    event_id: string;
    event_type: string;
    org_id?: string;
    payload_hash?: string;
    status?: string;
  },
): Promise<{ id: string | null; error: string | null }> {
  const id = crypto.randomUUID();

  const row = {
    id,
    provider: event.provider,
    event_id: event.event_id,
    event_type: event.event_type,
    org_id: event.org_id ?? null,
    payload_hash: event.payload_hash ?? null,
    status: event.status ?? 'received',
    // 1 = this is the first processing attempt. `resetWebhookForRetry` bumps it on each
    // redelivery; the count drives the quarantine-after-max-attempts poison-pill guard.
    attempts: 1,
    deleted_at: null,
  };

  const result = await dbInsert(db, 'webhook_events', row);

  if (result.error) {
    return { id: null, error: result.error };
  }

  return { id, error: null };
}

/**
 * Update the status of a previously stored webhook event.
 *
 * Typically called after the event has been fully processed (or has failed).
 * Sets `processed_at` to the current timestamp alongside the new status.
 *
 * @param db           - The D1Database binding from `env.DB`.
 * @param eventId      - The UUID of the `webhook_events` row (returned by {@link storeWebhookEvent}).
 * @param status       - Terminal-ish outcome: `'processed'` on success, `'failed'` on a
 *   retry-eligible error, `'quarantined'` when the retry budget is exhausted (poison pill).
 * @param errorMessage - Optional error message to persist when `status` is `'failed'` / `'quarantined'`.
 *
 * @example
 * ```ts
 * try {
 *   await handleStripeInvoicePaid(env, payload);
 *   await markWebhookProcessed(env.DB, webhookId, 'processed');
 * } catch (err) {
 *   await markWebhookProcessed(env.DB, webhookId, 'failed', String(err));
 * }
 * ```
 */
export async function markWebhookProcessed(
  db: D1Database,
  eventId: string,
  status: 'processed' | 'failed' | 'quarantined' = 'processed',
  errorMessage?: string,
): Promise<void> {
  const { error } = await dbUpdate(
    db,
    'webhook_events',
    {
      status,
      processed_at: new Date().toISOString(),
      error_message: errorMessage ?? null,
    },
    'id = ?',
    [eventId],
  );
  // This is the webhook OUTCOME marker, called on both the success path AND inside
  // the route's catch. A throw here would mask the original error (catch-path call)
  // or turn a fully-processed webhook into a 500 (success-path call) — so never
  // throw. But a SILENT drop hides the outcome from monitoring, the exact thing
  // this row exists to record, so surface the write failure to logs.
  if (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'webhook',
        message: 'mark_webhook_processed_write_failed',
        event_id: eventId,
        target_status: status,
        error,
      }),
    );
  }
}

/**
 * Reset a stored non-terminal webhook event back to `processing` for a redelivery,
 * incrementing its attempt counter.
 *
 * @remarks
 * `webhook_events` is `UNIQUE (provider, event_id)`, so a redelivery cannot INSERT a
 * fresh row — the existing row is REUSED. This resets it to `processing` and bumps
 * `attempts` (the count that drives the quarantine-after-max poison-pill guard) so a
 * previously-`failed` (or crashed-mid-flight `processing`) event reprocesses cleanly.
 *
 * @param db      - The D1Database binding from `env.DB`.
 * @param eventId - The `webhook_events` row id (from {@link checkWebhookIdempotency}).
 * @returns `{ error }` — the D1 error string, or `null` on success. Never throws.
 *
 * @example
 * ```ts
 * const { error } = await resetWebhookForRetry(env.DB, idem.existingId!);
 * ```
 * @see {@link checkWebhookIdempotency}
 */
export async function resetWebhookForRetry(
  db: D1Database,
  eventId: string,
): Promise<{ error: string | null }> {
  const { error } = await dbExecute(
    db,
    `UPDATE webhook_events SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), eventId],
  );
  return { error };
}
