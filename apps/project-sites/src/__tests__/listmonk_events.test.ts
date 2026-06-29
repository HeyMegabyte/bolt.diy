import {
  eventKey,
  mapListmonkEvent,
  mapListmonkEvents,
  type ListmonkWebhookEvent,
} from '../services/listmonk_events';

// Deterministic baseline timestamp so all tests produce stable keys.
const NOW = 1_716_960_000_000; // 2024-05-29T00:00:00.000Z

describe('mapListmonkEvent', () => {
  it('maps an email.open event correctly', () => {
    const event: ListmonkWebhookEvent = {
      type: 'email.open',
      subscriber_id: 42,
      campaign_id: 7,
      timestamp: '2026-06-29T12:00:00Z',
    };
    const result = mapListmonkEvent(event, NOW);
    expect(result.eventType).toBe('email_open');
    expect(result.subscriberId).toBe('42');
    expect(result.campaignId).toBe('7');
    expect(result.url).toBeNull();
    expect(result.timestamp).toBe('2026-06-29T12:00:00.000Z');
    expect(result.eventKey).toBeTruthy();
    expect(typeof result.eventKey).toBe('string');
  });

  it('maps an email.click event correctly', () => {
    const event: ListmonkWebhookEvent = {
      type: 'email.click',
      subscriber_id: 'abc-123',
      campaign_id: 12,
      url: 'https://example.com/landing',
      timestamp: '2026-06-29T14:30:00Z',
    };
    const result = mapListmonkEvent(event, NOW);
    expect(result.eventType).toBe('email_click');
    expect(result.subscriberId).toBe('abc-123');
    expect(result.campaignId).toBe('12');
    expect(result.url).toBe('https://example.com/landing');
    expect(result.timestamp).toBe('2026-06-29T14:30:00.000Z');
  });

  it('normalises unknown event types to email_event', () => {
    const result = mapListmonkEvent({ type: 'email.bounce', subscriber_id: 1 }, NOW);
    expect(result.eventType).toBe('email_event');
  });

  it('handles an empty type string gracefully', () => {
    const result = mapListmonkEvent({ type: '', subscriber_id: 1 }, NOW);
    expect(result.eventType).toBe('email_event');
  });

  it('handles a numeric subscriber_id by stringifying it', () => {
    const result = mapListmonkEvent({ type: 'email.open', subscriber_id: 999 }, NOW);
    expect(result.subscriberId).toBe('999');
  });

  it('handles missing campaign_id as null', () => {
    const result = mapListmonkEvent({ type: 'email.open', subscriber_id: 1 }, NOW);
    expect(result.campaignId).toBeNull();
  });

  it('handles campaign_id of 0 as string "0"', () => {
    const result = mapListmonkEvent({ type: 'email.open', subscriber_id: 1, campaign_id: 0 }, NOW);
    expect(result.campaignId).toBe('0');
  });

  it('falls back to nowMs when timestamp is missing', () => {
    const result = mapListmonkEvent({ type: 'email.open', subscriber_id: 1 }, NOW);
    expect(result.timestamp).toBe(new Date(NOW).toISOString());
  });

  it('falls back to nowMs when timestamp is unparseable', () => {
    const result = mapListmonkEvent(
      { type: 'email.open', subscriber_id: 1, timestamp: 'not-a-date' },
      NOW,
    );
    expect(result.timestamp).toBe(new Date(NOW).toISOString());
  });

  it('never throws on null/undefined input fields', () => {
    const result = mapListmonkEvent(
      // @ts-expect-error testing null input
      null as unknown as ListmonkWebhookEvent,
      NOW,
    );
    // Should still produce a valid event with empty-ish defaults
    expect(result.subscriberId).toBe('');
    expect(result.campaignId).toBeNull();
    expect(result.url).toBeNull();
    expect(result.eventType).toBe('email_event');
  });

  it('produces a stable eventKey for identical inputs', () => {
    const a = mapListmonkEvent(
      { type: 'email.open', subscriber_id: 1, campaign_id: 2, timestamp: '2026-01-01T00:00:00Z' },
      NOW,
    );
    const b = mapListmonkEvent(
      { type: 'email.open', subscriber_id: 1, campaign_id: 2, timestamp: '2026-01-01T00:00:00Z' },
      NOW,
    );
    expect(a.eventKey).toBe(b.eventKey);
  });

  it('produces different eventKeys for different inputs', () => {
    const a = mapListmonkEvent(
      { type: 'email.open', subscriber_id: 1, campaign_id: 2, timestamp: '2026-01-01T00:00:00Z' },
      NOW,
    );
    const b = mapListmonkEvent(
      { type: 'email.click', subscriber_id: 1, campaign_id: 2, timestamp: '2026-01-01T00:00:00Z' },
      NOW,
    );
    expect(a.eventKey).not.toBe(b.eventKey);
  });
});

