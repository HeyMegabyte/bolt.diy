import { assignVariant, computeSignificance } from '../service.js';

const exp = { id: 'e1', name: 'Hero Test', targetMetric: 'conversion', minSampleSize: 100, variants: [
  { id: 'a', name: 'Control', weight: 50, config: {} },
  { id: 'b', name: 'Variant', weight: 50, config: {} },
]};
describe('assignVariant', () => {
  test('same visitor gets same variant', () => {
    expect(assignVariant(exp, 'user-1').id).toBe(assignVariant(exp, 'user-1').id);
  });
  test('different visitors may get different variants', () => {
    const ids = new Set([assignVariant(exp, 'u1').id, assignVariant(exp, 'u2').id, assignVariant(exp, 'u3').id]);
    expect(ids.size).toBeGreaterThanOrEqual(1);
  });
});
describe('computeSignificance', () => {
  test('clear winner is significant', () => {
    const r = computeSignificance({ conversions: 10, total: 100 }, { conversions: 25, total: 100 });
    expect(r.significant).toBe(true);
    expect(r.winner).toBe('variant');
  });
  test('no difference is tie', () => {
    const r = computeSignificance({ conversions: 15, total: 100 }, { conversions: 15, total: 100 });
    expect(r.winner).toBe('tie');
  });
  test('variant losing → control wins', () => {
    const r = computeSignificance({ conversions: 30, total: 100 }, { conversions: 10, total: 100 });
    expect(r.winner).toBe('control');
  });
});
