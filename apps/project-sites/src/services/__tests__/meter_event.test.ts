/**
 * @module services/__tests__/meter_event.test
 * @description Tests for LOOP-BILL-002 metering event schema + producer helper.
 */

import {
  isKnownMeterEvent,
  listMeterEventNames,
  meterEvent,
  meterEventBatch,
} from '../meter_event';

const TS = 1719705600;
const IDEMPOTENCY_KEY = 'site_build:1719705600:abc123';

describe('meterEvent', () => {
  it('constructs a minimal event with defaults', () => {
    const event = meterEvent('site_build', IDEMPOTENCY_KEY, TS);
    expect(event.event_name).toBe('site_build');
    expect(event.timestamp).toBe(TS);
    expect(event.idempotency_key).toBe(IDEMPOTENCY_KEY);
    expect(event.value).toBe(1);
    expect(event.payload).toEqual({});
    expect(event.customer_id).toBeUndefined();
  });

  it('accepts a customer ID', () => {
    const event = meterEvent('site_publish', IDEMPOTENCY_KEY, TS, {
      customerId: 'cus_abc123',
    });
    expect(event.customer_id).toBe('cus_abc123');
  });

  it('accepts a custom value', () => {
    const event = meterEvent('bandwidth_egress', IDEMPOTENCY_KEY, TS, {
      value: 1024,
    });
    expect(event.value).toBe(1024);
  });

  it('accepts a payload map', () => {
    const event = meterEvent('api_call', IDEMPOTENCY_KEY, TS, {
      payload: { method: 'POST', path: '/api/sites' },
    });
    expect(event.payload).toEqual({ method: 'POST', path: '/api/sites' });
  });

  it('validates the event_name against the known enum', () => {
    const event = meterEvent('site_visit', IDEMPOTENCY_KEY, TS);
    expect(event.event_name).toBe('site_visit');
  });

  it('rejects negative values', () => {
    expect(() => meterEvent('site_build', IDEMPOTENCY_KEY, TS, { value: -1 })).toThrow();
  });

  it('rejects zero values', () => {
    expect(() => meterEvent('site_build', IDEMPOTENCY_KEY, TS, { value: 0 })).toThrow();
  });
});

describe('meterEventBatch', () => {
  it('constructs a batch of events', () => {
    const events = meterEventBatch(['site_build', 'site_publish', 'site_visit'], 'batch_001', TS, {
      customerId: 'cus_xyz',
    });
    expect(events).toHaveLength(3);
    expect(events[0].event_name).toBe('site_build');
    expect(events[0].idempotency_key).toBe('batch_001:site_build');
    expect(events[1].event_name).toBe('site_publish');
    expect(events[1].idempotency_key).toBe('batch_001:site_publish');
    expect(events[2].event_name).toBe('site_visit');
    expect(events[2].idempotency_key).toBe('batch_001:site_visit');
  });

  it('returns empty array for empty input', () => {
    expect(meterEventBatch([], 'prefix', TS)).toEqual([]);
  });
});

describe('isKnownMeterEvent', () => {
  it('returns true for known events', () => {
    expect(isKnownMeterEvent('site_build')).toBe(true);
    expect(isKnownMeterEvent('ai_token_input')).toBe(true);
    expect(isKnownMeterEvent('email_sent')).toBe(true);
  });

  it('returns false for unknown events', () => {
    expect(isKnownMeterEvent('bogus_event')).toBe(false);
    expect(isKnownMeterEvent('')).toBe(false);
  });
});

describe('listMeterEventNames', () => {
  it('returns all 18 known event names', () => {
    const names = listMeterEventNames();
    expect(names).toHaveLength(18);
    expect(names).toContain('api_call');
    expect(names).toContain('site_build');
    expect(names).toContain('ai_token_input');
    expect(names).toContain('voice_call_minute');
  });
});
