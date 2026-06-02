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

import type { Env } from '../types/env.js';
import { dbQuery, dbExecute } from './db.js';
import { encrypt } from './ai_crypto.js';

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

/** True when `host` is a private/reserved IPv4 literal (SSRF-blocked). */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-host / private / loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * SSRF guard for a webhook destination — call BEFORE fetching a customer URL in
 * the dispatcher. Requires https and rejects localhost, `.local`/`.localhost`,
 * IPv6 loopback/link-local/ULA, and private/reserved IPv4 literals (incl. the
 * cloud metadata endpoint 169.254.169.254).
 *
 * Note: this blocks literal-IP + obvious-name SSRF. A hostname that DNS-resolves
 * to a private IP (DNS rebinding) needs connect-time IP pinning — a deeper
 * hardening tracked for the dispatcher.
 */
export function isSafeWebhookUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return false; // IPv6 loopback
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false; // link-local / ULA
  if (isPrivateIPv4(host)) return false;

  return true;
}

export interface StoredEndpoint {
  id: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
}
export interface CreateEndpointResult {
  ok: boolean;
  id?: string;
  /** Plaintext signing secret — returned ONCE at creation, never stored unencrypted. */
  secret?: string;
  errors?: string[];
}

/** Validate, generate + encrypt a signing secret, and persist a subscription (org+site scoped). */
export async function createWebhookEndpoint(
  env: Env,
  orgId: string,
  siteId: string,
  url: string,
  eventTypes: string[],
): Promise<CreateEndpointResult> {
  const v = validateEndpointInput(url, eventTypes);
  if (!v.ok) return { ok: false, errors: v.errors };

  const secret = `whsec_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  const secretEncrypted = await encrypt(env, secret);
  const id = crypto.randomUUID();
  const res = await dbExecute(
    env.DB,
    `INSERT INTO webhook_endpoints (id, site_id, org_id, url, secret_encrypted, event_types)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, siteId, orgId, url, secretEncrypted, JSON.stringify(eventTypes)],
  );
  if (res.error) return { ok: false, errors: [res.error] };
  return { ok: true, id, secret };
}

/** List a site's endpoints (org+site scoped) — NEVER includes the secret. */
export async function listWebhookEndpoints(env: Env, orgId: string, siteId: string): Promise<StoredEndpoint[]> {
  const { data } = await dbQuery<{ id: string; url: string; event_types: string; enabled: number }>(
    env.DB,
    `SELECT id, url, event_types, enabled FROM webhook_endpoints
     WHERE org_id = ? AND site_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    [orgId, siteId],
  );
  return data.map((r) => ({
    id: r.id,
    url: r.url,
    eventTypes: JSON.parse(r.event_types) as string[],
    enabled: r.enabled === 1,
  }));
}

export interface EndpointForDispatch {
  id: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
}
export interface PlannedDelivery {
  endpointId: string;
  url: string;
  /** The exact JSON body to POST (the signature covers `timestamp.body`). */
  body: string;
  timestamp: string;
  /** `signedPayloadBase(timestamp, body)` — HMAC this with the endpoint's secret. */
  signatureBase: string;
}
export interface DispatchPlan {
  deliveries: PlannedDelivery[];
  skipped: Array<{ endpointId: string; reason: 'disabled' | 'not_subscribed' | 'unsafe_url' }>;
}

/**
 * Pure dispatch planner: given an event + the site's endpoints, compute which
 * deliveries to attempt and which to skip (disabled / not subscribed to this
 * event / SSRF-unsafe URL). The worker dispatcher then, per delivery, decrypts
 * the endpoint secret, HMACs `signatureBase`, and POSTs `body` with the
 * signature header — retrying via `shouldRetry`/`nextRetryDelayMs`.
 *
 * Pure (timestamp injected) so the match + skip logic is unit-testable.
 */
export function planDeliveries(
  event: { type: string; payload: unknown },
  endpoints: EndpointForDispatch[],
  timestamp: string,
): DispatchPlan {
  const body = JSON.stringify({ type: event.type, payload: event.payload, timestamp });
  const deliveries: PlannedDelivery[] = [];
  const skipped: DispatchPlan['skipped'] = [];

  for (const e of endpoints) {
    if (!e.enabled) {
      skipped.push({ endpointId: e.id, reason: 'disabled' });
      continue;
    }
    if (!e.eventTypes.includes(event.type)) {
      skipped.push({ endpointId: e.id, reason: 'not_subscribed' });
      continue;
    }
    if (!isSafeWebhookUrl(e.url)) {
      skipped.push({ endpointId: e.id, reason: 'unsafe_url' });
      continue;
    }
    deliveries.push({
      endpointId: e.id,
      url: e.url,
      body,
      timestamp,
      signatureBase: signedPayloadBase(timestamp, body),
    });
  }

  return { deliveries, skipped };
}

/** Soft-delete an endpoint (org+site scoped). `ok:false` when nothing matched. */
export async function deleteWebhookEndpoint(
  env: Env,
  orgId: string,
  siteId: string,
  id: string,
): Promise<{ ok: boolean }> {
  const res = await dbExecute(
    env.DB,
    "UPDATE webhook_endpoints SET deleted_at = datetime('now') WHERE id = ? AND org_id = ? AND site_id = ? AND deleted_at IS NULL",
    [id, orgId, siteId],
  );
  return { ok: !res.error && res.changes > 0 };
}
