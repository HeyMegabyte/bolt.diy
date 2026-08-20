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

/**
 * Builder whose per-name `get` returns distinct stub objects with `stop`
 * spies — so a test can assert WHICH container the workflow stopped (the
 * slot-leak class: the terminal stop() targeted the ORIGINAL name while the
 * restarted `-r1` held the pool slot for its full sleepAfter).
 */
function spyBuilder() {
  const stops: Record<string, ReturnType<typeof jest.fn>> = {};
  const stubOf = (name: string) => {
    stops[name] = jest.fn(async () => {});
    return {
      stop: stops[name],
      fetch: async () => new Response('{}', { status: 200 }),
    };
  };
  const instances: Record<string, ReturnType<typeof stubOf>> = {};
  const get = (id: unknown) => {
    const name = String(id);
    if (!instances[name]) instances[name] = stubOf(name);
    return instances[name];
  };
  const idFromName = (name: string) => name;
  return { get, idFromName, stops, instances };
}

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

// ─── Heartbeat-loop coverage (sequence-driven replay mock) ───────────────────
// The heartbeat loop is the REAL code under test here: step.do is replayed per
// name (the container-fetch callback is never invoked), so each heartbeat's
// wrap is canned by position — driving eviction → restart → boot-grace →
// terminal exactly like a live build. Everything post-loop (finalize/validate/
// notify) is canned, so the loop branches are the only real code exercised.
const runningWrap = () =>
  JSON.stringify({ _src: 'container', body: JSON.stringify({ status: 'running', step: 'build' }) });
const completeWrap = () =>
  JSON.stringify({
    _src: 'container',
    body: JSON.stringify({ status: 'complete', step: 'done', elapsed: 100, fileCount: 340 }),
  });
const unknownJobWrap = () =>
  JSON.stringify({ _src: 'container', body: JSON.stringify({ error: 'unknown job' }) });
const missingWrap = () => JSON.stringify({ _src: 'kv', _missing: true });

function makeBeatStep(canned: Record<string, unknown>, beats: string[]) {
  const doFn = jest.fn(async (name: string) => {
    if (name.startsWith('heartbeat-')) {
      const next = beats.shift();
      if (next === undefined) {
        throw new Error(`beat sequence exhausted at ${name} — the loop polled past the canned run`);
      }
      return next;
    }
    return canned[name];
  });
  return { do: doFn, beats };
}

function runBeats(beats: string[], cannedOver: Record<string, unknown> = {}) {
  const canned = {
    'mint-version': '2026-08-19T00-00-00-000Z',
    'budget-killswitch': '{}',
    'start-build': 'job-1',
    'restart-build-after-eviction': 'job-2',
    'restart-build-after-stale': 'job-3',
    'finalize-build': JSON.stringify({ fileCount: 340, version: 'v1' }),
    'validate-build': '{}',
    'visual-inspection': '{"skipped":true}',
    'benchmark-and-learn': '{"skipped":true}',
    notify: '{}',
    'notify-owner-published': 'sent',
    ...cannedOver,
  };
  const step = makeBeatStep(canned, beats);
  return run(
    {
      ...withBuilder(),
      CACHE_KV: { get: async () => null, put: async () => undefined },
    },
    step as unknown as WorkflowStep,
    params(),
  );
}

describe('SiteGenerationWorkflow — heartbeat loop (eviction + boot grace)', () => {
  it('happy path: running polls → terminal complete → published', async () => {
    const out = (await runBeats([runningWrap(), runningWrap(), runningWrap(), completeWrap()])) as {
      status: string;
    };
    expect(out.status).toBe('published');
  });

  it('an eviction at poll 118 still completes — the restart EXTENDS the poll budget', async () => {
    // 118 running + eviction + 30 post-restart running + complete = 150 polls.
    // The pre-fix loop caps at 120 → timeout at poll 120; the budget extension
    // (+60 on restart) carries the build to completion.
    const beats: string[] = [];
    for (let i = 0; i < 118; i++) beats.push(runningWrap());
    beats.push(unknownJobWrap());
    for (let i = 0; i < 30; i++) beats.push(runningWrap());
    beats.push(completeWrap());
    const out = (await runBeats(beats)) as { status: string };
    expect(out.status).toBe('published');
  });

  it('eviction sets the boot-grace window — missing status during fresh-DO boot keeps waiting', async () => {
    // Eviction at poll 2 → restart → 6 polls with no container/KV record (the
    // fresh DO is still booting) → then status resumes → complete. Pre-fix, the
    // i>=4 missing guard errored the build at poll 4 (grace was never SET on
    // the eviction path, and even where set it was never READ).
    const beats = [
      runningWrap(),
      runningWrap(),
      unknownJobWrap(),
      missingWrap(),
      missingWrap(),
      missingWrap(),
      missingWrap(),
      missingWrap(),
      missingWrap(),
      runningWrap(),
      runningWrap(),
      completeWrap(),
    ];
    const out = (await runBeats(beats)) as { status: string };
    expect(out.status).toBe('published');
  });
});

describe('SiteGenerationWorkflow — container slot-leak discipline', () => {
  it('stops the ACTIVE (restarted) container on terminal, not just the original', async () => {
    const builder = spyBuilder();
    const beats = [runningWrap(), unknownJobWrap(), runningWrap(), completeWrap()];
    const step = makeBeatStep(
      {
        'mint-version': 'v',
        'budget-killswitch': '{}',
        'start-build': 'job-1',
        'restart-build-after-eviction': 'job-2',
        'finalize-build': JSON.stringify({ fileCount: 340, version: 'v' }),
        'validate-build': '{}',
        'visual-inspection': '{"skipped":true}',
        'benchmark-and-learn': '{"skipped":true}',
        notify: '{}',
        'notify-owner-published': 'sent',
      },
      beats,
    );
    await run(
      {
        ...baseEnv({ SITE_BUILDER: builder as unknown as Env['SITE_BUILDER'] }),
        CACHE_KV: { get: async () => null, put: async () => undefined },
      },
      step as unknown as WorkflowStep,
      params(),
    );
    // The terminal stop() must release the RESTARTED container's slot — the
    // one actually holding the pool entry after the eviction.
    // eslint-disable-next-line no-console
    console.log('SLOTLEAK-NAMES', JSON.stringify(Object.keys(builder.stops)));
    const restartedName = Object.keys(builder.stops).find((n) => n.includes('-r1'));
    expect(restartedName).toBeDefined();
    expect(builder.stops[restartedName!]).toHaveBeenCalled();
  });
});
