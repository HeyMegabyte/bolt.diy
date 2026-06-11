/**
 * Unit coverage for `SnapshotQualityWorkflow.run` (workflows/snapshot-quality.ts)
 * final-status derivation. The capture/score helpers are file-internal, so this
 * uses the REPLAY-MOCK pattern: `step.do` returns a canned value per step name
 * WITHOUT invoking the closure (no screenshot/fetch/score deps run). What's
 * under test is the orchestration outcome:
 *   - any step resolves → not catastrophic → ok:true
 *   - every step null → catastrophicError 'all capture steps failed' → ok:false
 *   - write-metrics step throws → caught → ok:false with the error surfaced
 *
 * `cloudflare:workers` is virtual-mocked.
 */
jest.mock('cloudflare:workers', () => ({
  __esModule: true,
  WorkflowEntrypoint: class<E, P> {
    env: E;
    constructor(_ctx: unknown, env: E) {
      this.env = env;
    }
  },
}), { virtual: true });

import { SnapshotQualityWorkflow } from '../workflows/snapshot-quality.js';
import type { Env } from '../types/env.js';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

function makeStep(canned: Record<string, unknown>, throwOn?: string) {
  const names: string[] = [];
  const step = {
    do: jest.fn(async (name: string, _opts: unknown, _fn?: unknown) => {
      names.push(name);
      if (name === throwOn) throw new Error('d1 write failed');
      return canned[name]; // undefined when unset → replay-cache miss simulated as null-ish
    }),
  } as unknown as WorkflowStep;
  return { step, names };
}

const params = {
  snapshotId: 'snap1', siteId: 's1', slug: 'mysite', snapshotName: 'v1',
  buildVersion: 'b1', capturedVia: 'cron' as const,
};
const run = (step: WorkflowStep) => {
  const wf = new SnapshotQualityWorkflow({} as never, { DB: {}, SITES_BUCKET: {} } as unknown as Env);
  return wf.run({ payload: params } as unknown as WorkflowEvent<typeof params>, step);
};

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('SnapshotQualityWorkflow.run', () => {
  it('returns ok:true when at least one capture step resolves (screenshot)', async () => {
    const { step, names } = makeStep({ screenshot: 'snapshots/snap1/shot.png' });
    const out = (await run(step)) as { ok: boolean; metricsId: string; error?: string };
    expect(out.ok).toBe(true);
    expect(out.error).toBeUndefined();
    expect(out.metricsId).toBeTruthy();
    expect(names).toContain('write-metrics');
  });

  it('flags catastrophic + returns ok:false when every capture step is null', async () => {
    const { step } = makeStep({}); // all steps → undefined
    const out = (await run(step)) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBe('all capture steps failed');
  });

  it('returns ok:false with the error when the write-metrics step throws', async () => {
    const { step } = makeStep({ screenshot: 'snapshots/snap1/shot.png' }, 'write-metrics');
    const out = (await run(step)) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBe('d1 write failed');
  });
});
