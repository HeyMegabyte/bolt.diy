/**
 * System Status service unit tests.
 *
 * Uses an injectable fetchImpl so tests are deterministic — no real network calls.
 */
import { probeAll, INTEGRATION_TARGETS } from '../service.js';

describe('probeAll', () => {
  it('returns healthy when all integrations respond 200', async () => {
    const fetchImpl = async () => new Response('ok', { status: 200 });
    const result = await probeAll(fetchImpl);
    expect(result.overall).toBe('healthy');
    expect(result.integrations).toHaveLength(INTEGRATION_TARGETS.length);
    for (const r of result.integrations) {
      expect(r.status).toBe('healthy');
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns degraded when one integration times out', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) {
        // First integration: timeout
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      return new Response('ok', { status: 200 });
    };
    const result = await probeAll(fetchImpl);
    expect(result.overall).toBe('degraded');
    const degraded = result.integrations.filter((r) => r.status === 'degraded');
    expect(degraded.length).toBe(1);
    expect(degraded[0].error).toContain('abort');
  });

  it('returns down when an integration 500s', async () => {
    const fetchImpl = async () => new Response('error', { status: 500 });
    const result = await probeAll(fetchImpl);
    expect(result.overall).toBe('down');
    for (const r of result.integrations) {
      expect(r.status).toBe('down');
    }
  });

  it('returns degraded on HTTP 404 (not down)', async () => {
    const fetchImpl = async () => new Response('not found', { status: 404 });
    const result = await probeAll(fetchImpl);
    expect(result.overall).toBe('degraded');
  });

  it('measures latency per integration', async () => {
    const fetchImpl = async () => new Response('ok', { status: 200 });
    const result = await probeAll(fetchImpl);
    for (const r of result.integrations) {
      expect(r.latencyMs).toBeDefined();
      expect(r.latencyMs!).toBeGreaterThanOrEqual(0);
    }
  });

  it('includes checkedAt timestamp', async () => {
    const fetchImpl = async () => new Response('ok', { status: 200 });
    const before = new Date().toISOString();
    const result = await probeAll(fetchImpl);
    expect(result.checkedAt >= before).toBe(true);
  });

  it('reports network error as down', async () => {
    const fetchImpl = async () => {
      throw new Error('fetch failed');
    };
    const result = await probeAll(fetchImpl);
    expect(result.overall).toBe('down');
    for (const r of result.integrations) {
      expect(r.status).toBe('down');
      expect(r.error).toBe('fetch failed');
    }
  });
});
