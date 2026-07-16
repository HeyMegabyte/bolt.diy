import { computeChange, defaultDashboard, filterBySource, buildMetric, metricSources } from '../service.js';

describe('computeChange', () => {
  test('increase → up trend', () => {
    expect(computeChange(120, 100)).toEqual({ changePercent: 20, trend: 'up' });
  });
  test('decrease → down trend', () => {
    expect(computeChange(80, 100)).toEqual({ changePercent: -20, trend: 'down' });
  });
  test('small change → flat', () => {
    expect(computeChange(102, 100).trend).toBe('flat');
  });
  test('zero previous → 100% if current >0', () => {
    expect(computeChange(50, 0).changePercent).toBe(100);
  });
});

describe('defaultDashboard', () => {
  test('returns 11 default widgets in grid layout', () => {
    const d = defaultDashboard('s1');
    expect(d.widgets).toHaveLength(11);
    expect(d.layout).toBe('grid');
    expect(d.siteId).toBe('s1');
  });
});

describe('filterBySource', () => {
  test('filters to website-only widgets', () => {
    const d = defaultDashboard('s1');
    const f = filterBySource(d, ['website']);
    expect(f.widgets.every((w) => w.source === 'website')).toBe(true);
    expect(f.widgetCount).toBeLessThan(d.widgetCount);
  });
  test('re-positions filtered widgets sequentially', () => {
    const d = defaultDashboard('s1');
    const f = filterBySource(d, ['website']);
    expect(f.widgets[0].position).toBe(0);
    expect(f.widgets[1].position).toBe(1);
  });
});

describe('buildMetric', () => {
  test('builds complete metric value', () => {
    const m = buildMetric('Visitors', 1000, 800, 'website');
    expect(m.label).toBe('Visitors');
    expect(m.value).toBe(1000);
    expect(m.previousValue).toBe(800);
    expect(m.changePercent).toBe(25);
    expect(m.trend).toBe('up');
    expect(m.source).toBe('website');
  });
});

describe('metricSources', () => {
  test('returns 6 sources', () => {
    expect(metricSources()).toHaveLength(6);
    expect(metricSources()).toContain('website');
    expect(metricSources()).toContain('crm');
  });
});
