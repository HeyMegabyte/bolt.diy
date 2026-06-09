import { HealthStatusSchema } from './api.service';

/**
 * Guards the worker `GET /health` boundary contract that drives the admin topbar
 * system-health pill (P2). The pill must show REAL data only — a malformed
 * response has to `safeParse`-fail (→ "unknown" grey state), never coerce into a
 * fake "ok". These cases lock that behavior.
 */
describe('HealthStatusSchema (/health boundary contract)', () => {
  it('parses a healthy envelope and keeps environment + checks', () => {
    const parsed = HealthStatusSchema.safeParse({
      status: 'ok',
      environment: 'production',
      version: 'abc123',
      latency_ms: 12,
      checks: { kv: { status: 'ok', latency_ms: 3 }, r2: { status: 'ok', latency_ms: 5 } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('ok');
      expect(parsed.data.environment).toBe('production');
      expect(parsed.data.checks?.['r2']?.status).toBe('ok');
    }
  });

  it('parses a degraded envelope with a failing check', () => {
    const parsed = HealthStatusSchema.safeParse({
      status: 'degraded',
      environment: 'production',
      checks: { kv: { status: 'ok' }, r2: { status: 'error', message: 'timeout' } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.status).toBe('degraded');
  });

  it('tolerates extra/unknown top-level fields (passthrough)', () => {
    const parsed = HealthStatusSchema.safeParse({ status: 'ok', region: 'ewr', timestamp: 'x' });
    expect(parsed.success).toBe(true);
  });

  it('FAILS an unknown status so the pill never fakes "ok"', () => {
    expect(HealthStatusSchema.safeParse({ status: 'green' }).success).toBe(false);
    expect(HealthStatusSchema.safeParse({}).success).toBe(false);
    expect(HealthStatusSchema.safeParse(null).success).toBe(false);
    expect(HealthStatusSchema.safeParse('ok').success).toBe(false);
  });

  it('FAILS when a check status is not ok|error', () => {
    const parsed = HealthStatusSchema.safeParse({
      status: 'ok',
      checks: { kv: { status: 'maybe' } },
    });
    expect(parsed.success).toBe(false);
  });
});
