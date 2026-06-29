import {
  propagateHeaders,
  traceLogContext,
  parseInboundTrace,
} from '../services/trace_propagation.js';

const ctx = { traceId: 't1', requestId: 'r1', tenantId: 'o1', caller: 'worker' };

describe('propagateHeaders (AP17)', () => {
  it('emits the core x-trace-id + x-request-id always', () => {
    const h = propagateHeaders({ traceId: 'a', requestId: 'b' });
    expect(h['x-trace-id']).toBe('a');
    expect(h['x-request-id']).toBe('b');
  });

  it('includes optional x-tenant-id + x-caller when set', () => {
    const h = propagateHeaders(ctx);
    expect(h['x-tenant-id']).toBe('o1');
    expect(h['x-caller']).toBe('worker');
  });

  it('omits blank optional fields', () => {
    const h = propagateHeaders({ traceId: 'a', requestId: 'b', tenantId: '  ' });
    expect(h['x-tenant-id']).toBeUndefined();
  });
});

describe('traceLogContext (AP17)', () => {
  it('builds the structured-log context block', () => {
    const lc = traceLogContext(ctx);
    expect(lc).toEqual({ traceId: 't1', requestId: 'r1', tenantId: 'o1', caller: 'worker' });
  });

  it('fills unknown defaults for missing core fields', () => {
    expect(traceLogContext({ traceId: '', requestId: '' }).traceId).toBe('unknown');
  });
});

describe('parseInboundTrace (AP17)', () => {
  it('parses x- headers from a fetch response', () => {
    const h = new Headers({ 'x-trace-id': 't1', 'x-request-id': 'r1', 'x-tenant-id': 'o1' });
    expect(parseInboundTrace(h)).toEqual({
      traceId: 't1',
      requestId: 'r1',
      tenantId: 'o1',
      caller: undefined,
    });
  });

  it('falls back to cf-ray / cf-request-id / W3C traceparent', () => {
    const h = new Headers({ 'cf-ray': 'cr1', 'cf-request-id': 'cfr1' });
    const t = parseInboundTrace(h);
    expect(t.traceId).toBe('cr1');
    expect(t.requestId).toBe('cfr1');

    const w3c = new Headers({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    });
    expect(parseInboundTrace(w3c).traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('returns unknown for completely empty headers', () => {
    const t = parseInboundTrace(new Headers());
    expect(t.traceId).toBe('unknown');
    expect(t.requestId).toBe('unknown');
  });
});
