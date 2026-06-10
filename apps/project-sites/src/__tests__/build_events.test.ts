/**
 * Unit coverage for `services/build_events.ts` — the event-sourced, replayable
 * AI-build-progress stream (per [[event-sourced-build-progress]]). Previously
 * untested. Covers the discriminated-union contract, the append (validate →
 * persist, swallow persistence failures, throw on invalid), the replay
 * (empty/corrupt/non-JSON/non-array/read-failure + ts ordering), and the
 * terminal-event predicate.
 */
import {
  appendBuildEvent,
  replayBuildEvents,
  isTerminalBuildEvent,
  BuildEventSchema,
  type BuildEvent,
} from '../services/build_events.js';
import type { Env } from '../types/env.js';

const TS = (s: string) => `2026-01-0${s}T00:00:00.000Z`;
const BID = 'b1';
const KEY = `build:${BID}:events`;

/** Minimal in-memory KV so append→replay round-trips. */
function makeKv(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(KEY, initial);
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    put: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  };
}
const envWith = (kv: unknown) => ({ CACHE_KV: kv }) as unknown as Env;

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('isTerminalBuildEvent', () => {
  it('publish.completed and build.failed are terminal', () => {
    expect(isTerminalBuildEvent('publish.completed')).toBe(true);
    expect(isTerminalBuildEvent('build.failed')).toBe(true);
  });
  it('mid-stream events are not terminal', () => {
    for (const t of ['build.started', 'agent.started', 'file.changed', 'tests.completed'] as const) {
      expect(isTerminalBuildEvent(t)).toBe(false);
    }
  });
});

describe('BuildEventSchema', () => {
  it('applies defaults (build.started.prompt defaults to "")', () => {
    const e = BuildEventSchema.parse({ type: 'build.started', buildId: BID, ts: TS('1') });
    expect(e.type === 'build.started' && e.prompt).toBe('');
  });
  it('rejects an unknown discriminator', () => {
    expect(() => BuildEventSchema.parse({ type: 'nope', buildId: BID, ts: TS('1') })).toThrow();
  });
  it('rejects a non-ISO ts', () => {
    expect(() =>
      BuildEventSchema.parse({ type: 'build.started', buildId: BID, ts: 'not-a-date' }),
    ).toThrow();
  });
  it('rejects build.failed without a reason', () => {
    expect(() =>
      BuildEventSchema.parse({ type: 'build.failed', buildId: BID, ts: TS('1') }),
    ).toThrow();
  });
});

describe('appendBuildEvent', () => {
  it('validates, persists, and returns the parsed event', async () => {
    const kv = makeKv();
    const out = await appendBuildEvent(envWith(kv), {
      type: 'build.started',
      buildId: BID,
      ts: TS('1'),
      prompt: 'Build a site',
    } as BuildEvent);
    expect(out.type).toBe('build.started');
    expect(kv.put).toHaveBeenCalledTimes(1);
    const replayed = await replayBuildEvents(envWith(kv), BID);
    expect(replayed).toHaveLength(1);
  });

  it('appends to the existing log (oldest → newest)', async () => {
    const kv = makeKv();
    const env = envWith(kv);
    await appendBuildEvent(env, { type: 'build.started', buildId: BID, ts: TS('1') } as BuildEvent);
    await appendBuildEvent(env, {
      type: 'publish.completed',
      buildId: BID,
      ts: TS('2'),
      fileCount: 3,
    } as BuildEvent);
    const events = await replayBuildEvents(env, BID);
    expect(events.map((e) => e.type)).toEqual(['build.started', 'publish.completed']);
  });

  it('throws a ZodError on an invalid event and does NOT persist', async () => {
    const kv = makeKv();
    await expect(
      appendBuildEvent(envWith(kv), { type: 'build.failed', buildId: BID, ts: TS('1') } as never),
    ).rejects.toThrow();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('swallows a persistence failure (returns parsed, never throws)', async () => {
    const kv = {
      get: jest.fn(async () => null),
      put: jest.fn(async () => {
        throw new Error('kv down');
      }),
    };
    const out = await appendBuildEvent(envWith(kv), {
      type: 'agent.started',
      buildId: BID,
      ts: TS('1'),
      agent: 'visual-qa',
    } as BuildEvent);
    expect(out.agent).toBe('visual-qa');
  });
});

describe('replayBuildEvents', () => {
  it('returns [] when no log exists', async () => {
    expect(await replayBuildEvents(envWith(makeKv()), BID)).toEqual([]);
  });

  it('drops corrupt entries but keeps valid ones', async () => {
    const good = { type: 'build.started', buildId: BID, ts: TS('1'), prompt: '' };
    const kv = makeKv(JSON.stringify([good, { type: 'garbage' }, { not: 'an event' }]));
    const events = await replayBuildEvents(envWith(kv), BID);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('build.started');
  });

  it('returns [] for non-JSON stored value', async () => {
    expect(await replayBuildEvents(envWith(makeKv('not-json{')), BID)).toEqual([]);
  });

  it('returns [] for a non-array stored value', async () => {
    expect(await replayBuildEvents(envWith(makeKv('{"a":1}')), BID)).toEqual([]);
  });

  it('returns [] (swallowed) when KV.get throws', async () => {
    const kv = { get: jest.fn(async () => { throw new Error('kv read fail'); }), put: jest.fn() };
    expect(await replayBuildEvents(envWith(kv), BID)).toEqual([]);
  });

  it('orders by ts oldest → newest regardless of stored order', async () => {
    const e2 = { type: 'publish.completed', buildId: BID, ts: TS('3'), fileCount: 1, version: '' };
    const e1 = { type: 'build.started', buildId: BID, ts: TS('1'), prompt: '' };
    const kv = makeKv(JSON.stringify([e2, e1])); // stored newest-first
    const events = await replayBuildEvents(envWith(kv), BID);
    expect(events.map((e) => e.ts)).toEqual([TS('1'), TS('3')]);
  });
});
