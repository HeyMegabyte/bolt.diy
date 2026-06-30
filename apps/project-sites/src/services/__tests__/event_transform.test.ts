import {
  extractEventType,
  transformGenericWebhook,
  transformStripeEvent,
  wrapPlatformEvent,
} from '../event_transform';

const NOW = 1719705600000;
const TID = 'org-1';

describe('wrapPlatformEvent', () => {
  it('wraps data in canonical envelope', () => {
    const e = wrapPlatformEvent('test.event', 'test', TID, NOW, { key: 'val' });
    expect(e.type).toBe('test.event');
    expect(e.source).toBe('test');
    expect(e.tenantId).toBe(TID);
    expect(e.data).toEqual({ key: 'val' });
  });
});

describe('transformStripeEvent', () => {
  it('transforms a checkout completed event', () => {
    const raw = {
      id: 'evt_123',
      type: 'checkout.session.completed',
      created: 1719705600,
      data: { object: { customer: 'cus_abc', amount: 2000, status: 'complete' } },
    };
    const e = transformStripeEvent(raw, TID, NOW);
    expect(e.type).toBe('stripe.checkout.session.completed');
    expect(e.source).toBe('stripe');
    expect(e.data.customerId).toBe('cus_abc');
    expect(e.data.amount).toBe(2000);
    expect(e.raw).toBe(raw);
  });

  it('handles sparse events gracefully', () => {
    const e = transformStripeEvent({}, TID, NOW);
    expect(e.type).toBe('stripe.unknown');
    expect(e.source).toBe('stripe');
  });
});

describe('transformGenericWebhook', () => {
  it('uses the body type field', () => {
    const e = transformGenericWebhook({ type: 'user.created' }, 'auth0', 'auth', TID, NOW);
    expect(e.type).toBe('auth.user.created');
    expect(e.source).toBe('auth0');
  });

  it('falls back to .received when no type', () => {
    const e = transformGenericWebhook({}, 'github', 'gh', TID, NOW);
    expect(e.type).toBe('gh.received');
  });
});

describe('extractEventType', () => {
  it('extracts type', () => expect(extractEventType({ type: 'ping' })).toBe('ping'));
  it('extracts event', () => expect(extractEventType({ event: 'push' })).toBe('push'));
  it('extracts event_type', () =>
    expect(extractEventType({ event_type: 'deploy' })).toBe('deploy'));
  it('extracts event_name', () => expect(extractEventType({ event_name: 'build' })).toBe('build'));
  it('returns null for non-object', () => expect(extractEventType(null)).toBeNull());
  it('returns null when no type field', () => expect(extractEventType({})).toBeNull());
});
