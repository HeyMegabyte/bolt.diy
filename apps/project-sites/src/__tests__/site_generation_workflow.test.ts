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

import { SiteGenerationWorkflow, buildPrompt } from '../workflows/site-generation.js';
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

// The build must fit under the Cloudflare Container ~15-min wall-clock — the
// orchestrator prompt is TEMPLATE-FIRST minor-edits, NOT a from-scratch rebuild
// or a multi-subagent audit swarm (which took ~40 min). (Brian directive 2026-08-15.)
describe('buildPrompt — template-first, ≤14-min', () => {
  const p = {
    slug: 'vitos',
    businessName: "Vito's Salon",
    businessCategory: 'salon',
    businessAddress: '74 N Beverwyck Rd',
    additionalContext: 'warm premium feel',
  } as unknown as Parameters<typeof buildPrompt>[0];

  it('is template-first — customize the pre-built template, do not regenerate', () => {
    const out = buildPrompt(p);
    expect(out).toMatch(/TEMPLATE-FIRST/i);
    expect(out).toContain('~/template/');
    expect(out).toMatch(/customize/i);
    expect(out).toMatch(/do NOT (regenerate|run the)/i);
  });

  it('enforces the under-14-minute container budget', () => {
    expect(buildPrompt(p)).toMatch(/under 14 minutes/i);
  });

  it('drops the slow audit swarm + loop-until-perfect (single validator pass is the gate)', () => {
    const out = buildPrompt(p);
    // The old flow spawned a 5-7 agent PARALLEL FAN-OUT and looped until perfect.
    expect(out).not.toMatch(/PARALLEL FAN-OUT/i);
    expect(out).not.toMatch(/loop back to step/i);
    expect(out).toMatch(/ONE validation pass/i);
    expect(out).toMatch(/blockers === 0/);
  });

  it('still carries the business data + user context', () => {
    const out = buildPrompt(p);
    expect(out).toContain("Vito's Salon");
    expect(out).toContain('warm premium feel');
  });

  it('locks the business name VERBATIM (the Hearth & Crumb defect — a build shipped the wrong brand)', () => {
    const out = buildPrompt(p);
    expect(out).toContain('THE BUSINESS NAME IS EXACTLY "Vito\'s Salon"');
    expect(out).toMatch(/NEVER invent a different name/i);
    expect(out).toMatch(/grep for leftover names/i);
  });
});
