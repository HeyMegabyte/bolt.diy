/**
 * @module services/outbound_webhooks
 * @description Core delivery policy for Outbound Webhooks (build-first module
 * #10, P1) — customers subscribe their own endpoints to site events, delivered
 * with a signed payload + bounded retries (Svix/Stripe-style).
 *
 * This slice is the pure, deterministic heart: the signed-payload construction
 * (replay-safe — signature covers a timestamp + body), the exponential backoff
 * schedule, and the retry decision. The async HTTP send + HMAC (reusing the
 * shared `hmacSha256` helper) + the endpoint/delivery persistence land in slice
 * 2. Keeping the policy pure makes the security-critical rules unit-testable.
 *
 * @packageDocumentation
 */

/** Max delivery attempts before a delivery is marked permanently failed. */
export const MAX_DELIVERY_ATTEMPTS = 6;
/** First-retry delay; each subsequent attempt doubles up to {@link MAX_RETRY_DELAY_MS}. */
export const BASE_RETRY_DELAY_MS = 1000;
/** Cap on a single retry delay (1 hour). */
export const MAX_RETRY_DELAY_MS = 3_600_000;

/**
 * The exact string the signature is computed over: `<timestamp>.<body>`. Binding
 * the timestamp into the signed material is what makes a captured payload
 * un-replayable (the receiver rejects a stale timestamp).
 */
export function signedPayloadBase(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

/** Svix/Stripe-style signature header value: `t=<timestamp>,v1=<hex>`. */
export function buildSignatureHeader(timestamp: string, signatureHex: string): string {
  return `t=${timestamp},v1=${signatureHex}`;
}

/**
 * Backoff delay (ms) before the given 1-based attempt's retry: exponential
 * (`BASE * 2^(attempt-1)`) capped at {@link MAX_RETRY_DELAY_MS}. Deterministic
 * (no jitter) so the schedule is testable; slice 2 may add jitter at send time.
 */
export function nextRetryDelayMs(attempt: number): number {
  const exp = BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(exp, MAX_RETRY_DELAY_MS);
}

/** A 2xx response means the endpoint accepted the delivery. */
export function isDeliverySuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

/**
 * Whether a failed attempt should be retried. Retries are bounded by
 * {@link MAX_DELIVERY_ATTEMPTS} and only fire for transient failures:
 * network error (`statusCode === 0`), `429`, or any `5xx`. A non-429 `4xx` is a
 * permanent client error (bad URL, auth) — never retried (don't hammer).
 *
 * @param attempt - 1-based attempt number that just failed.
 * @param statusCode - HTTP status (use `0` for a network-level failure).
 */
export function shouldRetry(attempt: number, statusCode: number): boolean {
  if (attempt >= MAX_DELIVERY_ATTEMPTS) return false;
  if (isDeliverySuccess(statusCode)) return false;
  if (statusCode === 0 || statusCode === 429 || statusCode >= 500) return true;
  return false; // permanent 4xx
}

/** Site events a customer endpoint may subscribe to (allowlist). */
export const WEBHOOK_EVENT_TYPES = [
  'site.published',
  'form.submitted',
  'payment.succeeded',
  'review.received',
  'build.failed',
  'domain.active',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface EndpointValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a subscription before persisting: the URL must be a valid **https**
 * URL (no plaintext delivery), and every event must be on the allowlist (a typo
 * can't subscribe to a phantom event). SSRF hardening (block internal/localhost
 * hosts) is a noted follow-up for the dispatch slice.
 */
export function validateEndpointInput(url: string, eventTypes: string[]): EndpointValidation {
  const errors: string[] = [];

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    errors.push('Endpoint URL is not a valid URL.');
  }
  if (parsed && parsed.protocol !== 'https:') errors.push('Endpoint URL must use https.');

  if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
    errors.push('Subscribe to at least one event type.');
  } else {
    for (const e of eventTypes) {
      if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e)) {
        errors.push(`Unknown event "${e}". Allowed: ${WEBHOOK_EVENT_TYPES.join(', ')}.`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Mask a signing secret for display (show only the last 4 chars). */
export function maskSecret(secret: string): string {
  return secret.length <= 4 ? '••••' : `••••${secret.slice(-4)}`;
}
