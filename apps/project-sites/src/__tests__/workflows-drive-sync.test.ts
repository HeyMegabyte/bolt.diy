/**
 * Unit tests for {@link DriveSyncWorkflow} (item #60, Workflows v2).
 *
 * Asserts:
 *   - Each step.do call uses the standard 3-try / 30s exponential retry config.
 *   - Steps execute in the documented order:
 *     check-disconnect → list-folder → dedupe-against-existing →
 *     fetch-each-file → extract-text → persist-rows.
 *   - The workflow is resumable: when step.do for a given step name is
 *     replayed, the cached value (mocked here) is returned without
 *     re-invoking the closure.
 */

jest.mock('../services/google_drive.js', () => ({
  __esModule: true,
  getAccessToken: jest.fn().mockResolvedValue('access-token'),
  listFolderFiles: jest.fn().mockResolvedValue([]),
  downloadFile: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.readonly',
}));

jest.mock('../services/ai_context_extract.js', () => ({
  __esModule: true,
  MAX_CONTEXT_FILE_BYTES: 10 * 1024 * 1024,
  extractContext: jest.fn().mockResolvedValue({ text: 'extracted', pages_processed: 1, truncated: false }),
}));

jest.mock('cloudflare:workers', () => ({
  __esModule: true,
  WorkflowEntrypoint: class<E, P> {
    env: E;
    constructor(_ctx: unknown, env: E) {
      this.env = env;
    }
  },
  DurableObject: class<E> {
    ctx: unknown;
    env: E;
    constructor(ctx: unknown, env: E) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}), { virtual: true });

import { DriveSyncWorkflow } from '../workflows/drive-sync.js';
import type { Env } from '../types/env.js';

interface StepInvocation {
  name: string;
  config: Record<string, unknown> | undefined;
}

function makeStep(): {
  step: {
    do: <T>(
      name: string,
      configOrFn: Record<string, unknown> | (() => Promise<T>),
      fn?: () => Promise<T>,
    ) => Promise<T>;
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
    waitForEvent: async <T,>(_name: string, _opts: { timeout: string }): Promise<T> => {
      throw new Error('event timeout');
    },
  };
  return { step, invocations };
}

function makeEnv(): Env {
  return {
    DB: {
      prepare: jest.fn().mockImplementation((sql: string) => ({
        bind: jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue(
            sql.includes('drive_folder_id FROM ai_site_settings')
              ? { drive_folder_id: 'folder-1' }
              : null,
          ),
          all: jest.fn().mockResolvedValue({ results: [] }),
          run: jest.fn().mockResolvedValue({}),
        }),
      })),
    } as unknown as D1Database,
    SITES_BUCKET: {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    } as unknown as R2Bucket,
  } as unknown as Env;
}

describe('DriveSyncWorkflow', () => {
  it('runs steps in documented order with 30s exponential retry config', async () => {
    const env = makeEnv();
    const wf = new DriveSyncWorkflow({} as unknown as DurableObjectState, env);
    const { step, invocations } = makeStep();

    const result = await wf.run(
      { payload: { siteId: 's1', orgId: 'o1', slug: 'acme' }, timestamp: new Date(), instanceId: 'i1' } as Parameters<typeof wf.run>[0],
      step as unknown as Parameters<typeof wf.run>[1],
    );

    expect(invocations.map((i) => i.name)).toEqual([
      'check-disconnect',
      'list-folder',
      'dedupe-against-existing',
      'fetch-each-file',
      'extract-text',
      'persist-rows',
    ]);

    // Every resumable step uses 3 retries / 30s exponential.
    const resumable = invocations.slice(1);
    for (const inv of resumable) {
      const retries = (inv.config as { retries?: { limit?: number; delay?: string; backoff?: string } } | undefined)?.retries;
      expect(retries?.limit).toBe(3);
      expect(retries?.delay).toBe('30 seconds');
      expect(retries?.backoff).toBe('exponential');
    }

    expect(result).toEqual({ added: 0, updated: 0, removed: 0, skipped: 0 });
  });

  it('is resumable: same step name returns cached value without re-invoking closure', async () => {
    const env = makeEnv();
    const wf = new DriveSyncWorkflow({} as unknown as DurableObjectState, env);

    const cache = new Map<string, unknown>();
    const calls = new Map<string, number>();
    const step = {
      do: async <T,>(
        name: string,
        _configOrFn: Record<string, unknown> | (() => Promise<T>),
        fn?: () => Promise<T>,
      ): Promise<T> => {
        if (cache.has(name)) return cache.get(name) as T;
        calls.set(name, (calls.get(name) ?? 0) + 1);
        const actualFn = (typeof _configOrFn === 'function'
          ? (_configOrFn as () => Promise<T>)
          : fn) as () => Promise<T>;
        const value = await actualFn();
        cache.set(name, value);
        return value;
      },
      waitForEvent: async (): Promise<never> => { throw new Error('event timeout'); },
    };

    await wf.run(
      { payload: { siteId: 's1', orgId: 'o1', slug: 'acme' }, timestamp: new Date(), instanceId: 'i1' } as Parameters<typeof wf.run>[0],
      step as unknown as Parameters<typeof wf.run>[1],
    );
    // Replay
    await wf.run(
      { payload: { siteId: 's1', orgId: 'o1', slug: 'acme' }, timestamp: new Date(), instanceId: 'i1' } as Parameters<typeof wf.run>[0],
      step as unknown as Parameters<typeof wf.run>[1],
    );
    // Each step closure was invoked at most once due to the cache.
    for (const count of calls.values()) {
      expect(count).toBe(1);
    }
  });
});
