/**
 * @module services/trace_propagation
 * @description AP17 — cross-boundary trace correlation. Builds the outgoing
 * HTTP headers + structured-log context that propagate `traceId`/`requestId`/
 * `tenantId` across worker↔container↔service boundaries so every log line in
 * the stack carries the same correlation triple. Pure: the caller supplies the
 * IDs; this layer formats the headers + context. Never throws.
 *
 * @packageDocumentation
 */

/** The correlation triple we propagate everywhere. */
export interface TraceContext {
  readonly traceId: string;
  readonly requestId: string;
  /** tenant / org / site — scoped to what makes sense for the call. */
  readonly tenantId?: string;
  /** Service emitting the outbound call, e.g. `worker` / `container` / `plane`. */
  readonly caller?: string;
}

/** Standard cross-service trace headers. */
export interface TraceHeaders {
  readonly 'x-trace-id': string;
  readonly 'x-request-id': string;
  readonly 'x-tenant-id'?: string;
  readonly 'x-caller'?: string;
}

/** A Hono/JWT-compatible `c.set()` context block for structured logging. */
export interface TraceLogContext {
  readonly traceId: string;
  readonly requestId: string;
  readonly tenantId?: string;
  readonly caller?: string;
}

/**
 * Build the outgoing HTTP header bag for a cross-boundary call. All headers
 * follow the W3C `x-` convention — W3C `traceparent` adoption is a follow-on.
 *
 * @param ctx - {@link TraceContext}.
 * @returns {@link TraceHeaders}.
 *
 * @example
 * propagateHeaders({ traceId:'t1', requestId:'r1', tenantId:'o1', caller:'worker' })
 * // → { 'x-trace-id':'t1', 'x-request-id':'r1', 'x-tenant-id':'o1', 'x-caller':'worker' }
 */
export function propagateHeaders(ctx: TraceContext): Record<string, string> {
  const h: Record<string, string> = {
    'x-trace-id': ctx.traceId,
    'x-request-id': ctx.requestId,
  };
  const tenant = ctx.tenantId?.trim();
  if (tenant) h['x-tenant-id'] = tenant;
  const caller = ctx.caller?.trim();
  if (caller) h['x-caller'] = caller;
  return h;
}

/**
 * Build a structured-log context block (for `c.set('traceContext',...)` or
 * `log.child(...)`) so every log line inside a handler carries the propagated
 * triple.
 *
 * @param ctx - {@link TraceContext} or a partial from an inbound call.
 * @returns {@link TraceLogContext}.
 *
 * @example
 * traceLogContext({ traceId: crypto.randomUUID(), requestId: cf.request.id })
 */
export function traceLogContext(ctx: TraceContext): Record<string, string> {
  const c: Record<string, string> = {
    traceId: (ctx.traceId ?? '').trim() || 'unknown',
    requestId: (ctx.requestId ?? '').trim() || 'unknown',
  };
  const tenant = ctx.tenantId?.trim();
  if (tenant) c.tenantId = tenant;
  const caller = ctx.caller?.trim();
  if (caller) c.caller = caller;
  return c;
}

/**
 * Parse inbound trace headers from a fetch/HTTP request into a
 * {@link TraceContext}. Prefer `x-` headers; fall back to W3C `traceparent`
 * (partial — span extraction omitted).
 *
 * @param headers - Request headers (e.g. `new Headers(request.headers)`).
 * @returns {@link TraceContext}.
 *
 * @example
 * parseInboundTrace(new Headers({ 'x-trace-id': 't1' })).traceId // → 't1'
 */
export function parseInboundTrace(headers: Headers): TraceContext {
  const get = (h: Headers, ...keys: string[]): string =>
    keys.reduce((v, k) => v || h.get(k)?.trim() || '', '');

  let traceId = get(headers, 'x-trace-id', 'cf-ray');
  if (!traceId) {
    // Minimal W3C traceparent: version-traceId-spanId-flags
    const tp = headers.get('traceparent')?.trim();
    if (tp) {
      const parts = tp.split('-');
      traceId = parts[1] ?? '';
      if (traceId.length > 32) traceId = traceId.slice(0, 32);
    }
  }
  return {
    traceId: traceId || 'unknown',
    requestId: get(headers, 'x-request-id', 'cf-request-id') || 'unknown',
    tenantId: get(headers, 'x-tenant-id') || undefined,
    caller: get(headers, 'x-caller') || undefined,
  };
}
