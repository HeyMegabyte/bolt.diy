import {
  THEME_PRESETS,
  THEME_STYLE_KEYS,
  DEFAULT_THEME_STYLE,
  renderThemeDossier,
  type ThemeDossier,
} from './theme-presets';

/**
 * theme-presets — the named-theme design-language registry that feeds the
 * /create generation prompt. Pure module → Karma/Jasmine (frontend), so
 * toBe/toContain, not Jest. Guards the dossier contract + render output so a
 * thinned-out or malformed theme can never silently ship a generic-looking build.
 */
describe('THEME_PRESETS registry', () => {
  const REQUIRED: (keyof ThemeDossier)[] = [
    'label',
    'essence',
    'typography',
    'color',
    'geometry',
    'depth',
    'motion',
    'texture',
    'hero',
    'layout',
    'signature',
  ];

  it('includes the fallback theme', () => {
    expect(THEME_PRESETS[DEFAULT_THEME_STYLE]).toBeTruthy();
    expect(DEFAULT_THEME_STYLE).toBe('classic');
  });

  it('registers the enriched + new themes (≥13)', () => {
    expect(THEME_STYLE_KEYS.length).toBeGreaterThanOrEqual(13);
    // The four themes added for previously-unmapped categories must exist.
    for (const k of ['botanical', 'boutique', 'precision', 'heritage', 'scholarly']) {
      expect(THEME_PRESETS[k]).withContext(k).toBeTruthy();
    }
  });

  it('every dossier fills every facet with real, non-trivial prose', () => {
    // `label` is a short display name (e.g. "Quiet Luxe"); the design-instruction
    // facets must be substantive concrete prose the generator can act on.
    const SHORT_NAME: (keyof ThemeDossier)[] = ['label'];
    for (const key of THEME_STYLE_KEYS) {
      const d = THEME_PRESETS[key];
      for (const field of REQUIRED) {
        const v = d[field];
        expect(typeof v).withContext(`${key}.${field} type`).toBe('string');
        const min = SHORT_NAME.includes(field) ? 3 : 20;
        expect(v.trim().length).withContext(`${key}.${field} length`).toBeGreaterThan(min);
      }
    }
  });

  it('gives each theme a distinct essence (no copy-paste convergence)', () => {
    const essences = THEME_STYLE_KEYS.map((k) => THEME_PRESETS[k].essence);
    expect(new Set(essences).size).toBe(essences.length);
  });
});

describe('renderThemeDossier', () => {
  it('renders every facet as its own labeled bullet', () => {
    const out = renderThemeDossier('luxe');
    expect(out).toContain('Theme personality: "Quiet Luxe" (luxe)');
    expect(out).toContain('• Typography:');
    expect(out).toContain('• Color treatment:');
    expect(out).toContain('• Geometry:');
    expect(out).toContain('• Depth:');
    expect(out).toContain('• Motion:');
    expect(out).toContain('• Texture / finish:');
    expect(out).toContain('• Hero treatment:');
    expect(out).toContain('• Layout rhythm:');
    expect(out).toContain('• Signature detail:');
    expect(out).toContain('one coherent, elaborate brand');
  });

  it('is dramatically richer than the old one-line hint (multi-line block)', () => {
    const out = renderThemeDossier('futuristic');
    expect(out.split('\n').length).toBeGreaterThanOrEqual(11);
    expect(out).toContain('gradient-mesh');
  });

  it('falls back to classic for an unknown/empty/nullish style', () => {
    for (const bad of ['', 'does-not-exist', undefined, null]) {
      const out = renderThemeDossier(bad as string);
      expect(out).withContext(String(bad)).toContain('(classic)');
    }
  });

  it('renders the requested theme verbatim when known', () => {
    expect(renderThemeDossier('botanical')).toContain('(botanical)');
    expect(renderThemeDossier('boutique')).toContain('(boutique)');
    expect(renderThemeDossier('heritage')).toContain('(heritage)');
  });
});
