/**
 * Unit tests for {@link EventDispatcher} — the per-site Unified Analytics
 * dispatcher DO (Plane H). Constructs the DO with a MOCKED `DurableObjectState`
 * (in-memory storage + alarm) and a no-credentials env, mirroring the
 * `cloudflare:workers` virtual mock used across the worker DO suites. The hard
 * fan-out/dedup/breaker logic is proven in the primitive suites; these specs
 * lock the DO's glue: enqueue → dedup → queue/persist → batch-flush → debug.
 */

jest.mock(
  'cloudflare:workers',
  () => ({
    __esModule: true,
    DurableObject: class<E> {
      ctx: unknown;
      env: E;
      constructor(ctx: unknown, env: E) {
        this.ctx = ctx;
        this.env = env;
      }
    },
  }),
  { virtual: true },
);

import { EventDispatcher } from '../durable_objects/event_dispatcher.js';
import type { Env } from '../types/env.js';

interface MockState {
  state: DurableObjectState;
  hydration: Promise<unknown> | undefined;
}

function makeState(): MockState {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  const holder: MockState = {
    state: undefined as unknown as DurableObjectState,
    hydration: undefined,
  };
  const storage = {
    get: async (k: string) => store.get(k),
    put: async (k: string, v: unknown) => void store.set(k, v),
    getAlarm: async () => alarm,
    setAlarm: async (t: number) => void (alarm = t),
    delete: async (k: string) => store.delete(k),
  };
  holder.state = {
    storage,
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => {
      holder.hydration = fn();
      return holder.hydration;
    },
  } as unknown as DurableObjectState;
  return holder;
}

const noDbEnv = { DB: undefined } as unknown as Env;

const validEvent = (over: Record<string, unknown> = {}) => ({
  eventId: '123e4567-e89b-42d3-a456-426614174000',
  siteId: 's1',
  eventType: 'pageview',
  timestamp: 1_700_000_000_000,
  ...over,
});

async function build() {
  const m = makeState();
  const dispatcher = new EventDispatcher(m.state, noDbEnv);
  await m.hydration; // wait out the constructor's blockConcurrencyWhile
  return dispatcher;
}

function post(path: string, body: unknown): Request {
  return new Request(`https://do${path}`, { method: 'POST', body: JSON.stringify(body) });
}

describe('EventDispatcher', () => {
  it('enqueues a valid event → 202 queued, reflected in /debug', async () => {
    const d = await build();
    const res = await d.fetch(post('/enqueue', validEvent()));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'queued' });

    const dbg = await (await d.fetch(new Request('https://do/debug'))).json();
    expect(dbg).toMatchObject({ siteId: 's1', queueDepth: 1 });
    expect(dbg.circuits).toMatchObject({
      sentry: 'closed',
      posthog: 'closed',
      ga4: 'closed',
      gtm: 'closed',
    });
  });

  it('dedups a repeated eventId within the window → 202 duplicate, queue unchanged', async () => {
    const d = await build();
    await d.fetch(post('/enqueue', validEvent()));
    const dup = await d.fetch(post('/enqueue', validEvent()));
    expect(await dup.json()).toEqual({ status: 'duplicate' });
    const dbg = await (await d.fetch(new Request('https://do/debug'))).json();
    expect(dbg.queueDepth).toBe(1); // still just the first
  });

  it('rejects an invalid event → 400', async () => {
    const d = await build();
    const res = await d.fetch(post('/enqueue', validEvent({ eventId: 'nope' })));
    expect(res.status).toBe(400);
  });

  it('flushes when the batch threshold (10) is reached, draining the queue', async () => {
    const d = await build();
    for (let i = 0; i < 10; i++) {
      // Distinct, valid 40-char (SHA-1-length) eventIds.
      await d.fetch(post('/enqueue', validEvent({ eventId: `e${i}`.padEnd(40, '0') })));
    }
    const dbg = await (await d.fetch(new Request('https://do/debug'))).json();
    expect(dbg.queueDepth).toBe(0); // 10 enqueued → auto-flush drained
    // No creds configured → every provider outcome is not_configured (no DLQ).
    expect(Array.isArray(dbg.lastOutcomes)).toBe(true);
    expect(dbg.lastOutcomes.every((o: { status: string }) => o.status === 'not_configured')).toBe(
      true,
    );
    expect(dbg.lastFlushAt).toBeGreaterThan(0);
  });

  it('drops a sampled-out event (sampleRate 0) → 202 sampled_out, nothing queued', async () => {
    const d = await build();
    const res = await d.fetch(post('/enqueue', validEvent({ sampleRate: 0 })));
    expect(await res.json()).toEqual({ status: 'sampled_out' });
    const dbg = await (await d.fetch(new Request('https://do/debug'))).json();
    expect(dbg.queueDepth).toBe(0);
  });

  it('returns 404 for an unknown path', async () => {
    const d = await build();
    const res = await d.fetch(new Request('https://do/nope'));
    expect(res.status).toBe(404);
  });
});
