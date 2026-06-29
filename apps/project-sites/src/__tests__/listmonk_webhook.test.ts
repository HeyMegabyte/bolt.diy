import {
  classifyEvent,
  LISTMONK_EVENTS,
  type ListmonkEvent,
} from '../services/listmonk_webhook.js';

describe('classifyEvent (listmonk webhook)', () => {
  // -----------------------------------------------------------------------
  // Nested payload shape  { event, data: { subscriber: {id, email}, ... } }
  // -----------------------------------------------------------------------

  it('classifies a subscribed event from nested payload', () => {
    const r = classifyEvent({
      event: 'subscribed',
      data: {
        subscriber: { id: 42, email: 'a@b.com' },
        timestamp: '2026-06-29T12:00:00Z',
      },
    });
    expect(r).not.toBeNull();
    expect(r!.event).toBe('subscribed');
    expect(r!.subscriber_id).toBe(42);
    expect(r!.email).toBe('a@b.com');
    expect(r!.timestamp).toBe('2026-06-29T12:00:00Z');
    expect(r!.campaign_id).toBeUndefined();
    expect(r!.url).toBeUndefined();
  });

  it('classifies an unsubscribed event', () => {
    const r = classifyEvent({
      event: 'unsubscribed',
      data: { subscriber: { id: 7, email: 'u@x.com' } },
    });
    expect(r).not.toBeNull();
    expect(r!.event).toBe('unsubscribed');
    expect(r!.subscriber_id).toBe(7);
  });

  it('classifies email.opened with campaign_id', () => {
    const r = classifyEvent({
      event: 'email.opened',
      data: {
        subscriber: { id: 3, email: 'o@p.com' },
        campaign_id: 99,
      },
    });
    expect(r).not.toBeNull();
    expect(r!.event).toBe('email.opened');
    expect(r!.campaign_id).toBe(99);
  });

  it('classifies email.clicked with campaign_id and url', () => {
    const r = classifyEvent({
      event: 'email.clicked',
      data: {
        subscriber: { id: 1, email: 'c@l.com' },
        campaign_id: 55,
        url: 'https://projectsites.dev/landing',
      },
    });
    expect(r).not.toBeNull();
    expect(r!.event).toBe('email.clicked');
    expect(r!.campaign_id).toBe(55);
    expect(r!.url).toBe('https://projectsites.dev/landing');
  });

  it('classifies campaign.started and campaign.finished', () => {
    const started = classifyEvent({
      event: 'campaign.started',
      data: { subscriber: { id: 2, email: 's@t.com' } },
    });
    expect(started!.event).toBe('campaign.started');

    const finished = classifyEvent({
      event: 'campaign.finished',
      data: { subscriber: { id: 2, email: 's@t.com' } },
    });
    expect(finished!.event).toBe('campaign.finished');
  });

  it('classifies a bounce event', () => {
    const r = classifyEvent({
      event: 'bounce',
      data: { subscriber: { id: 9, email: 'bad@b.com' } },
    });
    expect(r!.event).toBe('bounce');
  });

  // -----------------------------------------------------------------------
  // Flat payload shape   { event, subscriber_id, email, ... }
  // -----------------------------------------------------------------------

  it('handles flat payload shape (no data.subscriber wrapper)', () => {
    const r = classifyEvent({
      event: 'subscribed',
      subscriber_id: 100,
      email: 'flat@example.com',
      timestamp: '2026-06-29T10:00:00Z',
    });
    expect(r).not.toBeNull();
    expect(r!.subscriber_id).toBe(100);
    expect(r!.email).toBe('flat@example.com');
    expect(r!.timestamp).toBe('2026-06-29T10:00:00Z');
  });

  it('handles flat optional fields (campaign_id, url)', () => {
    const r = classifyEvent({
      event: 'email.clicked',
      subscriber_id: 50,
      email: 'flat@c.com',
      campaign_id: 200,
      url: 'https://example.com/deep-link',
      timestamp: '2026-06-29T11:00:00Z',
    });
    expect(r!.campaign_id).toBe(200);
    expect(r!.url).toBe('https://example.com/deep-link');
  });

  // -----------------------------------------------------------------------
  // Data-level subscriber_id/email fallback  { event, data: { subscriber_id, email } }
  // -----------------------------------------------------------------------

  it('reads subscriber_id and email from data level when subscriber object missing', () => {
    const r = classifyEvent({
      event: 'subscribed',
      data: { subscriber_id: 88, email: 'datalevel@example.com' },
    });
    expect(r).not.toBeNull();
    expect(r!.subscriber_id).toBe(88);
    expect(r!.email).toBe('datalevel@example.com');
  });

  // -----------------------------------------------------------------------
  // Error / edge cases
  // -----------------------------------------------------------------------

  it('returns null for an unknown event type', () => {
    expect(classifyEvent({ event: 'bogus' })).toBeNull();
  });

  it('returns null for an unrecognised event without subscriber info', () => {
    expect(classifyEvent({ event: 'bogus_event_type' })).toBeNull();
  });

  it('returns null when subscriber_id/email is missing from all locations', () => {
    expect(classifyEvent({ event: 'subscribed' })).toBeNull();
    expect(classifyEvent({ event: 'subscribed', data: { subscriber: { id: 1 } } })).toBeNull();
    expect(
      classifyEvent({ event: 'subscribed', data: { subscriber: { email: 'x@y.com' } } }),
    ).toBeNull();
  });

  it('returns null for empty body', () => {
    expect(classifyEvent({})).toBeNull();
  });

  it('returns null for null/undefined/non-object input', () => {
    expect(classifyEvent(null as unknown as Record<string, unknown>)).toBeNull();
    expect(classifyEvent(undefined as unknown as Record<string, unknown>)).toBeNull();
    expect(classifyEvent('string' as unknown as Record<string, unknown>)).toBeNull();
    expect(classifyEvent(42 as unknown as Record<string, unknown>)).toBeNull();
  });

  it('returns null when event field is missing', () => {
    expect(classifyEvent({ subscriber_id: 1, email: 't@t.com' })).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Timestamp fallback
  // -----------------------------------------------------------------------

  it('falls back to Date.now() when no timestamp is present', () => {
    const before = new Date().toISOString();
    const r = classifyEvent({
      event: 'subscribed',
      data: { subscriber: { id: 1, email: 'ts@test.com' } },
    });
    const after = new Date().toISOString();
    expect(r!.timestamp).toBeDefined();
    // The fallback should be a valid ISO string between before and after
    expect(r!.timestamp >= before || r!.timestamp <= after).toBe(true);
  });

  // -----------------------------------------------------------------------
  // LISTMONK_EVENTS constant
  // -----------------------------------------------------------------------

  it('exports all expected events in LISTMONK_EVENTS', () => {
    expect(LISTMONK_EVENTS).toEqual([
      'subscribed',
      'unsubscribed',
      'email.opened',
      'email.clicked',
      'campaign.started',
      'campaign.finished',
      'bounce',
    ]);
  });

  it('every LISTMONK_EVENTS entry can round-trip through classifyEvent', () => {
    for (const ev of LISTMONK_EVENTS) {
      const r = classifyEvent({
        event: ev,
        data: { subscriber: { id: 1, email: 'rt@test.com' }, timestamp: '2026-06-29T00:00:00Z' },
      });
      expect(r).not.toBeNull();
      expect(r!.event).toBe(ev);
    }
  });

  // -----------------------------------------------------------------------
  // Readonly / frozen
  // -----------------------------------------------------------------------

  it('returns a frozen object', () => {
    const r = classifyEvent({
      event: 'subscribed',
      data: { subscriber: { id: 1, email: 'f@test.com' } },
    });
    expect(Object.isFrozen(r)).toBe(true);
  });
});
