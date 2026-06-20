/**
 * @module libs/features/observability_gateway/service
 * @description Pure helpers for the Customer-Site Observability Gateway.
 *
 * All functions are side-effect-free and fully injectable — D1/KV/fetch are
 * passed in so Jest can substitute stubs without module-level mocking.
 *
 * @remarks
 * Three responsibilities:
 *   1. **PII redaction** — strip email, phone, IP-like, and common PII field
 *      names from any nested JSON object before it leaves the Worker.
 *   2. **Deterministic sampling** — keep/drop based on event id hash (no
 *      `Math.random()` — Workers ban the zero-arg form; we hash the event id
 *      with a simple djb2 variant against a 0-100 rate bucket).
 *   3. **Quota gating** — KV hourly counter per site; reject over cap with 429.
 *
 * @packageDocumentation
 */

import type { MonitoringProvider, QuotaState } from './schemas.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FLAG_KEY = 'observability_gateway';

/** Default keep-rate (100 = keep everything, 50 = keep half). */
export const DEFAULT_SAMPLE_RATE = 100;

/** Maximum events per site per hour before 429. */
export const HOURLY_QUOTA = 10_000;

/** KV TTL for the quota counter (2 hours to span the rollover boundary). */
const QUOTA_TTL_SECONDS = 7200;

// ---------------------------------------------------------------------------
// PII redaction
// ---------------------------------------------------------------------------

/**
 * Field-name patterns whose values are always redacted (replaced with '[REDACTED]').
 * Matching is case-insensitive on the key name.
 */
const PII_FIELD_PATTERNS = [
  /^email$/i,
  /^email_address$/i,
  /^phone$/i,
  /^phone_number$/i,
  /^mobile$/i,
  /^ip$/i,
  /^ip_address$/i,
  /^ipAddress$/i,
  /^user_ip$/i,
  /^remote_addr$/i,
  /^x-forwarded-for$/i,
  /^ssn$/i,
  /^dob$/i,
  /^date_of_birth$/i,
  /^credit_card$/i,
  /^card_number$/i,
];

/**
 * Value-level regex patterns — any string value matching these is redacted
 * even if the key name is not in the blocklist.
 */
