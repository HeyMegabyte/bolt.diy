/**
 * W3C Trace Context (OTel) helpers for the Project Sites Worker.
 *
 * Pure functions — no external deps, no imports needed. Parses and generates
 * W3C `traceparent` headers so every log event carries a stable `trace_id`
 * that correlates across Workers Tracing, Axiom, and Sentry.
 *
 * @module observability/otel
 * @see {@link https://www.w3.org/TR/trace-context/}
 */

import type { AppLogContext } from './context.js';

/**
 * W3C traceparent format:
 *   `{version}-{traceId}-{parentId}-{flags}`
 *   version  = 2 hex chars (currently "00")
 *   traceId  = 32 hex chars (128-bit)
 *   parentId = 16 hex chars (64-bit)
 *   flags    = 2 hex chars
 * @internal
 */
const TRACEPARENT_RE = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i;

/**
 * Enrich a log context with the W3C `trace_id` extracted from an incoming
 * `traceparent` header. Returns the original context unchanged if the header
 * is absent or malformed.
 *
 * @param headers - Incoming HTTP request headers.
 * @param base    - Existing log context to enrich.
 * @returns A new `AppLogContext` with `trace_id` added, or `base` unchanged.
 *
 * @example
 * ```ts
 * // In a Hono middleware:
 * const ctx = withTraceContext(c.req.raw.headers, {
 *   service: 'api',
 *   environment: env.ENVIRONMENT ?? 'production',
 *   request_id: c.get('requestId'),
 * });
 * const log = createLogger(env, executionCtx, ctx);
 * ```
 */
export function withTraceContext(headers: Headers, base: AppLogContext): AppLogContext {
  const raw = headers.get('traceparent');
  if (!raw) return base;

  const match = TRACEPARENT_RE.exec(raw.trim());
  if (!match) return base;

  const traceId = match[1];
  return { ...base, trace_id: traceId };
}

/**
 * Build a valid W3C `traceparent` header value for the given `traceId`.
 * Uses version `00`, a zeroed parent-id, and sampled flag `01`.
 *
 * @param traceId - 32-character lowercase hex trace identifier.
 * @returns A traceparent string like `00-{traceId}-0000000000000000-01`.
 *
 * @example
 * ```ts
 * const traceId = crypto.randomUUID().replace(/-/g, '');
 * const header  = traceparentFor(traceId);
 * // → "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01"
 * ```
 */
export function traceparentFor(traceId: string): string {
  return `00-${traceId}-0000000000000000-01`;
}
