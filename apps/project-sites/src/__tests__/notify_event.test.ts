import { notifyEvent, notifyOwnerEvent } from '../services/notify';
import type { Env } from '../types/env';

// No NOVU key in the test env → notifyUser short-circuits to `no_key` BEFORE any
// network call, so these tests are fully deterministic + network-free.
const env = {} as Env;

describe('notifyEvent', () => {
  it('rejects an invalid event shape without sending', async () => {
    const result = await notifyEvent(env, {
      subscriberId: 'user@acme.com',
      event: { event: 'domain.active', tenantId: 'o1' }, // missing hostname
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('invalid_event');
  });

  it('rejects an unknown event type without sending', async () => {
    const result = await notifyEvent(env, {
      subscriberId: 'user@acme.com',
      event: { event: 'made.up', tenantId: 'o1' },
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('invalid_event');
  });

  it('a valid event passes validation, then short-circuits on the missing key (no_key, not invalid_event)', async () => {
    const result = await notifyEvent(env, {
      subscriberId: 'user@acme.com',
      event: { event: 'domain.active', tenantId: 'o1', hostname: 'www.acme.com' },
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('no_key');
  });

  it('a valid event with an empty subscriber short-circuits on no_subscriber', async () => {
    const result = await notifyEvent({ NOVU_SECRET_KEY: 'k' } as unknown as Env, {
      subscriberId: '',
      event: { event: 'build.finished', tenantId: 'o1', previewUrl: 'https://x.projectsites.dev' },
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('no_subscriber');
  });
});

describe('notifyOwnerEvent', () => {
  it('rejects an invalid event before any D1 lookup', async () => {
    const db = { prepare: jest.fn() } as unknown as D1Database;
    const result = await notifyOwnerEvent(env, db, {
      orgId: 'o1',
      event: { event: 'payment.succeeded', tenantId: 'o1' }, // missing amountCents/currency
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('invalid_event');
    expect(db.prepare as jest.Mock).not.toHaveBeenCalled();
  });
});
