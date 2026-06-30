import { aggregateConnectionHealth, scoreConnectionHealth } from '../integration_health';

const HEALTHY = {
  provider: 'stripe',
  lastStatus: 200,
  tokenValid: true,
  lastCallOk: true,
  daysSinceLastUse: 1,
  isConfigured: true,
};
const UNCONFIGURED = { ...HEALTHY, isConfigured: false };
const TOKEN_BAD = { ...HEALTHY, tokenValid: false };
const FAILING_CALL = { ...HEALTHY, lastCallOk: false, lastStatus: 500 };
const STALE = { ...HEALTHY, daysSinceLastUse: 60 };

describe('scoreConnectionHealth', () => {
  it('healthy when all signals green', () =>
    expect(scoreConnectionHealth(HEALTHY)).toBe('healthy'));
  it('unknown when not configured', () =>
    expect(scoreConnectionHealth(UNCONFIGURED)).toBe('unknown'));
  it('failing when token is invalid', () =>
    expect(scoreConnectionHealth(TOKEN_BAD)).toBe('failing'));
  it('failing when last call failed with 5xx', () =>
    expect(scoreConnectionHealth(FAILING_CALL)).toBe('failing'));
  it('degraded for 4xx status', () =>
    expect(scoreConnectionHealth({ ...HEALTHY, lastStatus: 403 })).toBe('degraded'));
  it('degraded for 5xx status with successful call', () =>
    expect(scoreConnectionHealth({ ...HEALTHY, lastStatus: 503 })).toBe('degraded'));
  it('degraded when stale (>30 days)', () => expect(scoreConnectionHealth(STALE)).toBe('degraded'));
});

describe('aggregateConnectionHealth', () => {
  it('all healthy → overall healthy', () => {
    const r = aggregateConnectionHealth([HEALTHY, HEALTHY]);
    expect(r.overall).toBe('healthy');
    expect(r.counts.healthy).toBe(2);
    expect(r.total).toBe(2);
  });

  it('one failing → overall failing', () => {
    const r = aggregateConnectionHealth([HEALTHY, TOKEN_BAD]);
    expect(r.overall).toBe('failing');
    expect(r.counts.failing).toBe(1);
  });

  it('one degraded → overall degraded', () => {
    const r = aggregateConnectionHealth([HEALTHY, STALE]);
    expect(r.overall).toBe('degraded');
  });

  it('empty → healthy', () => {
    const r = aggregateConnectionHealth([]);
    expect(r.overall).toBe('healthy');
    expect(r.total).toBe(0);
  });

  it('all unknown → overall unknown', () => {
    const r = aggregateConnectionHealth([UNCONFIGURED, UNCONFIGURED]);
    expect(r.overall).toBe('unknown');
  });
});
