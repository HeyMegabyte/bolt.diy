/**
 * Unit tests for A2 — the per-instance metered cost ESTIMATE (`app_cost_meter`).
 * Pure function, no I/O.
 */
import { estimateInstanceCost, type CostMeterInstance } from '../services/app_cost_meter.js';

const base: CostMeterInstance = {
  status: 'running',
  neon_project_id: null,
  upstash_database_id: null,
  r2_bucket_name: null,
};

describe('estimateInstanceCost', () => {
  it('a bare running instance costs only the running-compute line', () => {
    const est = estimateInstanceCost(base);
    expect(est.basis).toBe('estimate');
    expect(est.running).toBe(true);
    expect(est.breakdown).toEqual({ compute: 2.5, neon: 0, upstash: 0, r2: 0 });
    expect(est.monthlyUsd).toBe(2.5);
  });

  it('a hibernated/stopped instance bills only the minimal compute floor', () => {
    const est = estimateInstanceCost({ ...base, status: 'hibernated' });
    expect(est.running).toBe(false);
    expect(est.breakdown.compute).toBe(0.25);
    expect(est.monthlyUsd).toBe(0.25);
  });

  it('adds a line for each aux infra the instance actually provisioned', () => {
    const est = estimateInstanceCost({
      ...base,
      neon_project_id: 'np_1',
      upstash_database_id: 'up_1',
      r2_bucket_name: 'bucket-1',
    });
    expect(est.breakdown).toEqual({ compute: 2.5, neon: 5, upstash: 3, r2: 2 });
    expect(est.monthlyUsd).toBe(12.5);
  });

  it('only counts the infra that IS provisioned (no phantom lines)', () => {
    const est = estimateInstanceCost({ ...base, neon_project_id: 'np_1' });
    expect(est.breakdown).toEqual({ compute: 2.5, neon: 5, upstash: 0, r2: 0 });
    expect(est.monthlyUsd).toBe(7.5);
  });

  it('the breakdown always sums to monthlyUsd', () => {
    const est = estimateInstanceCost({
      status: 'running',
      neon_project_id: 'x',
      upstash_database_id: 'y',
      r2_bucket_name: 'z',
    });
    const sum = est.breakdown.compute + est.breakdown.neon + est.breakdown.upstash + est.breakdown.r2;
    expect(sum).toBeCloseTo(est.monthlyUsd, 5);
  });
});
