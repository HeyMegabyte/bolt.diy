/**
 * @module services/__tests__/health_aggregator.test
 * @description Tests for the LOOP-STATUS-001 health-aggregator normalization
 * core. Covers all status derivations, error paths, registry validation, and
 * aggregate summarization. All tests are pure — no network, no D1, no env.
 */

import {
  type SubsystemEntry,
  deriveStatus,
  normalizeComponentState,
  normalizeBatch,
  summarizeAggregate,
  validateRegistry,
} from '../health_aggregator';

// ── Test helpers ────────────────────────────────────────────────────────────

/** Creates a mock Response with the given status and JSON body. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText:
      status === 200 ? 'OK' : status === 500 ? 'Internal Server Error' : 'Service Unavailable',
    text: async () => JSON.stringify(body),
  } as Response;
}

const CHECKED_AT = '2026-06-30T00:00:00.000Z';

// ── deriveStatus ───────────────────────────────────────────────────────────

describe('deriveStatus', () => {
  it('returns operational for an empty ok body', () => {
    expect(deriveStatus({ status: 'ok' })).toBe('operational');
  });

  it('returns operational when status is absent (implicit ok)', () => {
    expect(deriveStatus({})).toBe('operational');
  });

  it('returns operational when all checks pass', () => {
    expect(
      deriveStatus({
        checks: [
          { name: 'db', status: 'ok' },
          { name: 'cache', status: 'pass' },
        ],
      }),
    ).toBe('operational');
  });

  it('returns maintenance for explicit maintenance status', () => {
    expect(deriveStatus({ status: 'maintenance' })).toBe('maintenance');
  });

  it('returns degraded for explicit degraded status', () => {
    expect(deriveStatus({ status: 'degraded' })).toBe('degraded');
  });

  it('returns degraded for a single failing check', () => {
    expect(
      deriveStatus({
        checks: [
          { name: 'db', status: 'ok' },
          { name: 'cache', status: 'fail', message: 'connection refused' },
        ],
      }),
    ).toBe('degraded');
  });

  it('returns degraded for two failing checks', () => {
    expect(
      deriveStatus({
        checks: [
          { name: 'db', status: 'fail' },
          { name: 'cache', status: 'fail' },
        ],
      }),
    ).toBe('degraded');
  });

  it('returns partial_outage for three or more failing checks', () => {
    expect(
      deriveStatus({
        checks: [
          { name: 'a', status: 'fail' },
          { name: 'b', status: 'fail' },
          { name: 'c', status: 'fail' },
        ],
      }),
    ).toBe('partial_outage');
  });

  it('returns partial_outage for four failing checks', () => {
    expect(
      deriveStatus({
        checks: [
          { name: 'a', status: 'fail' },
          { name: 'b', status: 'fail' },
          { name: 'c', status: 'fail' },
          { name: 'd', status: 'fail' },
        ],
      }),
    ).toBe('partial_outage');
  });

  it('is case-insensitive for check statuses', () => {
    expect(
      deriveStatus({
        checks: [{ name: 'x', status: 'FAIL' }],
      }),
    ).toBe('degraded');
  });
});

// ── normalizeComponentState ───────────────────────────────────────────────

describe('normalizeComponentState', () => {
  it('returns operational for a 200 with status ok', async () => {
    const state = await normalizeComponentState(
      'd1',
      mockResponse(200, { status: 'ok' }),
      42,
      CHECKED_AT,
    );
    expect(state).toEqual({
      slug: 'd1',
      status: 'operational',
      latencyMs: 42,
      checkedAt: CHECKED_AT,
      detail: 'ok',
    });
  });

  it('returns operational for a 200 with no explicit status', async () => {
    const state = await normalizeComponentState('r2', mockResponse(200, {}), 15, CHECKED_AT);
    expect(state.slug).toBe('r2');
    expect(state.status).toBe('operational');
    expect(state.latencyMs).toBe(15);
  });

  it('returns degraded for HTTP 4xx (degraded, not outage)', async () => {
    const state = await normalizeComponentState('api', mockResponse(429, {}), 100, CHECKED_AT);
    expect(state.status).toBe('degraded');
    expect(state.detail).toContain('429');
  });

  it('returns major_outage for HTTP 5xx', async () => {
    const state = await normalizeComponentState('twenty', mockResponse(500, {}), 200, CHECKED_AT);
    expect(state.status).toBe('major_outage');
    expect(state.detail).toContain('500');
  });

  it('returns major_outage for null response (timeout/network error)', async () => {
    const state = await normalizeComponentState('mail', null, 5001, CHECKED_AT);
    expect(state.status).toBe('major_outage');
    expect(state.detail).toContain('network error');
    expect(state.latencyMs).toBe(5001);
  });

  it('returns degraded for a 200 with unparseable body', async () => {
    const badResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'not json at all {{{',
    } as Response;
    const state = await normalizeComponentState('bad', badResponse, 33, CHECKED_AT);
    expect(state.status).toBe('degraded');
    expect(state.detail).toContain('unparseable');
  });

  it('uses the body status field when available on a 4xx', async () => {
    const state = await normalizeComponentState(
      'svc',
      mockResponse(503, { status: 'database unreachable' }),
      500,
      CHECKED_AT,
    );
    expect(state.status).toBe('major_outage');
    expect(state.detail).toBe('database unreachable');
  });

  it('falls back to check message when no top-level status', async () => {
    const state = await normalizeComponentState(
      'svc',
      mockResponse(200, {
        checks: [{ name: 'db', status: 'ok', message: 'connected (read replica)' }],
      }),
      20,
      CHECKED_AT,
    );
    expect(state.status).toBe('operational');
    expect(state.detail).toBe('connected (read replica)');
  });

  it('never throws on any input shape', async () => {
    // 204 no content
    const r1 = {
      ok: true,
      status: 204,
      statusText: 'No Content',
      text: async () => '',
    } as Response;
    const s1 = await normalizeComponentState('x', r1, 0, CHECKED_AT);
    expect(s1.status).toBeDefined();

    // completely empty response body that is valid JSON
    const s2 = await normalizeComponentState('y', mockResponse(200, null), 0, CHECKED_AT);
    expect(s2.status).toBeDefined();

    // null — already tested above, but included for completeness
    const s3 = await normalizeComponentState('z', null, 0, CHECKED_AT);
    expect(s3.status).toBe('major_outage');
  });
});

// ── normalizeBatch ────────────────────────────────────────────────────────

describe('normalizeBatch', () => {
  it('normalizes multiple checks in parallel preserving order', async () => {
    const results = await normalizeBatch([
      {
        slug: 'a',
        response: mockResponse(200, { status: 'ok' }),
        latencyMs: 10,
        checkedAt: CHECKED_AT,
      },
      { slug: 'b', response: mockResponse(500, {}), latencyMs: 200, checkedAt: CHECKED_AT },
      { slug: 'c', response: null, latencyMs: 5001, checkedAt: CHECKED_AT },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].slug).toBe('a');
    expect(results[0].status).toBe('operational');
    expect(results[1].slug).toBe('b');
    expect(results[1].status).toBe('major_outage');
    expect(results[2].slug).toBe('c');
    expect(results[2].status).toBe('major_outage');
  });

  it('returns empty array for empty input', async () => {
    const results = await normalizeBatch([]);
    expect(results).toEqual([]);
  });
});

// ── validateRegistry ───────────────────────────────────────────────────────

describe('validateRegistry', () => {
  const valid: SubsystemEntry[] = [
    {
      slug: 'd1',
      label: 'D1 Database',
      healthUrl: 'https://worker.workers.dev/health',
      dependsOn: [],
    },
    {
      slug: 'r2',
      label: 'R2 Storage',
      healthUrl: 'https://worker.workers.dev/health',
      dependsOn: [],
    },
    {
      slug: 'api',
      label: 'API Worker',
      healthUrl: 'https://worker.workers.dev/health',
      dependsOn: ['d1', 'r2'],
    },
  ];

  it('returns empty for a valid registry', () => {
    expect(validateRegistry(valid)).toEqual([]);
  });

  it('flags duplicate slugs', () => {
    const dup: SubsystemEntry[] = [
      { slug: 'd1', label: 'One', healthUrl: '', dependsOn: [] },
      { slug: 'd1', label: 'Two', healthUrl: '', dependsOn: [] },
    ];
    const errors = validateRegistry(dup);
    expect(errors).toContainEqual(expect.stringContaining('Duplicate slug'));
  });

  it('flags self-referential dependsOn', () => {
    const self: SubsystemEntry[] = [{ slug: 'd1', label: 'D1', healthUrl: '', dependsOn: ['d1'] }];
    const errors = validateRegistry(self);
    expect(errors).toContainEqual(expect.stringContaining('Self-referential'));
  });

  it('flags unknown dependency', () => {
    const missing: SubsystemEntry[] = [
      { slug: 'd1', label: 'D1', healthUrl: '', dependsOn: ['nope'] },
    ];
    const errors = validateRegistry(missing);
    expect(errors).toContainEqual(expect.stringContaining('Unknown dependency'));
    expect(errors[0]).toContain('"nope"');
  });

  it('returns all errors at once', () => {
    const bad: SubsystemEntry[] = [
      { slug: 'a', label: 'A', healthUrl: '', dependsOn: ['a', 'z'] },
      { slug: 'a', label: 'A2', healthUrl: '', dependsOn: [] },
    ];
    const errors = validateRegistry(bad);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── summarizeAggregate ─────────────────────────────────────────────────────

describe('summarizeAggregate', () => {
  it('returns operational when all components are green', () => {
    const states = [
      {
        slug: 'a',
        status: 'operational' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
      {
        slug: 'b',
        status: 'operational' as const,
        latencyMs: 15,
        checkedAt: CHECKED_AT,
        detail: '',
      },
    ];
    const summary = summarizeAggregate(states);
    expect(summary.overall).toBe('operational');
    expect(summary.allOperational).toBe(true);
    expect(summary.total).toBe(2);
    expect(summary.counts.operational).toBe(2);
    expect(summary.counts.degraded).toBe(0);
    expect(summary.counts.major_outage).toBe(0);
  });

  it('returns degraded when one component is degraded', () => {
    const states = [
      {
        slug: 'a',
        status: 'operational' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
      { slug: 'b', status: 'degraded' as const, latencyMs: 200, checkedAt: CHECKED_AT, detail: '' },
    ];
    const summary = summarizeAggregate(states);
    expect(summary.overall).toBe('degraded');
    expect(summary.allOperational).toBe(false);
    expect(summary.counts.operational).toBe(1);
    expect(summary.counts.degraded).toBe(1);
  });

  it('major_outage beats everything else', () => {
    const states = [
      { slug: 'a', status: 'degraded' as const, latencyMs: 10, checkedAt: CHECKED_AT, detail: '' },
      {
        slug: 'b',
        status: 'major_outage' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
      {
        slug: 'c',
        status: 'partial_outage' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
    ];
    const summary = summarizeAggregate(states);
    expect(summary.overall).toBe('major_outage');
  });

  it('partial_outage beats degraded', () => {
    const states = [
      { slug: 'a', status: 'degraded' as const, latencyMs: 10, checkedAt: CHECKED_AT, detail: '' },
      {
        slug: 'b',
        status: 'partial_outage' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
    ];
    expect(summarizeAggregate(states).overall).toBe('partial_outage');
  });

  it('maintenance is above operational but below degraded', () => {
    const states = [
      {
        slug: 'a',
        status: 'operational' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
      {
        slug: 'b',
        status: 'maintenance' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
    ];
    const summary = summarizeAggregate(states);
    expect(summary.overall).toBe('maintenance');
    expect(summary.counts.maintenance).toBe(1);
  });

  it('handles empty state array gracefully', () => {
    const summary = summarizeAggregate([]);
    expect(summary.overall).toBe('operational');
    expect(summary.total).toBe(0);
    expect(summary.allOperational).toBe(true);
  });

  it('counts each status bucket correctly', () => {
    const states = [
      {
        slug: 'a',
        status: 'operational' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
      {
        slug: 'b',
        status: 'operational' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
      { slug: 'c', status: 'degraded' as const, latencyMs: 10, checkedAt: CHECKED_AT, detail: '' },
      {
        slug: 'd',
        status: 'major_outage' as const,
        latencyMs: 10,
        checkedAt: CHECKED_AT,
        detail: '',
      },
    ];
    const summary = summarizeAggregate(states);
    expect(summary.counts.operational).toBe(2);
    expect(summary.counts.degraded).toBe(1);
    expect(summary.counts.major_outage).toBe(1);
    expect(summary.counts.partial_outage).toBe(0);
    expect(summary.counts.maintenance).toBe(0);
    expect(summary.total).toBe(4);
  });
});
