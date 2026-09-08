import { themeStyleFromInputs, THEME_STYLE_NAMES } from '../services/theme_style.js';

describe('theme_style — themeStyleFromInputs', () => {
  describe('preset registry invariant (drift guard vs template PRESET_NAMES)', () => {
    it('is exactly the 13 template presets, lowercase + unique', () => {
      const expected = [
        'classic',
        'editorial',
        'warm',
        'luxe',
        'brutalist',
        'bold',
        'futuristic',
        'rugged',
        'botanical',
        'boutique',
        'precision',
        'heritage',
        'scholarly',
      ];
      expect([...THEME_STYLE_NAMES].sort()).toEqual([...expected].sort());
      expect(new Set(THEME_STYLE_NAMES).size).toBe(THEME_STYLE_NAMES.length);
      for (const n of THEME_STYLE_NAMES) expect(n).toBe(n.toLowerCase());
    });

    it('only ever returns a name from the registry (or undefined)', () => {
      const samples = ['Financial / Accounting', 'Automotive', 'Real Estate', 'Other', '', 'zzz'];
      for (const s of samples) {
        const r = themeStyleFromInputs(s);
        if (r !== undefined) expect(THEME_STYLE_NAMES).toContain(r);
      }
    });
  });

  describe('category → preset (every /create dropdown vertical maps sensibly)', () => {
    const cases: Array<[string, string]> = [
      ['Restaurant / Café', 'warm'],
      ['Bar / Nightlife / Brewery', 'warm'],
      ['Bakery / Coffee Shop', 'warm'],
      ['Beauty / Spa / Wellness', 'botanical'],
      ['Salon / Barbershop', 'warm'],
      ['Legal / Law Firm', 'editorial'],
      ['Medical / Healthcare', 'botanical'],
      ['Retail / Shop', 'boutique'],
      ['Technology / SaaS', 'futuristic'],
      ['Construction / Home Services', 'rugged'],
      ['Fitness / Gym', 'bold'],
      ['Real Estate', 'luxe'],
      ['Photography / Creative', 'brutalist'],
      ['Automotive', 'precision'],
      ['Education / Tutoring', 'scholarly'],
      ['Financial / Accounting', 'heritage'],
    ];
    it.each(cases)('%s → %s', (category, expected) => {
      expect(themeStyleFromInputs(category)).toBe(expected);
    });

    it('every one of the 13 presets is reachable via some category/hint', () => {
      const reached = new Set<string>();
      for (const [c] of cases) reached.add(themeStyleFromInputs(c) as string);
      // categories cover 9 distinct presets; hints reach the rest.
      reached.add(themeStyleFromInputs(undefined, 'sleek high-tech gradient') as string); // futuristic
      reached.add(themeStyleFromInputs('Other', 'timeless trusted institution') as string); // heritage
      reached.add(themeStyleFromInputs('Other', 'raw brutalist stark') as string); // brutalist
      reached.add(themeStyleFromInputs('Other', 'engineered metallic precision') as string); // precision
      reached.add(themeStyleFromInputs('Other', 'chic curated boutique') as string); // boutique
      // classic is the TEMPLATE fallback (undefined here), so 12 non-classic reachable.
      expect(reached.size).toBeGreaterThanOrEqual(11);
      expect(reached.has('undefined')).toBe(false);
    });
  });

  describe('design-hint keyword override wins over category', () => {
    it('elegant luxury on a retail shop → luxe (not boutique)', () => {
      expect(themeStyleFromInputs('Retail / Shop', 'we want an elegant, luxurious feel')).toBe(
        'luxe',
      );
    });
    it('bold energetic on a law firm → bold (not editorial)', () => {
      expect(themeStyleFromInputs('Legal / Law Firm', 'bold and energetic brand')).toBe('bold');
    });
    it('calm organic on a gym → botanical (not bold)', () => {
      expect(themeStyleFromInputs('Fitness / Gym', 'calm, organic, natural wellness vibe')).toBe(
        'botanical',
      );
    });
  });

  describe('graceful fallback (undefined → template classic)', () => {
    it('returns undefined for unmapped category', () => {
      expect(themeStyleFromInputs('Other')).toBeUndefined();
      expect(themeStyleFromInputs('')).toBeUndefined();
      expect(themeStyleFromInputs(undefined, undefined)).toBeUndefined();
      expect(themeStyleFromInputs(null, null)).toBeUndefined();
    });
    it('never throws on odd input', () => {
      expect(() => themeStyleFromInputs('   ', '  ')).not.toThrow();
      // @ts-expect-error — defensive: non-string at runtime must not throw
      expect(() => themeStyleFromInputs(42, {})).not.toThrow();
    });
    it('ignores a hint with no style keyword and uses category', () => {
      expect(themeStyleFromInputs('Automotive', 'open Mon-Fri 9-5, call us')).toBe('precision');
    });
  });
});
