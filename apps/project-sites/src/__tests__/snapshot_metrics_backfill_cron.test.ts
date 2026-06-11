/**
 * Unit coverage for `runSnapshotMetricsBackfillCron` (workflows/snapshot-quality.ts)
 * — the cron that finds recent snapshots lacking quality metrics and enqueues a
 * SnapshotQualityWorkflow for each. Previously untested. Branches: no binding →
 * {0,0}; no rows → {0,0}; all enqueue → counts; per-row enqueue failure is
 * swallowed (attempted counts it, enqueued does not).
 *
 * `cloudflare:workers` is virtual-mocked (the file imports WorkflowEntrypoint).
 */
jest.mock('cloudflare:workers', () => ({
  __esModule: true,
  WorkflowEntrypoint: class<E, P> {
    env: E;
    constructor(_ctx: unknown, env: E) {
      this.env = env;
    }
  },
  DurableObject: class<E> {
    env: E;
    constructor(_ctx: unknown, env: E) {
      this.env = env;
    }
  },
}), { virtual: true });

import { runSnapshotMetricsBackfillCron } from '../workflows/snapshot-quality.js';
import type { Env } from '../types/env.js';

type Row = { snapshot_id: string; site_id: string; snapshot_name: string; build_version: string; slug: string };
const row = (id: string): Row => ({ snapshot_id: id, site_id: 's1', snapshot_name: 'n', build_version: 'v1', slug: 'slug' });

function makeEnv(rows: Row[], create: jest.Mock | null): Env {
  return {
    DB: { prepare: jest.fn(() => ({ all: jest.fn().mockResolvedValue({ results: rows }) })) },
    ...(create ? { SNAPSHOT_QUALITY_WORKFLOW: { create } } : {}),
  } as unknown as Env;
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('runSnapshotMetricsBackfillCron', () => {
  it('returns {0,0} when the workflow binding is absent', async () => {
    const out = await runSnapshotMetricsBackfillCron(makeEnv([row('a')], null));
    expect(out).toEqual({ attempted: 0, enqueued: 0 });
  });

  it('returns {0,0} when there are no un-metered snapshots', async () => {
    const create = jest.fn().mockResolvedValue({});
    const out = await runSnapshotMetricsBackfillCron(makeEnv([], create));
    expect(out).toEqual({ attempted: 0, enqueued: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('enqueues one workflow per snapshot and counts them', async () => {
    const create = jest.fn().mockResolvedValue({});
    const out = await runSnapshotMetricsBackfillCron(makeEnv([row('a'), row('b'), row('c')], create));
    expect(out).toEqual({ attempted: 3, enqueued: 3 });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('swallows a per-row enqueue failure (attempted counts it, enqueued does not)', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('queue full'))
      .mockResolvedValueOnce({});
    const out = await runSnapshotMetricsBackfillCron(makeEnv([row('a'), row('b'), row('c')], create));
    expect(out).toEqual({ attempted: 3, enqueued: 2 });
  });
});
