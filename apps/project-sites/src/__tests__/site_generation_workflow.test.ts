/**
 * Unit coverage for `SiteGenerationWorkflow.run` entry + minimal-mode
 * (workflows/site-generation.ts) — the last untested workflow run(). The full
 * AI-build pipeline is enormous; this covers the bounded, high-signal branches:
 *   - missing SITE_BUILDER binding → updateSiteStatus('error') + throws
 *   - minimalMode + container reports ok → status published + {ok:true,minimal}
 *   - minimalMode + container reports !ok → throws "minimal build failed: …"
 * Uses the replay-mock (step.do returns canned per name; the container fetch
 * closure is never invoked). The pre-guard log/status/event helpers are
 * best-effort (swallow), so a minimal DB+KV env suffices.
 */
jest.mock(
  'cloudflare:workers',
  () => ({
    __esModule: true,
    WorkflowEntrypoint: class<E, P> {
      env: E;
      constructor(_ctx: unknown, env: E) {
        this.env = env;
      }
    },
  }),
  { virtual: true },
);

import { SiteGenerationWorkflow } from '../workflows/site-generation.js';
import type { Env } from '../types/env.js';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

function baseEnv(extra: Record<string, unknown> = {}): Env {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          run: async () => ({}),
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
      }),
    },
    CACHE_KV: { get: async () => null, put: async () => undefined },
    ...extra,
  } as unknown as Env;
}
const withBuilder = () => baseEnv({ SITE_BUILDER: { idFromName: () => 'cid', get: () => ({}) } });

function makeStep(canned: Record<string, unknown>) {
  const step = {
    do: jest.fn(async (name: string, _opts: unknown, _fn?: unknown) => canned[name]),
  } as unknown as WorkflowStep;
  return step;
}

const params = (over: Record<string, unknown> = {}) => ({
  siteId: 's1',
  slug: 'mysite',
  businessName: 'Acme',
  orgId: 'o1',
  ...over,
});
const run = (env: Env, step: WorkflowStep, p: Record<string, unknown>) => {
  const wf = new SiteGenerationWorkflow({} as never, env);
  return wf.run({ payload: p } as unknown as WorkflowEvent<never>, step);
};

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('SiteGenerationWorkflow.run — entry guard + minimal mode', () => {
  it('throws when the SITE_BUILDER container binding is missing', async () => {
    await expect(run(baseEnv(), makeStep({}), params())).rejects.toThrow(
      /SITE_BUILDER container not configured/,
    );
  });

  it('publishes and returns {ok,minimal} when minimal build reports ok', async () => {
    const step = makeStep({
      'minimal-build': JSON.stringify({ ok: true, uploadResult: { uploaded: 5 } }),
    });
    const out = (await run(withBuilder(), step, params({ minimalMode: true }))) as {
      ok: boolean;
      mode: string;
      uploaded: number;
    };
    expect(out).toEqual({ ok: true, mode: 'minimal', uploaded: 5 });
  });

  it('throws "minimal build failed" when the container reports !ok', async () => {
    const step = makeStep({ 'minimal-build': JSON.stringify({ ok: false, stdoutTail: 'boom' }) });
    await expect(run(withBuilder(), step, params({ minimalMode: true }))).rejects.toThrow(
      /minimal build failed: boom/,
    );
  });
});
