import {
  type Channel,
  CHANNEL_LIMITS,
  routeNotification,
  shouldBatch,
} from '../services/notification_router.js';

const critical: Channel = 'email';
const stub = (
  overrides?: Partial<{
    id: string;
    channel: Channel;
    priority: 'low' | 'normal' | 'high' | 'critical';
    title: string;
    body: string;
    recipient: string;
  }>,
): ReturnType<typeof routeNotification> extends unknown[]
  ? Parameters<typeof routeNotification>[0]
  : never =>
  ({
    id: 'n1',
    channel: 'email',
    priority: 'normal',
    title: 'Test',
    body: 'Test body',
    recipient: 'usr_1',
    ...overrides,
  }) as any;

describe('CHANNEL_LIMITS', () => {
  it('defines per-hour limits for every channel', () => {
    expect(CHANNEL_LIMITS.email).toBe(10);
    expect(CHANNEL_LIMITS.push).toBe(5);
    expect(CHANNEL_LIMITS.in_app).toBe(50);
    expect(CHANNEL_LIMITS.sms).toBe(3);
  });
});

describe('shouldBatch', () => {
  it('returns true for email and push', () => {
    expect(shouldBatch('email')).toBe(true);
    expect(shouldBatch('push')).toBe(true);
  });

  it('returns false for in_app and sms', () => {
    expect(shouldBatch('in_app')).toBe(false);
    expect(shouldBatch('sms')).toBe(false);
  });
});

describe('routeNotification', () => {
  const allOn: Record<Channel, boolean> = {
    email: true,
    push: true,
    in_app: true,
    sms: true,
  };
  const allOff: Record<Channel, boolean> = {
    email: false,
    push: false,
    in_app: false,
    sms: false,
  };

  it('includes the original channel when it is enabled in prefs', () => {
    const prefs: Record<Channel, boolean> = { ...allOff, email: true };
    expect(routeNotification(stub({ channel: 'email' }), prefs)).toEqual(['email']);
    expect(routeNotification(stub({ channel: 'push' }), prefs)).toEqual([]);
  });

  it('omits the channel when its pref is off (non-critical)', () => {
    const prefs: Record<Channel, boolean> = { ...allOn, email: false };
    expect(routeNotification(stub({ channel: 'email', priority: 'normal' }), prefs)).toEqual([]);
  });

  it('critical always includes email even when email pref is off', () => {
    const prefs: Record<Channel, boolean> = { ...allOff };
    expect(routeNotification(stub({ channel: 'sms', priority: 'critical' }), prefs)).toEqual([
      'email',
    ]);
  });

  it('critical does NOT duplicate email when it is already the active channel', () => {
    const prefs: Record<Channel, boolean> = { ...allOff, sms: true };
    const result = routeNotification(stub({ channel: 'email', priority: 'critical' }), {
      ...allOff,
      email: true,
    });
    expect(result).toEqual(['email']);
  });

  it('returns both channels when original is enabled AND critical adds email', () => {
    const prefs: Record<Channel, boolean> = { ...allOff, sms: true };
    const result = routeNotification(stub({ channel: 'sms', priority: 'critical' }), prefs);
    expect(result).toEqual(['sms', 'email']);
  });

  it('low / normal / high priority respect prefs without override', () => {
    const priorities: Array<'low' | 'normal' | 'high'> = ['low', 'normal', 'high'];
    for (const p of priorities) {
      expect(routeNotification(stub({ channel: 'sms', priority: p }), allOff)).toEqual([]);
    }
  });

  it('returns an empty array when no channel is viable', () => {
    expect(routeNotification(stub({ channel: 'push' }), allOff)).toEqual([]);
  });
});
