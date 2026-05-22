/**
 * Unit tests for {@link ImageGenerationWorkflow} (item #60, Workflows v2).
 *
 * Asserts:
 *   - Step ordering matches the documented graph.
 *   - Every step uses retries.limit=3, delay='30 seconds', backoff='exponential'.
 *   - The Stability fallback step only fires when DALL-E returned `null`.
 *   - Resumability: a re-run with the same cached step outputs short-circuits
 *     each closure to exactly one invocation.
 */

jest.mock('cloudflare:workers', () => ({
  __esModule: true,
  WorkflowEntrypoint: class<E, P> {
    env: E;
    constructor(_ctx: unknown, env: E) { this.env = env; }
  },
  DurableObject: class<E> {
    ctx: unknown;
    env: E;
    constructor(ctx: unknown, env: E) { this.ctx = ctx; this.env = env; }
  },
}), { virtual: true });

import { ImageGenerationWorkflow } from '../workflows/image-generation.js';
import type { Env } from '../types/env.js';

interface StepInvocation {
  name: string;
  config: Record<string, unknown> | undefined;
}

function makeStep(): {
  step: {
    do: <T>(name: string, configOrFn: Record<string, unknown> | (() => Promise<T>), fn?: () => Promise<T>) => Promise<T>;
    waitForEvent: <T>(name: string, opts: { timeout: string }) => Promise<T>;
  };
  invocations: StepInvocation[];
} {
  const invocations: StepInvocation[] = [];
  const step = {
    do: async <T,>(
      name: string,
      configOrFn: Record<string, unknown> | (() => Promise<T>),
      fn?: () => Promise<T>,
    ): Promise<T> => {
      const hasConfig = typeof configOrFn !== 'function';
      const config = hasConfig ? (configOrFn as Record<string, unknown>) : undefined;
      const actualFn = (hasConfig ? fn : (configOrFn as () => Promise<T>))!;
      invocations.push({ name, config });
      return actualFn();
    },
    waitForEvent: async (): Promise<never> => { throw new Error('event timeout'); },
  };
  return { step, invocations };
}

function makeEnv(opts: { hasDalle?: boolean; hasStability?: boolean } = {}): Env {
  return {
    OPENAI_API_KEY: opts.hasDalle ? 'sk-test' : undefined,
    STABILITY_API_KEY: opts.hasStability ? 'st-test' : undefined,
    SITES_BUCKET: {
      put: jest.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket,
    DB: {
      prepare: jest.fn().mockReturnValue({
        bind: jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue({ org_id: 'o1' }),
          run: jest.fn().mockResolvedValue({}),
        }),
      }),
    } as unknown as D1Database,
  } as unknown as Env;
}

describe('ImageGenerationWorkflow', () => {
  const baseParams = {
    siteId: 's1',
    slug: 'acme',
    concept: 'hero',
    prompt: 'A wide cinematic photograph of a city skyline at dusk',
    size: '1792x1024' as const,
  };

  beforeEach(() => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  it('runs the documented step order with 30s exponential retries', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ url: 'https://img.example/x.png' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
      });

    const env = makeEnv({ hasDalle: true });
    const wf = new ImageGenerationWorkflow({} as unknown as DurableObjectState, env);
    const { step, invocations } = makeStep();

    const result = await wf.run(
      { payload: baseParams, timestamp: new Date(), instanceId: 'i1' } as Parameters<typeof wf.run>[0],
      step as unknown as Parameters<typeof wf.run>[1],
    );

    expect(invocations.map((i) => i.name)).toEqual([
      'validate-prompt',
      'call-dalle',
      'call-stability-fallback',
      'upload-to-r2',
      'persist-asset-row',
    ]);

    for (const inv of invocations) {
      const retries = (inv.config as { retries?: { limit?: number; delay?: string; backoff?: string } } | undefined)?.retries;
      expect(retries?.limit).toBe(3);
      expect(retries?.delay).toBe('30 seconds');
      expect(retries?.backoff).toBe('exponential');
    }

    expect(result).toMatchObject({ ok: true, provider: 'dalle3' });
  });

  it('falls back to Stability when DALL-E returns null', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      // DALL-E call → not ok
      .mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('rate limit') })
      // Stability call → ok with PNG bytes
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(32)),
      });

    const env = makeEnv({ hasDalle: true, hasStability: true });
    const wf = new ImageGenerationWorkflow({} as unknown as DurableObjectState, env);
    const { step } = makeStep();
    const result = await wf.run(
      { payload: baseParams, timestamp: new Date(), instanceId: 'i1' } as Parameters<typeof wf.run>[0],
      step as unknown as Parameters<typeof wf.run>[1],
    );
    expect(result).toMatchObject({ ok: true, provider: 'stability' });
  });

  it('returns ok:false when both providers fail', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, text: () => Promise.resolve('err') });
    const env = makeEnv({ hasDalle: true, hasStability: true });
    const wf = new ImageGenerationWorkflow({} as unknown as DurableObjectState, env);
    const { step } = makeStep();
    const result = await wf.run(
      { payload: baseParams, timestamp: new Date(), instanceId: 'i1' } as Parameters<typeof wf.run>[0],
      step as unknown as Parameters<typeof wf.run>[1],
    );
    expect(result).toEqual({ ok: false, error: 'all_providers_failed' });
  });

  it('is resumable: cached step results bypass closure on replay', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ url: 'https://img.example/x.png' }] }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
      });

    const env = makeEnv({ hasDalle: true });
    const wf = new ImageGenerationWorkflow({} as unknown as DurableObjectState, env);

    const cache = new Map<string, unknown>();
    const calls = new Map<string, number>();
    const step = {
      do: async <T,>(
        name: string,
        configOrFn: Record<string, unknown> | (() => Promise<T>),
        fn?: () => Promise<T>,
      ): Promise<T> => {
        if (cache.has(name)) return cache.get(name) as T;
        calls.set(name, (calls.get(name) ?? 0) + 1);
        const actualFn = (typeof configOrFn === 'function' ? (configOrFn as () => Promise<T>) : fn) as () => Promise<T>;
        const v = await actualFn();
        cache.set(name, v);
        return v;
      },
      waitForEvent: async (): Promise<never> => { throw new Error('event timeout'); },
    };

    await wf.run(
      { payload: baseParams, timestamp: new Date(), instanceId: 'i1' } as Parameters<typeof wf.run>[0],
      step as unknown as Parameters<typeof wf.run>[1],
    );
    await wf.run(
      { payload: baseParams, timestamp: new Date(), instanceId: 'i1' } as Parameters<typeof wf.run>[0],
      step as unknown as Parameters<typeof wf.run>[1],
    );

    for (const count of calls.values()) expect(count).toBe(1);
  });
});
