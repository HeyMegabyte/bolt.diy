import {
  trackDelivery,
  deliveryStats,
  failingEndpoints,
  type DeliveryEvent,
  type DeliveryStats,
} from '../webhook_monitor';

const NOW = '2026-06-29T12:00:00.000Z';
const LATER = '2026-06-29T12:05:00.000Z';

const STUB_DELIVERED: DeliveryEvent = {
  webhookId: 'wh_a',
  url: 'https://a.com/hook',
  status: 'delivered',
  statusCode: 200,
  error: null,
  ts: NOW,
};

const STUB_FAILED: DeliveryEvent = {
  webhookId: 'wh_b',
  url: 'https://b.com/hook',
  status: 'failed',
  statusCode: 503,
  error: 'upstream timeout',
  ts: NOW,
};

describe('trackDelivery', () => {
  it('creates a delivered event with the given ts', () => {
    const ev = trackDelivery('wh_a', 'https://a.com/hook', 'delivered', 200, null, NOW);

    expect(ev).toEqual<DeliveryEvent>({
      webhookId: 'wh_a',
      url: 'https://a.com/hook',
      status: 'delivered',
      statusCode: 200,
      error: null,
      ts: NOW,
    });
  });

  it('creates a failed event with the given ts', () => {
    const ev = trackDelivery('wh_b', 'https://b.com/hook', 'failed', 503, 'timeout', NOW);

    expect(ev.status).toBe('failed');
    expect(ev.statusCode).toBe(503);
    expect(ev.error).toBe('timeout');
    expect(ev.ts).toBe(NOW);
  });

  it('defaults ts to a non-empty ISO string when omitted', () => {
    const ev = trackDelivery('wh_c', 'https://c.com/hook', 'delivered', 200, null);

    expect(ev.ts).toBeTruthy();
    expect(typeof ev.ts).toBe('string');
    expect(ev.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('accepts a statusCode of 0 for network-level failure', () => {
    const ev = trackDelivery('wh_d', 'https://d.com/hook', 'failed', 0, 'ECONNREFUSED', NOW);

    expect(ev.statusCode).toBe(0);
    expect(ev.error).toBe('ECONNREFUSED');
  });

  it('sets error to null for delivered events', () => {
    const ev = trackDelivery('wh_a', 'https://a.com/hook', 'delivered', 200, null, NOW);

    expect(ev.error).toBeNull();
  });

  it('returns a plain object (not the input reference)', () => {
    const ev = trackDelivery('wh_a', 'https://a.com/hook', 'delivered', 200, null, NOW);

    expect(ev).toBeInstanceOf(Object);
  });

  it('returns an immutable-looking shape each call', () => {
    const a = trackDelivery('wh_x', 'https://x.com/hook', 'delivered', 200, null, NOW);
    const b = trackDelivery('wh_x', 'https://x.com/hook', 'delivered', 200, null, NOW);

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('deliveryStats', () => {
  it('returns empty stats for empty input', () => {
    const stats = deliveryStats([]);

    expect(stats).toEqual<DeliveryStats>({
      total: 0,
      delivered: 0,
      failed: 0,
      overallFailureRate: 0,
      byEndpoint: [],
    });
  });

  it('returns 100% delivered for all-successful events', () => {
    const stats = deliveryStats([STUB_DELIVERED]);

    expect(stats.total).toBe(1);
    expect(stats.delivered).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.overallFailureRate).toBe(0);
  });

  it('returns 0% delivered for all-failed events', () => {
    const stats = deliveryStats([STUB_FAILED, { ...STUB_FAILED, ts: LATER }]);

    expect(stats.total).toBe(2);
    expect(stats.delivered).toBe(0);
    expect(stats.failed).toBe(2);
    expect(stats.overallFailureRate).toBe(1);
  });

  it('computes correct stats for a mix of delivered and failed', () => {
    const stats = deliveryStats([
      STUB_DELIVERED,
      { ...STUB_DELIVERED, webhookId: 'wh_c', url: 'https://c.com/hook' },
      STUB_FAILED,
    ]);

    // 2 delivered / 3 total = 0.666... → 0.667
    expect(stats.total).toBe(3);
    expect(stats.delivered).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.overallFailureRate).toBe(0.333);
  });

  it('returns per-endpoint breakdown', () => {
    const events: DeliveryEvent[] = [
      { webhookId: 'wh_x', url: 'https://x.com/hook', status: 'delivered', statusCode: 200, error: null, ts: NOW },
      { webhookId: 'wh_x', url: 'https://x.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      { webhookId: 'wh_y', url: 'https://y.com/hook', status: 'delivered', statusCode: 200, error: null, ts: NOW },
    ];
    const stats = deliveryStats(events);

    expect(stats.byEndpoint).toHaveLength(2);

    const xStats = stats.byEndpoint.find(e => e.webhookId === 'wh_x');
    expect(xStats).toBeDefined();
    expect(xStats!.total).toBe(2);
    expect(xStats!.delivered).toBe(1);
    expect(xStats!.failed).toBe(1);
    expect(xStats!.failureRate).toBe(0.5);

    const yStats = stats.byEndpoint.find(e => e.webhookId === 'wh_y');
    expect(yStats).toBeDefined();
    expect(yStats!.total).toBe(1);
    expect(yStats!.delivered).toBe(1);
    expect(yStats!.failed).toBe(0);
    expect(yStats!.failureRate).toBe(0);
  });

  it('handles multiple endpoints with different failure rates', () => {
    const events: DeliveryEvent[] = [
      // wh_a: 4 delivered, 0 failed → 0%
      { webhookId: 'wh_a', url: 'https://a.com/hook', status: 'delivered', statusCode: 200, error: null, ts: NOW },
      { webhookId: 'wh_a', url: 'https://a.com/hook', status: 'delivered', statusCode: 200, error: null, ts: LATER },
      // wh_b: 2 delivered, 2 failed → 0.5
      { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'delivered', statusCode: 200, error: null, ts: NOW },
      { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'delivered', statusCode: 200, error: null, ts: LATER },
      { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'failed', statusCode: 503, error: 'timeout', ts: LATER },
    ];
    const stats = deliveryStats(events);

    const aStats = stats.byEndpoint.find(e => e.webhookId === 'wh_a');
    expect(aStats!.failureRate).toBe(0);

    const bStats = stats.byEndpoint.find(e => e.webhookId === 'wh_b');
    expect(bStats!.failureRate).toBe(0.5);
  });

  it('does not mutate the input array', () => {
    const events: DeliveryEvent[] = [STUB_DELIVERED, STUB_FAILED];
    const copy = [...events];
    deliveryStats(events);

    expect(events).toEqual(copy);
  });

  it('accepts a frozen readonly array', () => {
    const events: readonly DeliveryEvent[] = Object.freeze([STUB_DELIVERED, STUB_FAILED]);
    const stats = deliveryStats(events);

    expect(stats.total).toBe(2);
    expect(stats.delivered).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it('overallFailureRate is 0 when total is 0', () => {
    const stats = deliveryStats([]);
    expect(stats.overallFailureRate).toBe(0);
  });
});

describe('failingEndpoints', () => {
  it('returns empty array for empty input', () => {
    const result = failingEndpoints([], 0.5);

    expect(result).toEqual([]);
  });

  it('returns empty array when threshold is 1 (no endpoint exceeds 100%)', () => {
    const result = failingEndpoints([STUB_FAILED], 1);

    expect(result).toEqual([]);
  });

  it('returns no entries when all endpoints are below threshold', () => {
    const events: DeliveryEvent[] = [
      { webhookId: 'wh_a', url: 'https://a.com/hook', status: 'delivered', statusCode: 200, error: null, ts: NOW },
      { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'delivered', statusCode: 200, error: null, ts: NOW },
    ];
    // wh_b has 1/2 = 0.5 failure rate — not greater than 0.5
    const result = failingEndpoints(events, 0.5);

    expect(result).toEqual([]);
  });

  it('returns endpoints whose failure rate exceeds threshold', () => {
    const events: DeliveryEvent[] = [
      { webhookId: 'wh_a', url: 'https://a.com/hook', status: 'delivered', statusCode: 200, error: null, ts: NOW },
      { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'failed', statusCode: 503, error: 'timeout', ts: NOW },
      { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'failed', statusCode: 503, error: 'timeout', ts: LATER },
    ];

    const result = failingEndpoints(events, 0.5);

    expect(result).toHaveLength(1);
    expect(result[0].webhookId).toBe('wh_b');
    expect(result[0].failureRate).toBe(1);
    expect(result[0].total).toBe(2);
    expect(result[0].failed).toBe(2);
  });

  it('returns multiple failing endpoints sorted by failure rate descending', () => {
    const events: DeliveryEvent[] = [
      // wh_x: 2/2 failed = 1.0
      { webhookId: 'wh_x', url: 'https://x.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      { webhookId: 'wh_x', url: 'https://x.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      // wh_y: 3/4 failed = 0.75
      { webhookId: 'wh_y', url: 'https://y.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      { webhookId: 'wh_y', url: 'https://y.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      { webhookId: 'wh_y', url: 'https://y.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      { webhookId: 'wh_y', url: 'https://y.com/hook', status: 'delivered', statusCode: 200, error: null, ts: NOW },
      // wh_z: 2/3 failed = 0.667
      { webhookId: 'wh_z', url: 'https://z.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      { webhookId: 'wh_z', url: 'https://z.com/hook', status: 'failed', statusCode: 500, error: 'err', ts: NOW },
      { webhookId: 'wh_z', url: 'https://z.com/hook', status: 'delivered', statusCode: 200, error: null, ts: NOW },
    ];

    const result = failingEndpoints(events, 0.6);

    // wh_z (2/3 = 0.667) also exceeds 0.6 — all three should be returned
    expect(result).toHaveLength(3);
    // Sorted descending: wh_x (1.0) > wh_y (0.75) > wh_z (0.667)
    expect(result[0].webhookId).toBe('wh_x');
    expect(result[1].webhookId).toBe('wh_y');
    expect(result[2].webhookId).toBe('wh_z');
    expect(result[0].failureRate).toBe(1);
    expect(result[1].failureRate).toBe(0.75);
    expect(result[2].failureRate).toBe(0.667);
  });

  it('returns empty when threshold is 0 and there are no events', () => {
    const result = failingEndpoints([], 0);

    expect(result).toEqual([]);
  });

  it('returns endpoint with any failure when threshold is 0', () => {
    const result = failingEndpoints([STUB_DELIVERED, STUB_FAILED], 0);

    expect(result).toHaveLength(1);
    expect(result[0].webhookId).toBe('wh_b');
  });

  it('does not mutate the input array', () => {
    const events: DeliveryEvent[] = [STUB_DELIVERED, STUB_FAILED, STUB_FAILED];
    const copy = [...events];
    failingEndpoints(events, 0.5);

    expect(events).toEqual(copy);
  });

  it('accepts a frozen readonly array', () => {
    const events: readonly DeliveryEvent[] = Object.freeze([
      STUB_DELIVERED,
      { ...STUB_FAILED, ts: LATER },
    ]);
    const result = failingEndpoints(events, 0);

    expect(result).toHaveLength(1);
    expect(result[0].webhookId).toBe('wh_b');
  });
});

describe('TypeScript contract', () => {
  it('DeliveryEvent is a valid structural type', () => {
    const event: DeliveryEvent = {
      webhookId: 'wh_test',
      url: 'https://test.com/hook',
      status: 'delivered',
      statusCode: 200,
      error: null,
      ts: '2026-06-29T12:00:00.000Z',
    };
    expect(event.webhookId).toBe('wh_test');
  });

  it('DeliveryEvent error can be a string', () => {
    const event: DeliveryEvent = {
      webhookId: 'wh_test',
      url: 'https://test.com/hook',
      status: 'failed',
      statusCode: 502,
      error: 'BAD_GATEWAY',
      ts: '2026-06-29T12:00:00.000Z',
    };
    expect(event.error).toBe('BAD_GATEWAY');
  });

  it('DeliveryEvent status is typed as delivered or failed', () => {
    const delivered: DeliveryEvent = { ...STUB_DELIVERED, webhookId: 'wh_ts' };
    const failed: DeliveryEvent = { ...STUB_FAILED, webhookId: 'wh_ts' };

    expect(delivered.status).toBe('delivered');
    expect(failed.status).toBe('failed');
  });

  it('DeliveryStats shape is complete', () => {
    const stats: DeliveryStats = {
      total: 5,
      delivered: 3,
      failed: 2,
      overallFailureRate: 0.4,
      byEndpoint: [],
    };
    expect(stats.overallFailureRate).toBe(0.4);
  });

  it('trackDelivery returns DeliveryEvent', () => {
    const result: DeliveryEvent = trackDelivery('wh_a', 'https://a.com/hook', 'delivered', 200, null, NOW);
    expect(result.webhookId).toBe('wh_a');
  });

  it('deliveryStats accepts readonly DeliveryEvent[]', () => {
    const result: DeliveryStats = deliveryStats(Object.freeze([STUB_DELIVERED]));
    expect(result.total).toBe(1);
  });
});
