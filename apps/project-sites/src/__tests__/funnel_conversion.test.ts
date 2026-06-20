/**
 * computeFunnelConversion — pure funnel drop-off math (§8 revenue). Step
 * retention + reach-from-top + overall, zero-safe (null step rate on 0 upstream,
 * never NaN/Infinity), order-independent.
 */
import { computeFunnelConversion } from '../services/funnel_conversion.js';

const STAGES = [
  { stage: 'lead.discovered', label: 'Discovered', ordinal: 0, sites: 200 },
  { stage: 'site.claim.started', label: 'Engaged', ordinal: 1, sites: 80 },
  { stage: 'site.published', label: 'Delivered', ordinal: 2, sites: 40 },
  { stage: 'subscription.active', label: 'Converted', ordinal: 3, sites: 10 },
];

describe('computeFunnelConversion', () => {
  it('computes step retention, reach-from-top, and overall (1dp)', () => {
    const c = computeFunnelConversion(STAGES);
    expect(c.topSites).toBe(200);
    expect(c.bottomSites).toBe(10);
    expect(c.overallPct).toBe(5); // 10/200
    const byStage = Object.fromEntries(c.steps.map((s) => [s.stage, s]));
    expect(byStage['lead.discovered'].fromPrevPct).toBeNull(); // top has no prev
    expect(byStage['lead.discovered'].fromTopPct).toBe(100);
    expect(byStage['site.claim.started'].fromPrevPct).toBe(40); // 80/200
    expect(byStage['site.published'].fromPrevPct).toBe(50); // 40/80
    expect(byStage['site.published'].fromTopPct).toBe(20); // 40/200
    expect(byStage['subscription.active'].fromPrevPct).toBe(25); // 10/40
  });

  it('is order-independent (sorts by ordinal)', () => {
    const shuffled = [STAGES[3], STAGES[0], STAGES[2], STAGES[1]];
    const c = computeFunnelConversion(shuffled);
    expect(c.steps.map((s) => s.ordinal)).toEqual([0, 1, 2, 3]);
    expect(c.overallPct).toBe(5);
  });

  it('rounds to one decimal place', () => {
    const c = computeFunnelConversion([
      { stage: 'lead.discovered', label: 'Discovered', ordinal: 0, sites: 3 },
      { stage: 'subscription.active', label: 'Converted', ordinal: 1, sites: 1 },
    ]);
    expect(c.steps[1].fromPrevPct).toBe(33.3); // 1/3 = 33.33% → 33.3
  });

  it('is zero-safe: null step rate when upstream is 0, 0 reach/overall, no NaN', () => {
    const c = computeFunnelConversion([
      { stage: 'lead.discovered', label: 'Discovered', ordinal: 0, sites: 0 },
      { stage: 'site.published', label: 'Delivered', ordinal: 1, sites: 0 },
    ]);
    expect(c.overallPct).toBe(0);
    expect(c.steps[1].fromPrevPct).toBeNull(); // 0 upstream → undefined, not 0
    expect(c.steps[1].fromTopPct).toBe(0);
    expect(Number.isFinite(c.overallPct)).toBe(true);
  });

  it('returns an empty zeroed conversion for no stages', () => {
    expect(computeFunnelConversion([])).toEqual({
      steps: [],
      topSites: 0,
      bottomSites: 0,
      overallPct: 0,
    });
  });
});
