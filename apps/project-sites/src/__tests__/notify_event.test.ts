import { notifyEvent, notifyOwnerEvent } from '../services/notify';
import type { Env } from '../types/env';

const baseEnv = {} as unknown as Env;

describe('notifyEvent', () => {
  it('validates + renders a valid psnotify event', async () => {
    const result = await notifyEvent(baseEnv, {
      subscriberId: 'u@x.com',
      event: {
        name: 'site_published',
        subscriberId: 'u@x.com',
        payload: { subject: 'Live', body: 'Your site is live' },
      },
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok:false on an invalid event shape', async () => {
    const result = await notifyEvent(baseEnv, { subscriberId: 'u@x.com', event: { bogus: true } });
    expect(result).toEqual({ ok: false, detail: 'invalid_event' });
  });

  it('propagates empty subscriber rejection', async () => {
    const result = await notifyEvent(baseEnv, {
      subscriberId: '',
      event: { name: 'x', subscriberId: 'u@x.com', payload: {} },
    });
    expect(result).toEqual({ ok: false, detail: 'no_subscriber' });
  });
});

describe('notifyOwnerEvent', () => {
  const makeDb = (email: string | null) =>
    ({
      prepare: () => ({ bind: () => ({ first: async () => (email ? { email } : null) }) }),
    }) as unknown as D1Database;

  it('returns ok:false on an invalid event shape (before D1 lookup)', async () => {
    const result = await notifyOwnerEvent(baseEnv, makeDb('o@org.com'), {
      orgId: 'org_1',
      event: { bogus: true },
    });
    expect(result).toEqual({ ok: false, detail: 'invalid_event' });
  });
});
