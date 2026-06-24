/**
 * @module middleware/tracing
 *
 * @description
 * OTLP/HTTP exporter + factory for the §35 OpenTelemetry span port. Buffers
 * finished spans and ships them as OTLP/HTTP JSON (no `@opentelemetry/*` SDK —
 * pure fetch, Workers-native) to `OTEL_EXPORTER_OTLP_ENDPOINT`. With no endpoint
 * configured the factory returns {@link NoopTracerProvider} (ships dark; CF Workers
 * Tracing remains the always-on backbone — see ADR-0035).
 *
 * @see platform/tracing.ts (the port + Noop + Fake)
 */
import { z } from 'zod';
import type { Env } from '../types/env.js';
import {
  NoopTracerProvider,
  RecordingSpan,
  type FinishedSpan,
  type SpanKind,
  type SpanStatus,
  type Tracer,
  type TracerProvider,
} from '../platform/tracing.js';

const OtlpConfigSchema = z.object({
  endpoint: z.string().url(),
  headers: z.record(z.string()).default({}),
});
type OtlpConfig = z.infer<typeof OtlpConfigSchema>;

/** Parse `k=v,k2=v2` OTLP header config into a record (empty on malformed). */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

const KIND_CODE: Record<SpanKind, number> = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
};
const STATUS_CODE: Record<SpanStatus, number> = { unset: 0, ok: 1, error: 2 };

function attrsToOtlp(attrs: Record<string, string | number | boolean>) {
  return Object.entries(attrs).map(([key, v]) => ({
    key,
    value:
      typeof v === 'boolean'
        ? { boolValue: v }
        : typeof v === 'number'
          ? Number.isInteger(v)
            ? { intValue: String(v) }
            : { doubleValue: v }
          : { stringValue: v },
  }));
}

/** Build an OTLP/HTTP JSON `resourceSpans` payload, grouping by instrumentation scope. */
export function buildOtlpPayload(spans: readonly FinishedSpan[], serviceName = 'project-sites') {
  const byScope = new Map<string, FinishedSpan[]>();
  for (const s of spans) (byScope.get(s.scope) ?? byScope.set(s.scope, []).get(s.scope)!).push(s);
  const ms2ns = (ms: number) => String(Math.round(ms * 1_000_000));
  return {
    resourceSpans: [
      {
        resource: { attributes: attrsToOtlp({ 'service.name': serviceName }) },
        scopeSpans: [...byScope.entries()].map(([scope, ss]) => ({
          scope: { name: scope },
          spans: ss.map((s) => ({
            traceId: s.traceId,
            spanId: s.spanId,
            ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
            name: s.name,
            kind: KIND_CODE[s.kind],
            startTimeUnixNano: ms2ns(s.startTimeMs),
            endTimeUnixNano: ms2ns(s.endTimeMs),
            attributes: attrsToOtlp(s.attributes),
            status: {
              code: STATUS_CODE[s.status],
              ...(s.statusMessage ? { message: s.statusMessage } : {}),
            },
          })),
        })),
      },
    ],
  };
}

/** OTLP/HTTP JSON exporter provider. Buffers spans; `flush()` POSTs them. */
export class OtlpTracerProvider implements TracerProvider {
  readonly name = 'otlp-http-tracer';
  private readonly buffer: FinishedSpan[] = [];
  constructor(
    private readonly config: OtlpConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getTracer(scope: string): Tracer {
    return {
      startSpan: (name, options = {}) =>
        new RecordingSpan(
          name,
          scope,
          options,
          options.startTimeMs ?? Date.now(),
          (s) => this.buffer.push(s),
          Date.now(),
        ),
    };
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.fetchImpl(this.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.config.headers },
        body: JSON.stringify(buildOtlpPayload(batch)),
      });
    } catch {
      // Fail-soft: tracing export must never break a request. Dropped on error.
    }
  }
}

/**
 * Resolve the active tracer provider. Returns the OTLP exporter when
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is a valid URL, else {@link NoopTracerProvider}
 * (ships dark). Always call `provider.flush()` in `ctx.waitUntil(...)`.
 *
 * @example
 * const tp = getTracerProvider(c.env);
 * const span = tp.getTracer('site-serving').startSpan('resolve-host');
 * span.setAttribute('host', host).setStatus('ok').end();
 * c.executionCtx.waitUntil(tp.flush());
 */
export function getTracerProvider(env: Env, fetchImpl: typeof fetch = fetch): TracerProvider {
  const parsed = OtlpConfigSchema.safeParse({
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
  });
  if (!parsed.success) return new NoopTracerProvider();
  return new OtlpTracerProvider(parsed.data, fetchImpl);
}
