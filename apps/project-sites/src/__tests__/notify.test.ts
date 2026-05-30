/**
 * @module __tests__/notify
 * Unit tests for the server-side Novu trigger ({@link notifyUser}). Mocks fetch;
 * never calls the real Novu API. Covers happy path, missing key, and error.
 */
import { notifyUser, notifySiteOwner } from '../services/notify.js';
import type { Env } from '../types/env.js';

/** Minimal D1 stub: prepare().bind().first() resolves to the given owner row. */
const makeDb = (email: string | null) =>
  ({
    prepare: () => ({ bind: () => ({ first: async () => (email ? { email } : null) }) }),
  }) as unknown as D1Database;

const throwingDb = () =>
  ({
    prepare: () => {
      throw new Error('d1 down');
    },
  }) as unknown as D1Database;

const baseEnv = { NOVU_SECRET_KEY: 'sk_test_abc' } as unknown as Env;
const input = { subscriberId: 'user@example.com', subject: 'Hi', body: 'Body' };

describe('notifyUser', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs to the Novu trigger endpoint with ApiKey auth + ps-notify default', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { transactionId: 'txn_1' } }), { status: 201 }),
      );

    const res = await notifyUser(baseEnv, input);

    expect(res).toEqual({ ok: true, detail: 'txn_1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.novu.co/v1/events/trigger');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('ApiKey sk_test_abc');
    const sent = JSON.parse(init?.body as string);
    expect(sent.name).toBe('ps-notify');
    expect(sent.to.subscriberId).toBe('user@example.com');
    expect(sent.payload).toEqual({ subject: 'Hi', body: 'Body' });
  });

  it('honors a custom workflowId', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    await notifyUser(baseEnv, { ...input, workflowId: 'site-published' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(sent.name).toBe('site-published');
  });

  it('returns ok:false without calling fetch when no key is configured', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const res = await notifyUser({} as Env, input);
    expect(res).toEqual({ ok: false, detail: 'no_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ok:false when subscriberId is empty', async () => {
    const res = await notifyUser(baseEnv, { ...input, subscriberId: '' });
    expect(res).toEqual({ ok: false, detail: 'no_subscriber' });
  });

  it('returns ok:false on a non-2xx Novu response (never throws)', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 400 }));
    const res = await notifyUser(baseEnv, input);
    expect(res).toEqual({ ok: false, detail: 'http_400' });
  });

  it('returns ok:false on a network exception (never throws)', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const res = await notifyUser(baseEnv, input);
    expect(res).toEqual({ ok: false, detail: 'exception' });
  });
});

describe('notifySiteOwner', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves the org owner email then triggers Novu for that subscriber', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: { transactionId: 'txn_owner' } }), { status: 201 }));
    const res = await notifySiteOwner(baseEnv, makeDb('owner@org.com'), {
      orgId: 'org_1',
      subject: 'Payment received',
      body: 'Active.',
    });
    expect(res).toEqual({ ok: true, detail: 'txn_owner' });
    const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(sent.to.subscriberId).toBe('owner@org.com');
  });

  it('returns ok:false (no fetch) when the org has no resolvable owner', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const res = await notifySiteOwner(baseEnv, makeDb(null), { orgId: 'org_1', subject: 's', body: 'b' });
    expect(res).toEqual({ ok: false, detail: 'no_owner' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ok:false when orgId is empty', async () => {
    const res = await notifySiteOwner(baseEnv, makeDb('x@y.com'), { orgId: '', subject: 's', body: 'b' });
    expect(res).toEqual({ ok: false, detail: 'no_org' });
  });

  it('returns ok:false on a D1 lookup failure (never throws)', async () => {
    const res = await notifySiteOwner(baseEnv, throwingDb(), { orgId: 'org_1', subject: 's', body: 'b' });
    expect(res).toEqual({ ok: false, detail: 'lookup_failed' });
  });
});
