/**
 * tracing_port — §35 OpenTelemetry span port + OTLP/HTTP exporter.
 *
 * Locks the port (Noop is zero-overhead, Fake records finished spans) and the
 * adapter (header parsing, OTLP JSON payload shape, fetch export + fail-soft,
 * factory gate: OTLP when endpoint set, Noop when unset). No real network — fetch
 * is injected. Global `jest`.
 */
import {
  FakeTracerProvider,
  NoopTracerProvider,
  newTraceId,
  newSpanId,
} from '../platform/tracing.js';
import {
  OtlpTracerProvider,
  buildOtlpPayload,
  parseOtlpHeaders,
  getTracerProvider,
} from '../middleware/tracing.js';

describe('id helpers', () => {
  it('mint 32-hex trace ids and 16-hex span ids', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('NoopTracerProvider', () => {
  it('produces inert spans (chainable, no throw)', async () => {
    const tp = new NoopTracerProvider();
    const s = tp.getTracer('x').startSpan('noop');
    expect(s.setAttribute('a', 1).setStatus('ok')).toBe(s);
    s.end();
    await tp.flush();
    expect(s.traceId).toBe('0'.repeat(32));
  });
});

describe('FakeTracerProvider', () => {
  it('records a finished span with attributes + status', () => {
    const tp = new FakeTracerProvider();
    tp.getTracer('scope-1')
      .startSpan('work', { attributes: { foo: 'bar' }, startTimeMs: 100 })
      .setAttribute('n', 5)
      .setStatus('ok')
      .end(250);
    expect(tp.spans).toHaveLength(1);
    expect(tp.spans[0]).toMatchObject({
      name: 'work',
      scope: 'scope-1',
      status: 'ok',
      startTimeMs: 100,
      endTimeMs: 250,
      attributes: { foo: 'bar', n: 5 },
    });
    expect(tp.spans[0].traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('end() is idempotent', () => {
    const tp = new FakeTracerProvider();
    const s = tp.getTracer('s').startSpan('once');
    s.end();
    s.end();
    expect(tp.spans).toHaveLength(1);
  });
});

describe('parseOtlpHeaders', () => {
  it('parses k=v,k2=v2 and ignores malformed', () => {
    expect(parseOtlpHeaders('x-team=abc, x-ds=prod ,bad')).toEqual({
      'x-team': 'abc',
      'x-ds': 'prod',
    });
  });
  it('returns {} for undefined', () => {
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });
});

describe('buildOtlpPayload', () => {
  it('groups by scope and shapes spans as OTLP JSON', () => {
    const payload = buildOtlpPayload([
      {
        name: 'a',
        scope: 's1',
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        kind: 'server',
        startTimeMs: 1,
        endTimeMs: 2,
        status: 'ok',
        attributes: { host: 'x', count: 3, flag: true },
      },
    ]);
    const rs = payload.resourceSpans[0];
    expect(rs.resource.attributes[0]).toEqual({
      key: 'service.name',
      value: { stringValue: 'project-sites' },
    });
    const span = rs.scopeSpans[0].spans[0];
    expect(span.kind).toBe(2); // server
    expect(span.status.code).toBe(1); // ok
    expect(span.startTimeUnixNano).toBe('1000000');
    expect(span.attributes).toEqual([
      { key: 'host', value: { stringValue: 'x' } },
      { key: 'count', value: { intValue: '3' } },
      { key: 'flag', value: { boolValue: true } },
    ]);
  });
});

describe('OtlpTracerProvider', () => {
  it('POSTs buffered spans on flush and clears the buffer', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const tp = new OtlpTracerProvider(
      { endpoint: 'https://otlp.example/v1/traces', headers: { 'x-k': 'v' } },
      fakeFetch,
    );
    tp.getTracer('svc').startSpan('op').setStatus('ok').end();
    await tp.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://otlp.example/v1/traces');
    await tp.flush(); // buffer drained → no second call
    expect(calls).toHaveLength(1);
  });

  it('flush is fail-soft when fetch rejects', async () => {
    const tp = new OtlpTracerProvider(
      { endpoint: 'https://otlp.example/v1/traces', headers: {} },
      (async () => {
        throw new Error('network');
      }) as unknown as typeof fetch,
    );
    tp.getTracer('svc').startSpan('op').end();
    await expect(tp.flush()).resolves.toBeUndefined();
  });
});

describe('getTracerProvider', () => {
  it('returns OTLP provider when a valid endpoint is set', () => {
    const tp = getTracerProvider({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example/v1/traces',
    } as never);
    expect(tp).toBeInstanceOf(OtlpTracerProvider);
  });
  it('returns Noop (ships dark) when endpoint is unset or invalid', () => {
    expect(getTracerProvider({} as never)).toBeInstanceOf(NoopTracerProvider);
    expect(getTracerProvider({ OTEL_EXPORTER_OTLP_ENDPOINT: 'not-a-url' } as never)).toBeInstanceOf(
      NoopTracerProvider,
    );
  });
});