const PII_VALUE_PATTERNS = [
  // E-mail addresses
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  // Phone numbers (E.164 or common US formats)
  /(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/,
  // IPv4 addresses
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
];

/**
 * Recursively redact PII from any JSON-serialisable value.
 *
 * @param value - The value to inspect (object, array, or primitive).
 * @returns A deep clone with PII fields replaced by `'[REDACTED]'`.
 *
 * @example
 * redactPii({ email: 'a@b.com', name: 'Alice' })
 * // → { email: '[REDACTED]', name: 'Alice' }
 */
export function redactPii(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    // Primitive — redact string values that look like PII
    if (typeof value === 'string') {
      for (const pattern of PII_VALUE_PATTERNS) {
        if (pattern.test(value)) return '[REDACTED]';
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redactPii);
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const isBlocklisted = PII_FIELD_PATTERNS.some((p) => p.test(k));
    out[k] = isBlocklisted ? '[REDACTED]' : redactPii(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic sampling
// ---------------------------------------------------------------------------

/**
 * djb2-style hash of a string → unsigned 32-bit integer.
 * No external deps; Workers-compatible (no `node:crypto` or `Math.random`).
 *
 * @param s - Input string.
 * @returns Unsigned 32-bit integer hash.
 *
 * @example
 * djb2Hash('evt-abc') // → some stable number 0..4294967295
 */
export function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // djb2: h = h * 33 ^ char  (use >>> 0 to keep unsigned)
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Deterministically decide whether to keep an event.
 *
 * @param eventId - Stable event identifier (Sentry `event_id`, PostHog `uuid`).
 * @param keepPercent - Integer 0-100; 100 = always keep, 0 = always drop.
 * @returns `true` if the event should be forwarded.
 *
 * @example
 * shouldKeep('evt-abc123', 50) // stable true/false based on hash
 * shouldKeep('evt-abc123', 100) // → true (always)
 * shouldKeep('evt-abc123', 0)   // → false (always)
 */
export function shouldKeep(eventId: string, keepPercent: number): boolean {
  if (keepPercent >= 100) return true;
  if (keepPercent <= 0) return false;
  // Map hash to 0..99 bucket
  const bucket = djb2Hash(eventId) % 100;
  return bucket < keepPercent;
}

// ---------------------------------------------------------------------------
// Hourly quota counter (KV)
// ---------------------------------------------------------------------------

/**
 * Build the KV key for the per-site hourly quota counter.
 *
 * @param siteId - Site UUID.
 * @param nowMs - Current epoch milliseconds (injectable for testing).
 * @returns KV key string of the form `monitor:{siteId}:{yyyymmddhh}`.
 *
 * @example
 * quotaKey('site-001', new Date('2026-06-19T14:00:00Z').getTime())
 * // → 'monitor:site-001:2026061914'
 */
export function quotaKey(siteId: string, nowMs: number): string {
  const d = new Date(nowMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `monitor:${siteId}:${yyyy}${mm}${dd}${hh}`;
}

/**
 * Increment the KV quota counter for a site and check whether the cap is exceeded.
 *
 * @param kv - KVNamespace (injectable for testing).
 * @param siteId - Site UUID.
 * @param cap - Maximum events per hour before returning `exceeded: true`.
 * @param nowMs - Current epoch milliseconds (injectable for testing).
 * @returns `{ exceeded: boolean; count: number }` — the new count after increment.
 *
 * @example
 * const { exceeded } = await checkAndIncrementQuota(kv, 'site-001', 10_000, Date.now());
 * if (exceeded) return c.json({ error: 'rate limited' }, 429);
 */
export async function checkAndIncrementQuota(
  kv: KVNamespace,
  siteId: string,
  cap: number,
  nowMs: number,
): Promise<{ exceeded: boolean; count: number }> {
  const key = quotaKey(siteId, nowMs);
  const raw = await kv.get(key, 'json') as QuotaState | null;
  const current = raw?.count ?? 0;

  if (current >= cap) {
    return { exceeded: true, count: current };
  }

  const next = current + 1;
  await kv.put(key, JSON.stringify({ count: next } satisfies QuotaState), {
    expirationTtl: QUOTA_TTL_SECONDS,
  });
  return { exceeded: false, count: next };
}

// ---------------------------------------------------------------------------
// Vendor endpoint resolution
// ---------------------------------------------------------------------------

const SENTRY_INGEST_BASE = 'https://sentry.io/api';
const POSTHOG_INGEST_BASE = 'https://us.i.posthog.com';

/**
 * Build the vendor ingest URL for the given provider and env.
 *
 * @param provider - 'sentry' or 'posthog'.
 * @param env - Partial env (injectable subset for testing).
 * @returns The fully-qualified ingest URL.
 *
 * @example
 * vendorIngestUrl('posthog', { POSTHOG_PROJECT_ID: '123' })
 * // → 'https://us.i.posthog.com/capture/'
 */
export function vendorIngestUrl(
  provider: MonitoringProvider,
  env: { SENTRY_PROJECT_ID?: string; SENTRY_PROJECT_KEY?: string },
): string {
  if (provider === 'sentry') {
    const projectId = env.SENTRY_PROJECT_ID ?? '0';
    return `${SENTRY_INGEST_BASE}/${projectId}/store/`;
  }
  // posthog
  return `${POSTHOG_INGEST_BASE}/capture/`;
}

// ---------------------------------------------------------------------------
// Analytics Engine rollup (best-effort, graceful when binding absent)
// ---------------------------------------------------------------------------

/**
 * Write a rollup datapoint to Analytics Engine.
 * Silently no-ops when the `ANALYTICS` binding is absent (dev environment).
 *
 * @param ae - Optional AnalyticsEngineDataset binding.
 * @param provider - 'sentry' or 'posthog'.
 * @param orgId - Tenant org UUID.
 * @param siteId - Site UUID.
 *
 * @example
 * writeRollup(env.ANALYTICS, 'sentry', 'org-abc', 'site-xyz');
 */
export function writeRollup(
  ae: { writeDataPoint(data: { blobs?: (string | null)[]; doubles?: number[]; indexes?: string[] }): void } | undefined,
  provider: MonitoringProvider,
  orgId: string,
  siteId: string,
): void {
  if (!ae) return; // binding absent — silently skip
  ae.writeDataPoint({
    blobs: [provider, orgId, siteId],
    doubles: [1],
    indexes: [`${orgId}:${siteId}`],
  });
}
