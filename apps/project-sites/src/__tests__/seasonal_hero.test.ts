/**
 * Unit tests for seasonal_hero (#70). Pure — fixed nowMs injected (no Date.now()).
 */

import { describe, it, expect } from '@jest/globals';
import { seasonalHero } from '../services/seasonal_hero.js';

const at = (iso: string) => Date.parse(iso);

describe('seasonal_hero — season', () => {
  it('maps months to northern-hemisphere seasons', () => {
    expect(seasonalHero(at('2026-01-15T00:00:00Z')).season).toBe('winter');
    expect(seasonalHero(at('2026-04-15T00:00:00Z')).season).toBe('spring');
    expect(seasonalHero(at('2026-07-15T00:00:00Z')).season).toBe('summer');
    expect(seasonalHero(at('2026-10-15T00:00:00Z')).season).toBe('autumn');
  });

  it('flips season for the southern hemisphere', () => {
    expect(seasonalHero(at('2026-07-15T00:00:00Z'), { hemisphere: 'south' }).season).toBe('winter');
    expect(seasonalHero(at('2026-01-15T00:00:00Z'), { hemisphere: 'south' }).season).toBe('summer');
  });
});

describe('seasonal_hero — occasion windows', () => {
  it('detects an in-window occasion with accent + headline', () => {
    const h = seasonalHero(at('2026-10-29T12:00:00Z'));
    expect(h.occasion).toBe('halloween');
    expect(h.accent).toBe('accent-pumpkin');
    expect(h.headlinePrefix).toContain('Halloween');
  });

  it('handles the year-boundary new-year window (both sides)', () => {
    expect(seasonalHero(at('2026-12-31T00:00:00Z')).occasion).toBe('new_year');
    expect(seasonalHero(at('2026-01-02T00:00:00Z')).occasion).toBe('new_year');
  });

  it('returns null occasion outside every window (no forced gimmick)', () => {
    const h = seasonalHero(at('2026-06-15T00:00:00Z'));
    expect(h.occasion).toBeNull();
    expect(h.headlinePrefix).toBeNull();
    expect(h.accent).toBe('accent-sun'); // summer tint
  });

  it('suppresses occasions when occasions:false', () => {
    const h = seasonalHero(at('2026-10-29T12:00:00Z'), { occasions: false });
    expect(h.occasion).toBeNull();
    expect(h.accent).toBe('accent-amber'); // plain autumn tint
  });

  it('does not apply US occasions in the southern hemisphere', () => {
    expect(seasonalHero(at('2026-10-29T12:00:00Z'), { hemisphere: 'south' }).occasion).toBeNull();
  });

  it('every occasion entry exposes a non-empty accent + headline', () => {
    // sample one date per occasion window
    const dates = [
      '2026-02-12',
      '2026-03-20',
      '2026-07-04',
      '2026-08-25',
      '2026-11-25',
      '2026-12-20',
    ];
    for (const d of dates) {
      const h = seasonalHero(at(`${d}T12:00:00Z`));
      expect(h.occasion).not.toBeNull();
      expect(h.accent.length).toBeGreaterThan(0);
      expect((h.headlinePrefix ?? '').length).toBeGreaterThan(0);
    }
  });
});
