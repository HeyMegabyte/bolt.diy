import {
  benchmarkMetric,
  formatRate,
  type FleetStats,
} from '../services/fleet_benchmark.js';

const fleet: FleetStats = { median: 3.4, p25: 2.0, p75: 5.0, sampleSize: 120 };

describe('formatRate (AN50 fleet_benchmark)', () => {
  it('renders one-decimal percentages', () => {
    expect(formatRate(1.23)).toBe('1.2%');
    expect(formatRate(3)).toBe('3.0%');
  });

  it('handles non-finite input', () => {
    expect(formatRate(NaN)).toBe('0%');
  });
});

describe('benchmarkMetric (AN50)', () => {
  it('flags a below-median value in the bottom quartile', () => {
    const r = benchmarkMetric(1.2, fleet, { metricLabel: 'form conversion' });
    expect(r.verdict).toBe('below');
    expect(r.band).toBe('bottom');
    expect(r.delta).toBe(-2.2);
    expect(r.ratio).toBe(0.35);
    expect(r.sentence).toContain('Your form conversion is 1.2%');
    expect(r.sentence).toContain('below the 3.4% category median');
    expect(r.sentence).toContain('bottom quartile');
    expect(r.sentence).toContain('Room to improve.');
  });

  it('flags an above-median value in the top quartile as doing well', () => {
    const r = benchmarkMetric(6.0, fleet, { metricLabel: 'form conversion' });
    expect(r.verdict).toBe('above');
    expect(r.band).toBe('top');
    expect(r.sentence).toContain('top quartile');
    expect(r.sentence).toContain('Nice work.');
  });

  it('treats values within ±3% of the median as "at"', () => {
    const r = benchmarkMetric(3.45, fleet);
    expect(r.verdict).toBe('at');
    expect(r.sentence).toContain('in line with');
    expect(r.sentence).not.toContain('Nice work.');
    expect(r.sentence).not.toContain('Room to improve.');
  });

  it('inverts the "doing well" judgment when lower is better', () => {
    // bounce rate: below median is GOOD
    const r = benchmarkMetric(1.2, fleet, { metricLabel: 'bounce rate', higherIsBetter: false });
    expect(r.verdict).toBe('below');
    expect(r.sentence).toContain('Nice work.');
  });

  it('adds a low-confidence note for small cohorts', () => {
    const r = benchmarkMetric(1.2, { median: 3.4, sampleSize: 5 });
    expect(r.lowConfidence).toBe(true);
    expect(r.sentence).toContain('only 5 comparable sites');
  });

  it('returns null ratio when the median is 0', () => {
    const r = benchmarkMetric(2, { median: 0, sampleSize: 50 });
    expect(r.ratio).toBeNull();
    expect(r.verdict).toBe('above');
  });

  it('never throws on non-finite inputs', () => {
    const r = benchmarkMetric(NaN, { median: NaN, sampleSize: 0 });
    expect(r.delta).toBe(0);
    expect(r.verdict).toBe('at');
    expect(typeof r.sentence).toBe('string');
  });

  it('omits a quartile band when p25/p75 are absent', () => {
    const r = benchmarkMetric(2.0, { median: 3.4, sampleSize: 50 });
    expect(r.band).toBe('lower-middle');
    expect(r.sentence).not.toContain('quartile');
  });
});