describe('mapListmonkEvents', () => {
  it('batch-maps an array of events', () => {
    const events: readonly ListmonkWebhookEvent[] = [
      { type: 'email.open', subscriber_id: 1, campaign_id: 5 },
      { type: 'email.click', subscriber_id: 2, campaign_id: 5, url: 'https://x.com' },
    ];
    const results = mapListmonkEvents(events, NOW);
    expect(results).toHaveLength(2);
    expect(results[0].eventType).toBe('email_open');
    expect(results[1].eventType).toBe('email_click');
  });

  it('returns an empty array for null input', () => {
    const results = mapListmonkEvents(null as unknown as readonly ListmonkWebhookEvent[], NOW);
    expect(results).toEqual([]);
  });

  it('returns an empty array for undefined input', () => {
    const results = mapListmonkEvents(undefined as unknown as readonly ListmonkWebhookEvent[], NOW);
    expect(results).toEqual([]);
  });

  it('returns an empty array for an empty input array', () => {
    const results = mapListmonkEvents([], NOW);
    expect(results).toEqual([]);
  });

  it('skips null/undefined items in the array', () => {
    const events: readonly (ListmonkWebhookEvent | null)[] = [
      { type: 'email.open', subscriber_id: 1 },
      null,
      { type: 'email.click', subscriber_id: 2 },
      undefined,
    ];
    const results = mapListmonkEvents(events as unknown as readonly ListmonkWebhookEvent[], NOW);
    expect(results).toHaveLength(2);
    expect(results[0].subscriberId).toBe('1');
    expect(results[1].subscriberId).toBe('2');
  });
});

describe('eventKey', () => {
  it('returns a deterministic hex string', () => {
    const key = eventKey('42', '7', 'email_open', '2026-06-29T12:00:00Z');
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
    expect(/^[0-9a-f]+$/.test(key)).toBe(true);
  });

  it('returns the same key for identical inputs', () => {
    const a = eventKey('42', '7', 'email_open', '2026-06-29T12:00:00Z');
    const b = eventKey('42', '7', 'email_open', '2026-06-29T12:00:00Z');
    expect(a).toBe(b);
  });

  it('returns different keys when a component differs', () => {
    const a = eventKey('42', '7', 'email_open', '2026-06-29T12:00:00Z');
    const b = eventKey('43', '7', 'email_open', '2026-06-29T12:00:00Z');
    expect(a).not.toBe(b);
  });

  it('handles null campaignId gracefully', () => {
    const key = eventKey('42', null, 'email_open', '2026-06-29T12:00:00Z');
    expect(typeof key).toBe('string');
    // Should differ from a key with a non-null campaignId
    const keyWithCampaign = eventKey('42', '7', 'email_open', '2026-06-29T12:00:00Z');
    expect(key).not.toBe(keyWithCampaign);
  });

  it('handles empty strings without throwing', () => {
    const key = eventKey('', null, '', '');
    expect(typeof key).toBe('string');
    // Running it again should be stable
    expect(key).toBe(eventKey('', null, '', ''));
  });
});
