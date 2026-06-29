import {
  summarizeCoverage,
  type ScanRunRow,
  type CoverageLeadRow,
} from '../services/coverage_summary.js';

const runs: ScanRunRow[] = [
  { zip: '07034', scannedAt: 1000 },
  { zip: '07034', scannedAt: 3000 }, // dup zip, later time
  { zip: '10001', scannedAt: 2000 },
];
const leads: CoverageLeadRow[] = [
  { tier: 'A', stage: 'claimed', estValueCents: 50000 },
  { tier: 'A', stage: 'preview_sent', estValueCents: 50000 },
  { tier: 'B', stage: 'contacted', estValueCents: 30000 },
  { tier: 'C', stage: 'discovered', estValueCents: 10000 },
  { tier: 'D', stage: 'lost', estValueCents: 10000 }, // excluded from pipeline
  { tier: 'A', stage: 'build_triggered', estValueCents: 50000 },
];

describe('summarizeCoverage (Lead Scanner #97 — coverage + funnel roll-up)', () => {
  it('counts distinct ZIPs + the most-recent scan time', () => {
    const s = summarizeCoverage(runs, []);
    expect(s.zipsScanned).toBe(2); // 07034 deduped
    expect(s.lastScanAt).toBe(3000);
  });

  it('buckets leads by tier (all four keys present)', () => {
    const s = summarizeCoverage([], leads);
    expect(s.byTier).toEqual({ A: 3, B: 1, C: 1, D: 1 });
    expect(s.totalLeads).toBe(6);
  });

  it('computes contact-rate as contacted-or-beyond ÷ total', () => {
    const s = summarizeCoverage([], leads);
    // contacted+ = contacted, preview_sent, build_triggered, claimed = 4 of 6 → 66.7
    expect(s.contactRate).toBe(66.7);
  });

  it('counts build-triggered + claimed stages', () => {
    const s = summarizeCoverage([], leads);
    expect(s.buildTriggered).toBe(1);
    expect(s.claimed).toBe(1);
  });

  it('sums pipeline value across non-lost leads only', () => {
    const s = summarizeCoverage([], leads);
    // 5 non-lost leads × (50000,50000,30000,10000,50000) = 190000; lost 10000 excluded
    expect(s.pipelineValueCents).toBe(190000);
  });

  it('returns an all-zero summary (never throws) on empty inputs', () => {
    const s = summarizeCoverage([], []);
    expect(s).toEqual({
      zipsScanned: 0,
      lastScanAt: null,
      totalLeads: 0,
      byTier: { A: 0, B: 0, C: 0, D: 0 },
      contactRate: 0,
      buildTriggered: 0,
      claimed: 0,
      pipelineValueCents: 0,
    });
  });
});
