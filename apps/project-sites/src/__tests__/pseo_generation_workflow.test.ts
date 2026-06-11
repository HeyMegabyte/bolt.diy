/**
 * Unit coverage for `PseoGenerationWorkflow.run` (workflows/pseo-generation-workflow.ts)
 * — the pSEO matrix-build → content-generate orchestration. Previously untested.
 * Asserts: flag-off short-circuits (only check-flag runs); flag-on runs
 * build-matrix → log-stats; draft rows batch into generate-content-{N} steps of
 * 5; a per-row content failure is swallowed (the workflow never throws).
 *
 * `cloudflare:workers` is virtual-mocked; the service deps + step runner are mocked.
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

jest.mock('../services/pseo_matrix.js', () => ({
  __esModule: true,
  buildPseoMatrix: jest.fn().mockResolvedValue({ queued: 0, skipped: 0 }),
  generatePseoPageContent: jest.fn().mockResolvedValue(undefined),
  getPseoMatrixStats: jest.fn().mockResolvedValue({ total: 0 }),
}));
jest.mock('../services/db.js', () => ({ __esModule: true, dbQuery: jest.fn().mockResolvedValue({ data: [] }) }));
jest.mock('../modules/feature_flags/services.js', () => ({ __esModule: true, isFlagOn: jest.fn() }));

import { PseoGenerationWorkflow } from '../workflows/pseo-generation-workflow.js';
import { buildPseoMatrix, generatePseoPageContent, getPseoMatrixStats } from '../services/pseo_matrix.js';
import { dbQuery } from '../services/db.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import type { Env } from '../types/env.js';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

const flagOn = isFlagOn as jest.Mock;
const buildMatrix = buildPseoMatrix as jest.Mock;
const genContent = generatePseoPageContent as jest.Mock;
const dbq = dbQuery as jest.Mock;

function makeStep() {
  const names: string[] = [];
  const step = {
    do: jest.fn(async (name: string, fn: () => Promise<unknown>) => {
      names.push(name);
      return await fn();
    }),
  } as unknown as WorkflowStep;
  return { step, names };
}

const run = (step: WorkflowStep) => {
  const wf = new PseoGenerationWorkflow({} as never, { DB: {} } as unknown as Env);
  const event = { payload: { siteId: 's1', orgId: 'o1' } } as WorkflowEvent<{ siteId: string; orgId: string }>;
  return wf.run(event, step);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  buildMatrix.mockResolvedValue({ queued: 0, skipped: 0 });
  (getPseoMatrixStats as jest.Mock).mockResolvedValue({ total: 0 });
  genContent.mockResolvedValue(undefined);
  dbq.mockResolvedValue({ data: [] });
});

describe('PseoGenerationWorkflow.run', () => {
  it('aborts after the flag check when the feature flag is off', async () => {
    flagOn.mockResolvedValue(false);
    const { step, names } = makeStep();
    await run(step);
    expect(names).toEqual(['check-flag']);
    expect(buildMatrix).not.toHaveBeenCalled();
    expect(genContent).not.toHaveBeenCalled();
  });

  it('runs build-matrix → log-stats (no generate steps) when there are no draft rows', async () => {
    flagOn.mockResolvedValue(true);
    dbq.mockResolvedValue({ data: [] });
    const { step, names } = makeStep();
    await run(step);
    expect(names).toEqual(['check-flag', 'build-matrix', 'log-stats']);
    expect(buildMatrix).toHaveBeenCalledTimes(1);
    expect(genContent).not.toHaveBeenCalled();
  });

  it('batches draft rows into generate-content-{N} steps of 5', async () => {
    flagOn.mockResolvedValue(true);
    dbq.mockResolvedValue({ data: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}` })) });
    const { step, names } = makeStep();
    await run(step);
    expect(names).toContain('generate-content-0');
    expect(names).toContain('generate-content-1'); // 7 rows → 2 batches
    expect(names).not.toContain('generate-content-2');
    expect(genContent).toHaveBeenCalledTimes(7);
    expect(names[names.length - 1]).toBe('log-stats');
  });

  it('swallows a per-row content-generation failure (never throws)', async () => {
    flagOn.mockResolvedValue(true);
    dbq.mockResolvedValue({ data: [{ id: 'p0' }, { id: 'p1' }] });
    genContent.mockRejectedValueOnce(new Error('llm down')).mockResolvedValue(undefined);
    const { step } = makeStep();
    await expect(run(step)).resolves.toBeUndefined();
    expect(genContent).toHaveBeenCalledTimes(2);
  });
});
