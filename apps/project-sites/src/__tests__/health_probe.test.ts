/**
 * Tests for health_probe service — pure zero-I/O aggregator.
 */
import {
  aggregateHealth,
  classifyProbe,
  slowerThan,
  type ProbeResult,
} from '../services/health_probe.js';

// ── Helpers ─────────────────────────────────────────────────

function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    url: 'https://example.com/health',
    label: 'Example API',
    status: 200,
    durationMs: 42,
    ...overrides,
  };
}

// ── classifyProbe ───────────────────────────────────────────

describe('classifyProbe', () => {
  it('classifies 200 as healthy', () => {
    expect(classifyProbe(probe({ status: 200 }))).toBe('healthy');
  });

  it('classifies 201 as healthy', () => {
    expect(classifyProbe(probe({ status: 201 }))).toBe('healthy');
  });

  it('classifies 299 as healthy', () => {
    expect(classifyProbe(probe({ status: 299 }))).toBe('healthy');
  });

  it('classifies 300 as degraded', () => {
    expect(classifyProbe(probe({ status: 300 }))).toBe('degraded');
  });

  it('classifies 404 as degraded', () => {
    expect(classifyProbe(probe({ status: 404 }))).toBe('degraded');
  });

  it('classifies 503 as degraded', () => {
    expect(classifyProbe(probe({ status: 503 }))).toBe('degraded');
  });

  it('classifies null status (timeout) as down', () => {
    expect(classifyProbe(probe({ status: null, durationMs: 5000, error: 'Timeout' }))).toBe('down');
  });

  it('classifies error without status as down', () => {
    expect(classifyProbe(probe({ status: null, error: 'DNS resolution failed' }))).toBe('down');
  });

  it('classifies 200 with error string as down', () => {
    // Defensive: status 200 plus an error string should still be down
    expect(classifyProbe(probe({ status: 200, error: 'Unexpected' }))).toBe('down');
  });
});

// ── aggregateHealth ─────────────────────────────────────────

describe('aggregateHealth', () => {
  it('all healthy → operational', () => {
    const result = aggregateHealth([
      probe({ status: 200 }),
      probe({ status: 201 }),
      probe({ status: 200 }),
    ]);
    expect(result.status).toBe('operational');
    expect(result.total).toBe(3);
    expect(result.healthy).toBe(3);
    expect(result.degraded).toBe(0);
    expect(result.down).toBe(0);
  });

  it('any degraded → degraded', () => {
    const result = aggregateHealth([
      probe({ status: 200 }),
      probe({ status: 503 }),
      probe({ status: 200 }),
    ]);
    expect(result.status).toBe('degraded');
    expect(result.healthy).toBe(2);
    expect(result.degraded).toBe(1);
    expect(result.down).toBe(0);
  });

  it('any down → outage', () => {
    const result = aggregateHealth([
      probe({ status: 200 }),
      probe({ status: null, error: 'Timeout' }),
    ]);
    expect(result.status).toBe('outage');
    expect(result.healthy).toBe(1);
    expect(result.degraded).toBe(0);
    expect(result.down).toBe(1);
  });

  it('degraded + down → outage (down takes precedence)', () => {
    const result = aggregateHealth([
      probe({ status: 503 }),
      probe({ status: null, error: 'Timeout' }),
    ]);
    expect(result.status).toBe('outage');
    expect(result.degraded).toBe(1);
    expect(result.down).toBe(1);
  });

  it('empty input → operational, total=0, worstProbe=null', () => {
    const result = aggregateHealth([]);
    expect(result.status).toBe('operational');
    expect(result.total).toBe(0);
    expect(result.healthy).toBe(0);
    expect(result.degraded).toBe(0);
    expect(result.down).toBe(0);
    expect(result.worstProbe).toBeNull();
  });

  it('worstProbe picks error over high-duration success', () => {
    const fastError = probe({ durationMs: 10, error: 'DNS failure' });
    const slowOk = probe({ durationMs: 3000 });
    const result = aggregateHealth([slowOk, fastError]);
    expect(result.worstProbe).toBe(fastError);
  });

  it('worstProbe picks highest duration when neither has error', () => {
    const slow = probe({ durationMs: 2000 });
    const fast = probe({ durationMs: 50 });
    const result = aggregateHealth([fast, slow]);
    expect(result.worstProbe).toBe(slow);
  });

  it('worstProbe picks highest duration among errors', () => {
    const slowError = probe({ durationMs: 5000, error: 'Timeout' });
    const fastError = probe({ durationMs: 100, error: 'Refused' });
    const result = aggregateHealth([fastError, slowError]);
    expect(result.worstProbe).toBe(slowError);
  });

  it('probes passthrough in same order', () => {
    const probes = [probe({ label: 'A' }), probe({ label: 'B', status: 503 })];
    const result = aggregateHealth(probes);
    expect(result.probes).toHaveLength(2);
    expect(result.probes[0].label).toBe('A');
    expect(result.probes[1].label).toBe('B');
  });

  it('never throws on any input', () => {
    expect(() => aggregateHealth([])).not.toThrow();
    expect(() => aggregateHealth([probe()])).not.toThrow();
    expect(() =>
      aggregateHealth([probe({ status: null }), probe({ status: 500, error: 'x' })]),
    ).not.toThrow();
  });
});

// ── slowerThan ──────────────────────────────────────────────

describe('slowerThan', () => {
  const probes: ProbeResult[] = [
    probe({ label: 'A', durationMs: 100 }),
    probe({ label: 'B', durationMs: 300 }),
    probe({ label: 'C', durationMs: 50 }),
    probe({ label: 'D', durationMs: 100 }),
  ];

  it('counts probes strictly slower than target', () => {
    expect(slowerThan(probes, probes[0])).toBe(1); // only B
  });

  it('fastest has highest count (all others slower)', () => {
    expect(slowerThan(probes, probes[2])).toBe(3); // C at 50ms: A, B, D all slower
  });

  it('slowest has count 0 (no one slower)', () => {
    expect(slowerThan(probes, probes[1])).toBe(0); // B at 300ms: highest duration, no one slower
  });

  it('handles empty list', () => {
    expect(slowerThan([], probe({ durationMs: 100 }))).toBe(0);
  });

  it('never throws', () => {
    expect(() => slowerThan([], probe())).not.toThrow();
    expect(() => slowerThan(probes, probe({ durationMs: 999 }))).not.toThrow();
  });
});
