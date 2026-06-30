import {
  buildTraceParent,
  buildTraceState,
  deriveSpanId,
  parseTraceParent,
  parseTraceState,
  uuidToTraceHex,
} from '../trace_context';

const TRACE_HEX = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const SPAN_HEX = '0011223344556677';

describe('buildTraceParent', () => {
  it('builds a valid sampled traceparent', () => {
    const tp = buildTraceParent(TRACE_HEX, SPAN_HEX);
    expect(tp).toBe(`00-${TRACE_HEX}-${SPAN_HEX}-01`);
  });

  it('builds an unsampled traceparent', () => {
    const tp = buildTraceParent(TRACE_HEX, SPAN_HEX, false);
    expect(tp).toBe(`00-${TRACE_HEX}-${SPAN_HEX}-00`);
  });

  it('rejects invalid hex lengths', () => {
    expect(() => buildTraceParent('short', SPAN_HEX)).toThrow();
  });
});

describe('parseTraceParent', () => {
  it('parses a valid sampled traceparent', () => {
    const ids = parseTraceParent(`00-${TRACE_HEX}-${SPAN_HEX}-01`);
    expect(ids).toEqual({ traceId: TRACE_HEX, spanId: SPAN_HEX, sampled: true });
  });

  it('parses an unsampled traceparent', () => {
    const ids = parseTraceParent(`00-${TRACE_HEX}-${SPAN_HEX}-00`);
    expect(ids?.sampled).toBe(false);
  });

  it('returns null for empty header', () => {
    expect(parseTraceParent('')).toBeNull();
    expect(parseTraceParent(null)).toBeNull();
    expect(parseTraceParent(undefined)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseTraceParent('garbage')).toBeNull();
    expect(parseTraceParent('00-short-short-01')).toBeNull();
  });
});

describe('parseTraceState', () => {
  it('parses vendor entries', () => {
    const entries = parseTraceState('cd=1;o=2,sentry@trace_id=abc123');
    expect(entries).toHaveLength(1); // first entry has no @ → dropped
    expect(entries[0]).toEqual({ vendor: 'sentry', key: 'trace_id', value: 'abc123' });
  });

  it('returns empty for null/empty', () => {
    expect(parseTraceState('')).toEqual([]);
    expect(parseTraceState(null)).toEqual([]);
  });
});

describe('buildTraceState', () => {
  it('builds a valid tracestate', () => {
    const state = buildTraceState([{ vendor: 'sentry', key: 'trace_id', value: 'abc' }]);
    expect(state).toBe('sentry@trace_id=abc');
  });

  it('returns empty string for empty entries', () => {
    expect(buildTraceState([])).toBe('');
  });
});

describe('uuidToTraceHex', () => {
  it('strips dashes from UUID', () => {
    expect(uuidToTraceHex('019307f0-5c6e-7a1b-8000-abc123def456')).toBe(
      '019307f05c6e7a1b8000abc123def456',
    );
  });
});

describe('deriveSpanId', () => {
  it('takes last 16 chars', () => {
    expect(deriveSpanId(TRACE_HEX)).toBe('c9d0e1f2a3b4c5d6');
    expect(deriveSpanId(TRACE_HEX)).toHaveLength(16);
  });
});
