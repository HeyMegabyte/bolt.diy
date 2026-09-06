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
 *
 * The FONTS contract is guarded hard: the 2026-09-06 ground-truth was that every
 * deployed generated site shipped headings in system-ui (the prose font names
 * never landed), so renderThemeDossier now emits a copy-pastable font mandate —
 * these tests fail if that mandate is thinned back out.
 */
describe('THEME_PRESETS registry', () => {
  const REQUIRED: (keyof ThemeDossier)[] = [
    'label',
    'essence',
    'typography',
    'headingStack',
    'bodyStack',
    'googleFontsHref',
    'color',
    'geometry',
    'depth',
    'motion',
    'texture',
    'iconography',
    'imagery',
    'interactions',
    'voice',
    'hero',
    'layout',
    'signature',
  ];

  it('includes the fallback theme', () => {
    expect(THEME_PRESETS[DEFAULT_THEME_STYLE]).toBeTruthy();
    expect(DEFAULT_THEME_STYLE).toBe('classic');
  });

  it('registers the enriched + new themes (≥16)', () => {
    expect(THEME_STYLE_KEYS.length).toBeGreaterThanOrEqual(16);
    // Themes for previously-unmapped categories + the new elaborate themes.
    for (const k of [
      'botanical',
      'boutique',
      'precision',
      'heritage',
      'scholarly',
      'noir',
      'artisan',
      'retro',
    ]) {
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

  it('every theme carries a real, copy-pastable font contract', () => {
    for (const key of THEME_STYLE_KEYS) {
      const d = THEME_PRESETS[key];
      // headingStack / bodyStack must be CSS font-family values (a quoted family).
      expect(d.headingStack).withContext(`${key}.headingStack`).toContain("'");
      expect(d.bodyStack).withContext(`${key}.bodyStack`).toContain("'");
      // googleFontsHref must be a real Google Fonts stylesheet URL with display=swap.
      expect(d.googleFontsHref).withContext(`${key}.googleFontsHref host`).toContain(
        'https://fonts.googleapis.com/css2?family=',
      );
      expect(d.googleFontsHref).withContext(`${key}.googleFontsHref swap`).toContain('display=swap');
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
    expect(out).toContain('• Iconography:');
    expect(out).toContain('• Imagery / art direction:');
    expect(out).toContain('• Micro-interactions:');
    expect(out).toContain('• Voice / microcopy:');
    expect(out).toContain('• Hero treatment:');
    expect(out).toContain('• Layout rhythm:');
    expect(out).toContain('• Signature detail:');
    expect(out).toContain('one coherent, elaborate brand');
  });

  it('emits the MANDATORY, copy-pastable font block (the anti-system-ui fix)', () => {
    const out = renderThemeDossier('bold');
    expect(out).toContain('Fonts (MANDATORY');
    expect(out).toContain('never leave headings in system-ui');
    expect(out).toContain('https://fonts.googleapis.com/css2?family=Oswald');
    expect(out).toContain('--font-heading:');
    expect(out).toContain('--font-body:');
    expect(out).toContain("'Oswald'");
    expect(out).toContain('has NOT applied this theme');
  });

  it('is dramatically richer than the old one-line hint (multi-line block)', () => {
    const out = renderThemeDossier('futuristic');
    expect(out.split('\n').length).toBeGreaterThanOrEqual(15);
    expect(out).toContain('gradient-mesh');
  });

  it('falls back to classic for an unknown/empty/nullish style', () => {
    for (const bad of ['', 'does-not-exist', undefined, null]) {
      const out = renderThemeDossier(bad as string);
      expect(out).withContext(String(bad)).toContain('(classic)');
    }
  });

  it('renders the requested theme verbatim when known, including the new themes', () => {
    expect(renderThemeDossier('botanical')).toContain('(botanical)');
    expect(renderThemeDossier('boutique')).toContain('(boutique)');
    expect(renderThemeDossier('heritage')).toContain('(heritage)');
    expect(renderThemeDossier('noir')).toContain('(noir)');
    expect(renderThemeDossier('artisan')).toContain('(artisan)');
    expect(renderThemeDossier('retro')).toContain('(retro)');
  });
});
