/**
 * @module platform/tracing
 *
 * @description
 * OpenTelemetry-shaped distributed-tracing port (convergence §35, OpenTelemetry).
 * ProjectSites already has correlation (traceId/requestId in `lib/log.ts`), Sentry
 * exception spans, PostHog product events, AI-Gateway logs, and CF Workers Tracing
 * (`[observability]` zero-config OTLP of every I/O). Per the include-list protocol
 * we do NOT adopt the full `@opentelemetry/*` SDK (heavy, not Workers-tuned) — this
 * port gives app code a standard `Tracer.startSpan(...)` surface whose spans can be
 * exported via OTLP/HTTP to any backend (Honeycomb / Grafana / Axiom) when an
 * endpoint is configured, complementing (not replacing) Workers Tracing.
 *
 * Ports-and-adapters: this file is the pure port (interfaces + Noop + Fake). The
 * real OTLP/HTTP exporter + `getTracerProvider(env)` factory live in
 * `middleware/tracing.ts` (mirrors `platform/feature-evaluation.ts`).
 * Ships DARK: with no `OTEL_EXPORTER_OTLP_ENDPOINT` the factory returns
 * {@link NoopTracerProvider} — zero overhead, no behavior change.
 *
 * @see lib/log.ts (existing traceId/requestId correlation)
 * @see middleware/tracing.ts (OTLP exporter + factory)
 * @see docs/adr/0035-opentelemetry-span-port-over-workers-tracing.md
 */

/** OTel span status. */
export type SpanStatus = 'unset' | 'ok' | 'error';

/** OTel span kind (subset). */
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';

/** Attribute value types OTLP accepts as scalars. */
export type AttributeValue = string | number | boolean;

/** A started span. Call {@link Span.end} exactly once. */
export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: AttributeValue): this;
  setStatus(status: SpanStatus, message?: string): this;
  /** End the span; `endTimeMs` defaults to now. */
  end(endTimeMs?: number): void;
}

/** Options when starting a span. */
export interface StartSpanOptions {
  readonly kind?: SpanKind;
  readonly attributes?: Readonly<Record<string, AttributeValue>>;
  /** Parent trace id to continue (else a new trace is started). */
  readonly traceId?: string;
  /** Parent span id. */
  readonly parentSpanId?: string;
  /** Start time; defaults to now. */
  readonly startTimeMs?: number;
}

/** Names + starts spans for one instrumentation scope. */
export interface Tracer {
  startSpan(name: string, options?: StartSpanOptions): Span;
}

/** Roots the tracer set; `flush` ships buffered spans (call in `waitUntil`). */
export interface TracerProvider {
  readonly name: string;
  getTracer(scope: string): Tracer;
  /** Export any buffered spans. No-op for Noop/Fake. */
  flush(): Promise<void>;
}

/** A finished span record (what an exporter serializes). */
export interface FinishedSpan {
  readonly name: string;
  readonly scope: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly kind: SpanKind;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly status: SpanStatus;
  readonly statusMessage?: string;
  readonly attributes: Record<string, AttributeValue>;
}

/** 16 random hex bytes (OTel trace id). */
export function newTraceId(): string {
  return randomHex(16);
}
/** 8 random hex bytes (OTel span id). */
export function newSpanId(): string {
  return randomHex(8);
}
function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mutable span used by both the in-memory ({@link FakeTracerProvider}) and OTLP
 * adapters — it records into a sink on {@link end}.
 */
export class RecordingSpan implements Span {
  readonly traceId: string;
  readonly spanId: string;
  private readonly attrs: Record<string, AttributeValue> = {};
  private status: SpanStatus = 'unset';
  private statusMessage?: string;
  private ended = false;

  constructor(
    private readonly name: string,
    private readonly scope: string,
    private readonly opts: StartSpanOptions,
    private readonly startTimeMs: number,
    private readonly sink: (s: FinishedSpan) => void,
    nowMs: number,
  ) {
    this.traceId = opts.traceId ?? newTraceId();
    this.spanId = newSpanId();
    void nowMs;
    if (opts.attributes) Object.assign(this.attrs, opts.attributes);
  }

  setAttribute(key: string, value: AttributeValue): this {
    this.attrs[key] = value;
    return this;
  }
  setStatus(status: SpanStatus, message?: string): this {
    this.status = status;
    this.statusMessage = message;
    return this;
  }
  end(endTimeMs?: number): void {
    if (this.ended) return;
    this.ended = true;
    this.sink({
      name: this.name,
      scope: this.scope,
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.opts.parentSpanId,
      kind: this.opts.kind ?? 'internal',
      startTimeMs: this.startTimeMs,
      endTimeMs: endTimeMs ?? this.startTimeMs,
      status: this.status,
      statusMessage: this.statusMessage,
      attributes: { ...this.attrs },
    });
  }
}

/** Zero-overhead provider used when no OTLP endpoint is configured (ships dark). */
export class NoopTracerProvider implements TracerProvider {
  readonly name = 'noop-tracer';
  getTracer(): Tracer {
    return {
      startSpan: (name) => ({
        traceId: '0'.repeat(32),
        spanId: '0'.repeat(16),
        setAttribute() {
          return this;
        },
        setStatus() {
          return this;
        },
        end() {},
      }),
    };
  }
  async flush(): Promise<void> {}
}

/**
 * In-memory provider for tests — records finished spans in {@link FakeTracerProvider.spans}.
 *
 * @example
 * const tp = new FakeTracerProvider();
 * const s = tp.getTracer('test').startSpan('work', { attributes: { foo: 'bar' } });
 * s.setStatus('ok').end(); // tp.spans[0].name === 'work'
 */
export class FakeTracerProvider implements TracerProvider {
  readonly name = 'fake-tracer';
  readonly spans: FinishedSpan[] = [];
  getTracer(scope: string): Tracer {
    return {
      startSpan: (name, options = {}) =>
        new RecordingSpan(
          name,
          scope,
          options,
          options.startTimeMs ?? 0,
          (s) => this.spans.push(s),
          0,
        ),
    };
  }
  async flush(): Promise<void> {}
}
