/**
 * Unit tests for the event-sourced build-progress store (idea #10).
 *
 * Covers: valid-event append + persist, invalid-event rejection, and replay
 * ordering by timestamp. KV is mocked in-memory; D1 is unused by this service.
 */

import {
  appendBuildEvent,
  replayBuildEvents,
  isTerminalBuildEvent,
  BuildEventSchema,
} from '../../../../src/services/build_events.js';

/** Minimal in-memory KV double matching the get/put surface we use. */
function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    put: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

/** Build an env stub exposing only CACHE_KV. */
function makeEnv() {
  const kv = makeKv();
  return { env: { CACHE_KV: kv } as never, kv };
}

const BUILD_ID = 'site-abc-123';

describe('build_events/appendBuildEvent', () => {
  test('validates and persists a valid event', async () => {
    const { env, kv } = makeEnv();
    const parsed = await appendBuildEvent(env, {
      type: 'build.started',
      buildId: BUILD_ID,
      ts: '2026-05-29T10:00:00.000Z',
      prompt: 'Acme Co (acme)',
    });

    expect(parsed.type).toBe('build.started');
    expect(kv.put).toHaveBeenCalledTimes(1);
    const events = await replayBuildEvents(env, BUILD_ID);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('build.started');
  });

  test('rejects an invalid event (bad discriminator) and never persists', async () => {
    const { env, kv } = makeEnv();
    await expect(
      // @ts-expect-error — intentionally invalid `type` for the runtime guard.
      appendBuildEvent(env, { type: 'not.a.real.event', buildId: BUILD_ID, ts: '2026-05-29T10:00:00.000Z' }),
    ).rejects.toThrow();
    expect(kv.put).not.toHaveBeenCalled();
  });

  test('rejects an event with a non-ISO timestamp', async () => {
    const { env } = makeEnv();
    await expect(
      appendBuildEvent(env, {
        type: 'tests.completed',
        buildId: BUILD_ID,
        ts: 'yesterday',
        passed: 1,
        failed: 0,
      }),
    ).rejects.toThrow();
  });

  test('rejects an event missing buildId', async () => {
    const { env } = makeEnv();
    await expect(
      // @ts-expect-error — missing required buildId.
      appendBuildEvent(env, { type: 'tests.started', ts: '2026-05-29T10:00:00.000Z', runner: 'vitest' }),
    ).rejects.toThrow();
  });
});

describe('build_events/replayBuildEvents', () => {
  test('returns events in timestamp order regardless of append order', async () => {
    const { env } = makeEnv();
    // Append out of chronological order.
    await appendBuildEvent(env, {
      type: 'publish.completed',
      buildId: BUILD_ID,
      ts: '2026-05-29T10:05:00.000Z',
      fileCount: 42,
      version: 'v-1',
    });
    await appendBuildEvent(env, {
      type: 'build.started',
      buildId: BUILD_ID,
      ts: '2026-05-29T10:00:00.000Z',
      prompt: 'Acme',
    });
    await appendBuildEvent(env, {
      type: 'agent.started',
      buildId: BUILD_ID,
      ts: '2026-05-29T10:02:00.000Z',
      agent: 'container',
      step: 'building',
    });

    const events = await replayBuildEvents(env, BUILD_ID);
    expect(events.map((e) => e.type)).toEqual([
      'build.started',
      'agent.started',
      'publish.completed',
    ]);
  });

  test('returns empty array when no events exist', async () => {
    const { env } = makeEnv();
    expect(await replayBuildEvents(env, 'missing-build')).toEqual([]);
  });

  test('drops corrupt entries defensively instead of throwing', async () => {
    const { env, kv } = makeEnv();
    kv.store.set(`build:${BUILD_ID}:events`, JSON.stringify([{ junk: true }, {
      type: 'build.started',
      buildId: BUILD_ID,
      ts: '2026-05-29T10:00:00.000Z',
      prompt: '',
    }]));
    const events = await replayBuildEvents(env, BUILD_ID);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('build.started');
  });
});

describe('build_events/isTerminalBuildEvent', () => {
  test('publish.completed and build.failed are terminal', () => {
    expect(isTerminalBuildEvent('publish.completed')).toBe(true);
    expect(isTerminalBuildEvent('build.failed')).toBe(true);
  });

  test('intermediate events are not terminal', () => {
    expect(isTerminalBuildEvent('build.started')).toBe(false);
    expect(isTerminalBuildEvent('agent.started')).toBe(false);
    expect(isTerminalBuildEvent('tests.completed')).toBe(false);
  });
});

describe('build_events/BuildEventSchema', () => {
  test('applies defaults for optional fields', () => {
    const parsed = BuildEventSchema.parse({
      type: 'file.changed',
      buildId: BUILD_ID,
      ts: '2026-05-29T10:00:00.000Z',
      path: 'src/App.tsx',
    });
    expect(parsed.type === 'file.changed' && parsed.action).toBe('update');
  });
});
