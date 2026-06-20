import {
  dispatchBatch,
  criticalSucceeded,
  FORWARD_ORDER,
  type ProviderId,
} from '../services/event_dispatch';
import { CircuitBreaker } from '../services/circuit_breaker';
import type { IncomingEvent } from '../services/analytics_events';

const NOW = 1_700_000_000_000;
const batch: IncomingEvent[] = [
  {
    eventId: '123e4567-e89b-42d3-a456-426614174000',
    siteId: 's1',
    eventType: 'pageview',
    timestamp: NOW,
  },
];

function deps(opts: {
  forward?: (p: ProviderId) => Promise<void>;
  breakers?: Map<ProviderId, CircuitBreaker>;
  configured?: (p: ProviderId) => boolean;
}) {
  return {
    forward: jest.fn(async (p: ProviderId) => {
      if (opts.forward) return opts.forward(p);
    }),
    breakers: opts.breakers ?? new Map<ProviderId, CircuitBreaker>(),
    configured: opts.configured ?? (() => true),
  };
}

describe('dispatchBatch', () => {
  it('forwards to every configured provider and returns outcomes in Sentry-first order', async () => {
    const d = deps({});
    const out = await dispatchBatch(batch, d, NOW);
    expect(out.map((o) => o.provider)).toEqual([...FORWARD_ORDER]);
    expect(out.every((o) => o.status === 'forwarded')).toBe(true);
    expect(out[0]).toMatchObject({ provider: 'sentry', critical: true });
    expect(d.forward).toHaveBeenCalledTimes(4);
  });

  it('marks a provider not_configured and does not call forward for it', async () => {
    const d = deps({ configured: (p) => p !== 'gtm' });
    const out = await dispatchBatch(batch, d, NOW);
    expect(out.find((o) => o.provider === 'gtm')?.status).toBe('not_configured');
    expect(d.forward).toHaveBeenCalledTimes(3);
    expect(d.forward).not.toHaveBeenCalledWith('gtm', batch);
  });

  it('skips a provider whose breaker is open and records skipped_open', async () => {
    const breakers = new Map<ProviderId, CircuitBreaker>();
    const openCb = new CircuitBreaker({ failureThreshold: 1 });
    openCb.recordFailure(NOW); // → open
    breakers.set('posthog', openCb);
    const d = deps({ breakers });
    const out = await dispatchBatch(batch, d, NOW);
    expect(out.find((o) => o.provider === 'posthog')?.status).toBe('skipped_open');
    expect(d.forward).not.toHaveBeenCalledWith('posthog', batch);
    // others still forwarded
    expect(out.find((o) => o.provider === 'sentry')?.status).toBe('forwarded');
  });

  it('records a failure on the breaker when forward rejects', async () => {
    const breakers = new Map<ProviderId, CircuitBreaker>();
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    breakers.set('ga4', cb);
    const d = deps({
      breakers,
      forward: async (p) => {
        if (p === 'ga4') throw new Error('502');
      },
    });
    const out = await dispatchBatch(batch, d, NOW);
    const ga4 = out.find((o) => o.provider === 'ga4');
    expect(ga4?.status).toBe('failed');
    expect(ga4?.error).toBe('502');
    expect(cb.snapshot().failCount).toBe(1);
  });

  it('records a success on the breaker when forward resolves', async () => {
    const breakers = new Map<ProviderId, CircuitBreaker>();
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    cb.recordFailure(NOW); // 1 prior failure
    breakers.set('sentry', cb);
    const d = deps({ breakers });
    await dispatchBatch(batch, d, NOW);
    expect(cb.state).toBe('closed');
    expect(cb.snapshot().failCount).toBe(0); // success reset
  });
});

describe('criticalSucceeded', () => {
  it('true when Sentry forwarded, false when Sentry failed', async () => {
    const ok = await dispatchBatch(batch, deps({}), NOW);
    expect(criticalSucceeded(ok)).toBe(true);

    const fail = await dispatchBatch(
      batch,
      deps({
        forward: async (p) => {
          if (p === 'sentry') throw new Error('down');
        },
      }),
      NOW,
    );
    expect(criticalSucceeded(fail)).toBe(false);
  });

  it('true when Sentry is not configured (no critical sink to satisfy)', async () => {
    const out = await dispatchBatch(batch, deps({ configured: (p) => p !== 'sentry' }), NOW);
    expect(criticalSucceeded(out)).toBe(true);
  });
});
